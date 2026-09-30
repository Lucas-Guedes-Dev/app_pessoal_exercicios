import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createClient } from '@supabase/supabase-js';
import { registrarFerramentas } from './tools.js';
import { registrarFerramentasCiclo } from './ciclo.js';
import { registrarFerramentasAlimentacao } from './alimentacao.js';
import { criarEscopo } from './escopo.js';

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
const PORT = Number(process.env.PORT) || 3000;

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

const app = express();
app.use(express.json({ limit: '1mb' }));

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
  console.log(`Servidor MCP ouvindo na porta ${PORT}`);
});
