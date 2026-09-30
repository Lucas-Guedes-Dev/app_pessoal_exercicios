import express, { type Request, type Response, type Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { redirectUriMatches } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import type { ProvedorOAuth } from './provider.js';

// Tela de login do /authorize: e-mail e senha do app, validados no Supabase Auth.

export type DadosAutorizacao = {
  clientId: string;
  nomeCliente?: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  escopos: string[];
  recurso?: string;
};

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function paginaLogin(res: Response, d: DadosAutorizacao, opcoes: { erro?: string; email?: string; status?: number } = {}) {
  const destino = new URL(d.redirectUri);
  const local = LOOPBACK.has(destino.hostname);
  const quem = destino.hostname.endsWith('claude.ai') || destino.hostname.endsWith('claude.com') ? 'O Claude' : 'Um aplicativo';
  const escondido = (nome: string, valor: unknown) =>
    valor === undefined ? '' : `<input type="hidden" name="${nome}" value="${esc(valor)}">`;

  res
    .status(opcoes.status ?? 200)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      // form-action inclui o destino porque o navegador aplica a regra ao redirecionamento pós-login
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${destino.origin}; frame-ancestors 'none'; base-uri 'none'`,
    })
    .send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar — App de Exercícios</title>
<style>
  :root { --verde: #0f7b3f; --texto: #1d2320; --suave: #5f6b65; --borda: #d5ddd8; --fundo: #f3f6f4; --erro: #b3261e; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--fundo); color: var(--texto); }
  main { max-width: 420px; margin: 0 auto; padding: 32px 16px; }
  .cartao { background: #fff; border-radius: 16px; padding: 24px 20px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { line-height: 1.45; margin: 0 0 16px; color: var(--suave); }
  .destino { font-size: 13px; background: var(--fundo); border-radius: 8px; padding: 8px 10px; margin-bottom: 20px; }
  .aviso { color: var(--erro); }
  label { display: block; font-weight: 600; font-size: 14px; margin: 14px 0 6px; }
  input[type=email], input[type=password] { width: 100%; font-size: 16px; padding: 12px; border: 1px solid var(--borda); border-radius: 10px; }
  input:focus { outline: 2px solid var(--verde); border-color: var(--verde); }
  button { width: 100%; margin-top: 22px; padding: 14px; font-size: 16px; font-weight: 700; color: #fff; background: var(--verde); border: 0; border-radius: 12px; }
  .erro { background: #fdecea; color: var(--erro); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; font-size: 14px; }
  .rodape { font-size: 13px; text-align: center; margin-top: 16px; }
</style>
</head>
<body>
<main>
  <div class="cartao">
    <h1>⚽ App de Exercícios</h1>
    <p>${quem} quer acessar os <strong>seus</strong> treinos e a sua alimentação. Entre com o e-mail e a senha que você usa no app.</p>
    <div class="destino">Depois de entrar, você volta para <strong>${esc(destino.host)}</strong>${
      local ? '<br><span class="aviso">Endereço deste computador (Claude Code ou uma ferramenta local). Só continue se foi você que pediu.</span>' : ''
    }</div>
    ${opcoes.erro ? `<div class="erro" role="alert">${esc(opcoes.erro)}</div>` : ''}
    <form method="post" action="/authorize/entrar">
      ${escondido('client_id', d.clientId)}
      ${escondido('redirect_uri', d.redirectUri)}
      ${escondido('state', d.state)}
      ${escondido('code_challenge', d.codeChallenge)}
      ${escondido('scope', d.escopos.join(' '))}
      ${escondido('resource', d.recurso)}
      <label for="email">E-mail</label>
      <input id="email" name="email" type="email" autocomplete="username" inputmode="email" required value="${esc(opcoes.email)}">
      <label for="senha">Senha</label>
      <input id="senha" name="senha" type="password" autocomplete="current-password" required>
      <button type="submit">Entrar e permitir</button>
    </form>
    <p class="rodape">Ainda não tem conta? Crie pelo app no celular e volte aqui.</p>
  </div>
</main>
</body>
</html>`);
}

/** POST /authorize/entrar: confere e-mail e senha no Supabase Auth e devolve o código ao Claude */
export function rotaEntrar(opcoes: { provider: ProvedorOAuth; supabaseUrl: string; supabaseAnonKey: string }): Router {
  const router = express.Router();
  router.post(
    '/authorize/entrar',
    express.urlencoded({ extended: false, limit: '20kb' }),
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }),
    async (req: Request, res: Response) => {
      const b = (req.body ?? {}) as Record<string, string | undefined>;
      const email = String(b.email ?? '').trim();
      const senha = String(b.senha ?? '');

      // não confia nos campos escondidos: cliente e redirect_uri são conferidos de novo
      const cliente = b.client_id ? await opcoes.provider.clientsStore.getClient(b.client_id) : undefined;
      const redirectUri = String(b.redirect_uri ?? '');
      if (!cliente || !cliente.redirect_uris.some((r) => redirectUriMatches(redirectUri, String(r))) || !b.code_challenge) {
        res.status(400).type('text/plain; charset=utf-8').send('Pedido de autorização inválido. Volte ao Claude e tente conectar de novo.');
        return;
      }
      const dados: DadosAutorizacao = {
        clientId: cliente.client_id,
        nomeCliente: cliente.client_name,
        redirectUri,
        state: b.state || undefined,
        codeChallenge: b.code_challenge,
        escopos: (b.scope ?? '').split(' ').filter(Boolean),
        recurso: b.resource || undefined,
      };

      if (!email || !senha) {
        paginaLogin(res, dados, { erro: 'Preencha o e-mail e a senha.', email, status: 400 });
        return;
      }
      const auth = createClient(opcoes.supabaseUrl, opcoes.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await auth.auth.signInWithPassword({ email, password: senha });
      if (error || !data.user) {
        const msg = /confirm/i.test(error?.message ?? '')
          ? 'Confirme o seu e-mail antes (veja a mensagem que o Supabase enviou).'
          : 'E-mail ou senha incorretos.';
        paginaLogin(res, dados, { erro: msg, email, status: 401 });
        return;
      }
      // a sessão do Supabase não é usada daqui para frente (o Claude recebe tokens deste servidor).
      // scope local: encerra só esta sessão, sem derrubar o login do app no celular
      void auth.auth.signOut({ scope: 'local' }).catch(() => undefined);

      try {
        const codigo = await opcoes.provider.criarCodigo({
          clientId: dados.clientId,
          userId: data.user.id,
          codeChallenge: dados.codeChallenge,
          redirectUri: dados.redirectUri,
          escopos: dados.escopos,
          recurso: dados.recurso,
        });
        const volta = new URL(dados.redirectUri);
        volta.searchParams.set('code', codigo);
        if (dados.state) volta.searchParams.set('state', dados.state);
        res.redirect(302, volta.href);
      } catch (e) {
        console.error(e);
        paginaLogin(res, dados, { erro: 'Não foi possível concluir agora. Tente de novo.', email, status: 500 });
      }
    }
  );
  return router;
}
