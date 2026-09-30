import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidGrantError, InvalidTargetError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { paginaLogin } from './login.js';

/*
 * Servidor de autorização OAuth 2.1 do próprio MCP (DCR + authorization code com PKCE +
 * refresh token rotativo). Os tokens são do servidor (opacos e aleatórios), não o JWT do
 * Supabase: valem só aqui, têm validade própria e podem ser revogados. Tudo fica no Supabase
 * (tabelas oauth_*, só service_role), porque o Render reinicia sem memória; tokens e códigos
 * são guardados apenas como hash sha256.
 */

export type OpcoesOAuth = {
  supabase: SupabaseClient; // service_role
  recurso: URL; // URL do endpoint MCP (audience dos tokens)
  validadeAcesso: number; // segundos
  validadeRefresh: number; // segundos
  validadeCodigo: number; // segundos
};

const hash = (valor: string) => createHash('sha256').update(valor).digest('hex');
const aleatorio = (prefixo: string) => `${prefixo}_${randomBytes(32).toString('base64url')}`;
const agora = () => new Date().toISOString();
const daqui = (segundos: number) => new Date(Date.now() + segundos * 1000).toISOString();

export class ProvedorOAuth implements OAuthServerProvider {
  constructor(private readonly op: OpcoesOAuth) {}

  private get db() {
    return this.op.supabase;
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId: string) => {
        const { data, error } = await this.db.from('oauth_clientes').select('dados').eq('client_id', clientId).maybeSingle();
        if (error) throw new Error(`Erro ao ler cliente OAuth: ${error.message}`);
        return (data?.dados as OAuthClientInformationFull | undefined) ?? undefined;
      },
      // o SDK já gera client_id (e client_secret, se for cliente confidencial) antes de chamar
      registerClient: async (cliente) => {
        const completo = {
          ...cliente,
          client_id: (cliente as OAuthClientInformationFull).client_id ?? randomUUID(),
          client_id_issued_at: (cliente as OAuthClientInformationFull).client_id_issued_at ?? Math.floor(Date.now() / 1000),
        } as OAuthClientInformationFull;
        const { error } = await this.db.from('oauth_clientes').insert({ client_id: completo.client_id, dados: completo });
        if (error) throw new Error(`Erro ao registrar cliente OAuth: ${error.message}`);
        return completo;
      },
    };
  }

  /** Mostra a tela de login; o POST dela é tratado por rotaEntrar (login.ts) */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (params.resource && params.resource.href !== this.op.recurso.href) {
      throw new InvalidTargetError(`Recurso desconhecido: ${params.resource.href}`);
    }
    paginaLogin(res, {
      clientId: client.client_id,
      nomeCliente: client.client_name,
      redirectUri: params.redirectUri,
      state: params.state,
      codeChallenge: params.codeChallenge,
      escopos: params.scopes ?? [],
      recurso: params.resource?.href,
    });
  }

  /** Chamado pela tela de login depois que e-mail e senha conferem */
  async criarCodigo(dados: {
    clientId: string;
    userId: string;
    codeChallenge: string;
    redirectUri: string;
    escopos: string[];
    recurso?: string;
  }): Promise<string> {
    const codigo = aleatorio('mcp_cod');
    const { error } = await this.db.from('oauth_codigos').insert({
      codigo_hash: hash(codigo),
      client_id: dados.clientId,
      user_id: dados.userId,
      code_challenge: dados.codeChallenge,
      redirect_uri: dados.redirectUri,
      escopos: dados.escopos,
      recurso: dados.recurso ?? null,
      expira_em: daqui(this.op.validadeCodigo),
    });
    if (error) throw new Error(`Erro ao criar código de autorização: ${error.message}`);
    return codigo;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, codigo: string): Promise<string> {
    const { data, error } = await this.db
      .from('oauth_codigos')
      .select('code_challenge')
      .eq('codigo_hash', hash(codigo))
      .eq('client_id', client.client_id)
      .is('usado_em', null)
      .gt('expira_em', agora())
      .maybeSingle();
    if (error) throw new Error(`Erro ao ler código: ${error.message}`);
    if (!data) throw new InvalidGrantError('Código de autorização inválido ou expirado');
    return data.code_challenge as string;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    codigo: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    // marca como usado numa única instrução: o mesmo código nunca gera dois tokens
    const { data, error } = await this.db
      .from('oauth_codigos')
      .update({ usado_em: agora() })
      .eq('codigo_hash', hash(codigo))
      .eq('client_id', client.client_id)
      .is('usado_em', null)
      .gt('expira_em', agora())
      .select('user_id, redirect_uri, escopos, recurso');
    if (error) throw new Error(`Erro ao usar código: ${error.message}`);
    const row = data?.[0];
    if (!row) throw new InvalidGrantError('Código de autorização inválido, expirado ou já usado');
    if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
      throw new InvalidGrantError('redirect_uri diferente do usado na autorização');
    }
    if (resource && row.recurso && resource.href !== row.recurso) {
      throw new InvalidTargetError('resource diferente do usado na autorização');
    }
    this.limparVencidos();
    return this.emitirTokens(client.client_id, row.user_id as string, row.escopos as string[], row.recurso as string | null);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    _scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    // rotação: o refresh antigo é revogado na mesma instrução em que é validado
    const { data, error } = await this.db
      .from('oauth_tokens')
      .update({ revogado_em: agora() })
      .eq('token_hash', hash(refreshToken))
      .eq('tipo', 'refresh')
      .eq('client_id', client.client_id)
      .is('revogado_em', null)
      .gt('expira_em', agora())
      .select('user_id, escopos, recurso');
    if (error) throw new Error(`Erro ao usar refresh token: ${error.message}`);
    const row = data?.[0];
    if (!row) throw new InvalidGrantError('Refresh token inválido, expirado ou já usado');
    if (resource && row.recurso && resource.href !== row.recurso) {
      throw new InvalidTargetError('resource diferente do autorizado');
    }
    return this.emitirTokens(client.client_id, row.user_id as string, row.escopos as string[], row.recurso as string | null);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const { data, error } = await this.db
      .from('oauth_tokens')
      .select('client_id, user_id, escopos, recurso, expira_em, revogado_em')
      .eq('token_hash', hash(token))
      .eq('tipo', 'access')
      .maybeSingle();
    if (error) throw new Error(`Erro ao validar token: ${error.message}`);
    if (!data || data.revogado_em) throw new InvalidTokenError('Token inválido');
    if (data.recurso && data.recurso !== this.op.recurso.href) throw new InvalidTokenError('Token de outro recurso');
    const expiresAt = Math.floor(Date.parse(data.expira_em as string) / 1000);
    if (expiresAt * 1000 <= Date.now()) throw new InvalidTokenError('Token expirado');
    return {
      token,
      clientId: data.client_id as string,
      scopes: (data.escopos as string[]) ?? [],
      expiresAt,
      resource: this.op.recurso,
      extra: { userId: data.user_id as string },
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    await this.db
      .from('oauth_tokens')
      .update({ revogado_em: agora() })
      .eq('token_hash', hash(request.token))
      .eq('client_id', client.client_id)
      .is('revogado_em', null);
  }

  private async emitirTokens(clientId: string, userId: string, escopos: string[], recurso: string | null): Promise<OAuthTokens> {
    const acesso = aleatorio('mcp_at');
    const refresh = aleatorio('mcp_rt');
    const base = { client_id: clientId, user_id: userId, escopos, recurso };
    const { error } = await this.db.from('oauth_tokens').insert([
      { ...base, token_hash: hash(acesso), tipo: 'access', expira_em: daqui(this.op.validadeAcesso) },
      { ...base, token_hash: hash(refresh), tipo: 'refresh', expira_em: daqui(this.op.validadeRefresh) },
    ]);
    if (error) throw new Error(`Erro ao emitir tokens: ${error.message}`);
    return {
      access_token: acesso,
      token_type: 'Bearer',
      expires_in: this.op.validadeAcesso,
      refresh_token: refresh,
      scope: escopos.join(' ') || undefined,
    };
  }

  /** Apaga códigos e tokens vencidos há mais de um dia (sem esperar o resultado) */
  private limparVencidos() {
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    void this.db.from('oauth_codigos').delete().lt('expira_em', ontem).then(() => undefined);
    void this.db.from('oauth_tokens').delete().lt('expira_em', ontem).then(() => undefined);
  }
}
