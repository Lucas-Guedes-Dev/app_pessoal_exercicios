import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

// Login do app (Supabase Auth, e-mail e senha). A sessão fica salva no aparelho e é renovada
// sozinha. O usuário do último login também fica salvo, para o app abrir mesmo sem internet.

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const USER_KEY = 'app_usuario';

export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
      })
    : null;

// Renova o token só com o app aberto (recomendação do Supabase para React Native)
if (supabase) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export function isAuthConfigured() {
  return !!supabase;
}

/** { id, email } do último login neste aparelho, ou null */
export async function getSavedUser() {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function saveUser(user) {
  const saved = { id: user.id, email: user.email };
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(saved));
  return saved;
}

function translate(error) {
  const msg = String(error?.message ?? error ?? '');
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/already registered|already been registered|user_already_exists/i.test(msg)) {
    return 'Este e-mail já tem conta. Use "Entrar".';
  }
  if (/at least 6|weak_password|password should/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/email not confirmed/i.test(msg)) return 'Confirme o seu e-mail pelo link que chegou na sua caixa de entrada.';
  if (/invalid.*email|unable to validate email/i.test(msg)) return 'Confira o e-mail digitado.';
  if (/network|fetch|timeout|failed to fetch/i.test(msg)) {
    return 'Sem conexão. Para entrar pela primeira vez é preciso estar com internet.';
  }
  return msg || 'Não foi possível entrar agora. Tente de novo.';
}

function requireClient() {
  if (!supabase) throw new Error('App sem configuração do Supabase (.env).');
  return supabase;
}

export async function signIn(email, password) {
  const { data, error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.user) throw new Error(translate(error));
  return saveUser(data.user);
}

export async function signUp(email, password) {
  const { data, error } = await requireClient().auth.signUp({ email: email.trim(), password });
  if (error) throw new Error(translate(error));
  // com "Confirm email" ligado no Supabase, a conta nasce sem sessão
  if (!data.session || !data.user) {
    throw new Error('Conta criada! Confirme o e-mail pelo link que chegou na sua caixa de entrada e depois toque em "Entrar".');
  }
  return saveUser(data.user);
}

/** Sai só deste aparelho (não derruba o conector do Claude nem outros aparelhos) */
export async function signOut() {
  await supabase?.auth.signOut({ scope: 'local' }).catch(() => {});
  await AsyncStorage.removeItem(USER_KEY);
}

/** JWT do usuário para as chamadas ao Supabase (renovado pelo supabase-js); null sem login/sem rede */
export async function getAccessToken() {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
