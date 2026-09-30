import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createClient } from '@supabase/supabase-js';
import { registrarFerramentas } from './tools.js';
import { registrarFerramentasCiclo } from './ciclo.js';
import { registrarFerramentasAlimentacao } from './alimentacao.js';
import { criarEscopo } from './escopo.js';
import { ProvedorOAuth } from './auth/provider.js';
import { rotaEntrar } from './auth/login.js';

function exigirEnv(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`Variável de ambiente ${nome} não definida.`);
    process.exit(1);
  }
  return valor;
}

const SUPABASE_URL = exigirEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = exigirEnv('SUPABASE_SERVICE_ROLE_KEY');
// chave publishable/anon: só para conferir e-mail e senha na tela de login do OAuth
const SUPABASE_ANON_KEY = exigirEnv('SUPABASE_ANON_KEY');
// endereço público do servidor, ex.: https://app-exercicios.onrender.com (a URL do conector é PUBLIC_URL/mcp)
const PUBLIC_URL = exigirEnv('PUBLIC_URL').replace(/\/+$/, '');
const PORT = Number(process.env.PORT) || 3000;
const segundos = (nome: string, padrao: number) => Number(process.env[nome]) || padrao;
const VALIDADE_ACESSO = segundos('OAUTH_ACCESS_TTL', 60 * 60); // 1 hora
const VALIDADE_REFRESH = segundos('OAUTH_REFRESH_TTL', 90 * 24 * 60 * 60); // 90 dias
const VALIDADE_CODIGO = 5 * 60;

// Rota antiga /mcp/<segredo>, só para migrar o conector: age como o usuário de LEGACY_USER_EMAIL
const LEGACY_SECRET_ROUTE = process.env.LEGACY_SECRET_ROUTE === 'on';
const MCP_SECRET = LEGACY_SECRET_ROUTE ? exigirEnv('MCP_SECRET') : '';
const LEGACY_USER_EMAIL = LEGACY_SECRET_ROUTE ? exigirEnv('LEGACY_USER_EMAIL').trim().toLowerCase() : '';

if (LEGACY_SECRET_ROUTE && MCP_SECRET.length < 24) {
  console.error('MCP_SECRET precisa ter pelo menos 24 caracteres.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Compara os hashes, para o tempo de resposta não revelar quanto do segredo acertou
const hashSecret = createHash('sha256').update(MCP_SECRET).digest();
function secretValido(recebido: unknown): boolean {
  if (typeof recebido !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(recebido).digest(), hashSecret);
}

/** id do usuário dono da rota antiga (buscado pelo e-mail no Supabase Auth, uma vez) */
let usuarioLegado: string | null = null;
async function idUsuarioLegado(): Promise<string> {
  if (usuarioLegado) return usuarioLegado;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Erro ao buscar o usuário da rota antiga: ${error.message}`);
    const u = data.users.find((x) => x.email?.toLowerCase() === LEGACY_USER_EMAIL);
    if (u) return (usuarioLegado = u.id);
    if (data.users.length < 200) break;
  }
  throw new Error(`Nenhuma conta com o e-mail ${LEGACY_USER_EMAIL} (LEGACY_USER_EMAIL).`);
}

/** Servidor MCP preso a um usuário: todas as ferramentas usam o escopo dele */
function criarServidor(userId: string): McpServer {
  const server = new McpServer(
    { name: 'app-exercicios', version: '1.0.0' },
    {
      instructions:
        'Gerencia o plano de treino do app de exercícios do usuário. Os dias da semana usam os ' +
        'códigos Seg, Ter, Qua, Qui, Sex, Sab, Dom. Antes de editar ou remover, use ' +
        'listar_exercicios para achar o id. As semanas do ciclo (A a F) são configuradas com ' +
        'configurar_ciclo; use ver_ciclo para saber quantas semanas existem e qual é a de hoje. ' +
        'Alimentação: a base é a tabela TACO (valores por 100 g) mais alimentos próprios do usuário. ' +
        'Para registrar o que ele comeu, SEMPRE use buscar_alimentos antes para achar o id e depois ' +
        'registrar_alimentacao (gramas ou medida caseira como "concha"). Refeições: cafe, almoco, ' +
        'lanche, jantar, ceia. Datas em AAAA-MM-DD, no horário de Brasília (padrão: hoje).',
    }
  );
  const db = criarEscopo(supabase, userId);
  registrarFerramentas(server, db);
  registrarFerramentasCiclo(server, db);
  registrarFerramentasAlimentacao(server, db);
  return server;
}

const recursoMcp = new URL('/mcp', PUBLIC_URL);
const provider = new ProvedorOAuth({
  supabase,
  recurso: recursoMcp,
  validadeAcesso: VALIDADE_ACESSO,
  validadeRefresh: VALIDADE_REFRESH,
  validadeCodigo: VALIDADE_CODIGO,
});
const ESCOPOS = ['app', 'offline_access'];
const metadataRecursoUrl = getOAuthProtectedResourceMetadataUrl(recursoMcp);

const app = express();
app.set('trust proxy', 1); // Render fica atrás de um proxy (IP real para o limite de tentativas)
app.use(express.json({ limit: '1mb' }));

// OAuth 2.1: /.well-known/oauth-authorization-server, /.well-known/oauth-protected-resource/mcp,
// /register (DCR), /authorize (tela de login), /token (code + PKCE, refresh) e /revoke
app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: new URL(PUBLIC_URL),
    resourceServerUrl: recursoMcp,
    scopesSupported: ESCOPOS,
    resourceName: 'App de Exercícios',
  })
);
// Mesma metadata também na raiz, para clientes que procuram só em /.well-known/oauth-protected-resource
app.get('/.well-known/oauth-protected-resource', (_req, res) => {
  res.json({
    resource: recursoMcp.href,
    authorization_servers: [new URL(PUBLIC_URL).href],
    scopes_supported: ESCOPOS,
    resource_name: 'App de Exercícios',
  });
});
app.use(rotaEntrar({ provider, supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Modo stateless: um servidor e um transporte novos por requisição
async function atenderMcp(req: Request, res: Response, userId: string) {
  const server = criarServidor(userId);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('Erro ao processar requisição MCP:', e);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Erro interno do servidor' },
        id: null,
      });
    }
  }
}

function metodoNaoPermitido(res: Response) {
  // Sem sessões, não há stream SSE (GET) nem encerramento de sessão (DELETE)
  res.status(405).set('Allow', 'POST').json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Método não permitido.' },
    id: null,
  });
}

// Endpoint MCP: exige Bearer válido; sem ele, 401 com WWW-Authenticate apontando para a metadata
const exigirLogin = requireBearerAuth({ verifier: provider, resourceMetadataUrl: metadataRecursoUrl });
app.post('/mcp', exigirLogin, async (req: Request, res: Response) => {
  const userId = req.auth?.extra?.userId;
  if (typeof userId !== 'string') {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }
  await atenderMcp(req, res, userId);
});
app.all('/mcp', exigirLogin, (_req: Request, res: Response) => metodoNaoPermitido(res));

if (LEGACY_SECRET_ROUTE) {
  app.post('/mcp/:secret', async (req: Request, res: Response) => {
    if (!secretValido(req.params.secret)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    let userId: string;
    try {
      userId = await idUsuarioLegado();
    } catch (e) {
      console.error(e);
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Usuário da rota antiga não encontrado' }, id: null });
      return;
    }
    await atenderMcp(req, res, userId);
  });
  app.all('/mcp/:secret', (req: Request, res: Response) => {
    if (!secretValido(req.params.secret)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    metodoNaoPermitido(res);
  });
}

app.listen(PORT, () => {
  console.log(`Servidor MCP ouvindo na porta ${PORT} — conector: ${recursoMcp.href}`);
  if (LEGACY_SECRET_ROUTE) console.log(`Rota antiga /mcp/<segredo> ligada, como ${LEGACY_USER_EMAIL}`);
});
