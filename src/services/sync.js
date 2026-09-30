import { applyRemoteExercises, getExercise, linkExerciseToRemote } from '../db/database';
import { rescheduleRemindersIfAllowed } from '../notifications';

// Chaves do .env (EXPO_PUBLIC_ vão embutidas no app na hora do build)
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const TIMEOUT_MS = 10000;

export function isSyncConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// PostgREST do Supabase. Só o header apikey: funciona com a chave anon (JWT) e com a publishable.
async function request(path, { method = 'GET', body, prefer } = {}) {
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
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Conversão entre o Supabase e o SQLite ----------

// No app, quantidade e descrição ficam juntas em "details", no padrão "X · Y" do plano inicial
function toLocal(r) {
  return {
    remoteId: r.id,
    deleted: !!r.deletado,
    name: r.nome,
    details: r.descricao ? `${r.quantidade} · ${r.descricao}` : r.quantidade,
    days: r.dia_semana,
    weeks: r.semanas,
  };
}

// "Força A (pernas/explosão) · 3x15-20" → quantidade "3x15-20", descrição "Força A (pernas/explosão)"
function splitDetails(details) {
  const parts = (details ?? '').split(' · ').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return { quantidade: parts[parts.length - 1], descricao: parts.slice(0, -1).join(' · ') || null };
}

// ---------- Avisos para as telas recarregarem ----------

const listeners = new Set();

/** Chama `fn` sempre que uma sincronização alterar exercícios. Retorna a função para cancelar. */
export function onExercisesSynced(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- Sincronização ----------

let running = null;

/**
 * Busca os exercícios no Supabase e aplica no SQLite (upsert + remoção dos deletados).
 * Nunca lança erro: sem internet ou sem configuração, o app segue com o que já tem.
 * Chamadas simultâneas compartilham a mesma execução.
 */
export function syncExercises() {
  if (!running) {
    running = doSync().finally(() => {
      running = null;
    });
  }
  return running;
}

async function doSync() {
  if (!isSyncConfigured()) return { ok: false, reason: 'not-configured' };
  try {
    const rows = await request(
      'exercicios?select=id,nome,quantidade,descricao,dia_semana,semanas,deletado&order=criado_em'
    );
    const changed = await applyRemoteExercises(rows.map(toLocal));
    await rescheduleRemindersIfAllowed().catch((e) => console.warn('Falha ao reagendar lembretes:', e));
    if (changed > 0) listeners.forEach((fn) => fn());
    return { ok: true, changed };
  } catch (e) {
    console.log('Sincronização não concluída (seguindo com os dados locais):', String(e));
    return { ok: false, reason: 'error', error: e };
  }
}

/**
 * Envia um exercício criado no app para o Supabase. Depois disso ele passa a ser
 * gerenciado pelo Claude e atualizado pela sincronização. O id local e o histórico
 * de feito/não feito continuam os mesmos.
 */
export async function pushExercise(id) {
  if (!isSyncConfigured()) {
    throw new Error('Supabase não configurado. Preencha EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY no .env.');
  }
  const ex = await getExercise(id);
  if (!ex) throw new Error('Exercício não encontrado.');
  if (ex.remote_id) return ex.remote_id;

  const split = splitDetails(ex.details);
  if (!split) throw new Error('Preencha os detalhes com a quantidade (ex.: 3x15) antes de enviar.');

  const [created] = await request('exercicios?select=id,nome,quantidade,descricao,dia_semana,semanas,deletado', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      nome: ex.name,
      quantidade: split.quantidade,
      descricao: split.descricao,
      dia_semana: ex.days,
      semanas: ex.weeks,
    },
  });
  await linkExerciseToRemote(id, created.id, toLocal(created).details);
  listeners.forEach((fn) => fn());
  return created.id;
}
