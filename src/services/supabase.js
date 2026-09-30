// Acesso ao Supabase (PostgREST) usado pelas sincronizações do app.

// Chaves do .env (EXPO_PUBLIC_ vão embutidas no app na hora do build)
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const TIMEOUT_MS = 10000;

export function isSyncConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Só o header apikey: funciona com a chave anon (JWT) e com a publishable.
// Respostas sem corpo (upsert com return=minimal, 201/204) viram null.
export async function request(path, { method = 'GET', body, prefer } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: SUPABASE_ANON_KEY,
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
