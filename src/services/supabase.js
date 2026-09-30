// Acesso ao Supabase (PostgREST) usado pelas sincronizações do app, sempre como o usuário
// logado (JWT): o RLS garante que cada conta só lê e grava os próprios dados.
import { getAccessToken } from './auth';

// Chaves do .env (EXPO_PUBLIC_ vão embutidas no app na hora do build)
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const TIMEOUT_MS = 10000;

export function isSyncConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// "sub" do JWT = id do usuário (base64url, sem depender de atob/Buffer)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function jwtSubject(token) {
  try {
    const part = token.split('.')[1];
    let bits = 0;
    let value = 0;
    let json = '';
    for (const ch of part) {
      value = (value << 6) | B64.indexOf(ch);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        json += String.fromCharCode((value >> bits) & 0xff);
      }
    }
    return JSON.parse(json).sub ?? null; // sub é um uuid (ASCII)
  } catch {
    return null;
  }
}

/**
 * apikey (anon/publishable) + Authorization com o JWT do usuário.
 * `as` é a conta dona dos dados locais que a chamada lê ou envia: se o token for de outra
 * conta (trocou de conta no meio de uma sincronização), a chamada é recusada.
 * Respostas sem corpo (upsert com return=minimal, 201/204) viram null.
 */
export async function request(path, { method = 'GET', body, prefer, as } = {}) {
  if (!as) throw new Error('request sem a conta dona dos dados (as).');
  const token = await getAccessToken();
  if (!token) throw new Error('Sem login válido (entre de novo ou aguarde a internet).');
  if (jwtSubject(token) !== as) throw new Error('A conta mudou durante a sincronização; ela será refeita.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Supabase respondeu ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}
