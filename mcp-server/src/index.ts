import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createClient } from '@supabase/supabase-js';
import { registrarFerramentas } from './tools.js';
import { registrarFerramentasCiclo } from './ciclo.js';
import { registrarFerramentasAlimentacao } from './alimentacao.js';

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
const MCP_SECRET = exigirEnv('MCP_SECRET');
const PORT = Number(process.env.PORT) || 3000;

if (MCP_SECRET.length < 24) {
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

function criarServidor(): McpServer {
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
  registrarFerramentas(server, supabase);
  registrarFerramentasCiclo(server, supabase);
  registrarFerramentasAlimentacao(server, supabase);
  return server;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Modo stateless: um servidor e um transporte novos por requisição
app.post('/mcp/:secret', async (req: Request, res: Response) => {
  if (!secretValido(req.params.secret)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const server = criarServidor();
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
});

// Sem sessões, não há stream SSE (GET) nem encerramento de sessão (DELETE)
app.all('/mcp/:secret', (req: Request, res: Response) => {
  if (!secretValido(req.params.secret)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(405).set('Allow', 'POST').json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Método não permitido.' },
    id: null,
  });
});

app.listen(PORT, () => {
  console.log(`Servidor MCP ouvindo na porta ${PORT}`);
});
