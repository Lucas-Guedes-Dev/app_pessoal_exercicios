import {
  applyRemoteExercises,
  currentDbOwner,
  getCurrentWeek,
  getExercise,
  getSetting,
  linkExerciseToRemote,
  setCurrentWeekLetter,
  setSetting,
  setWeekCount,
} from '../db/database';
import { parseDateKey, startOfWeek, toDateKey } from '../utils/dates';
import { WEEK_LETTERS, shiftLetter } from '../utils/weeks';
import { rescheduleRemindersIfAllowed } from '../notifications';
import { isSyncConfigured, request } from './supabase';
import { syncFood } from './food-sync';

export { isSyncConfigured };

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
  // Alimentação em paralelo, com os próprios avisos (onFoodSynced); nunca lança erro
  const food = syncFood();
  try {
    return await syncExercisesAndCycle();
  } finally {
    await food;
  }
}

async function syncExercisesAndCycle() {
  const as = currentDbOwner();
  if (!as) return { ok: false, reason: 'no-account' };
  try {
    const rows = await request(
      'exercicios?select=id,nome,quantidade,descricao,dia_semana,semanas,deletado&order=criado_em',
      { as }
    );
    let changed = await applyRemoteExercises(rows.map(toLocal));
    changed += await syncCycle(as).catch((e) => {
      console.log('Ciclo não sincronizado:', String(e));
      return 0;
    });
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
    as: currentDbOwner(),
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

// ---------- Ciclo de semanas ----------
// Tabela "ciclo" no Supabase (uma linha por usuário). O Claude muda pelo MCP; a tela "Semanas"
// do app também grava lá (pushCycle). Guardamos o atualizado_em da última versão aplicada/enviada
// para não reaplicar a mesma configuração a cada sincronização.

const CYCLE_SYNC_KEY = 'ciclo_sync_at';

function weeksBetween(fromKey, toKey) {
  const ms = parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime();
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
}

/** Aplica no SQLite a configuração de ciclo do Supabase. Retorna 1 se mudou algo. */
async function syncCycle(as) {
  const [remote] = await request('ciclo?select=semanas,semana_atual,semana_inicio,atualizado_em', { as });
  if (!remote) return 0;
  if ((await getSetting(CYCLE_SYNC_KEY)) === remote.atualizado_em) return 0;

  let changed = 0;
  const before = await getCurrentWeek();
  if (remote.semanas !== before.count) {
    await setWeekCount(remote.semanas);
    changed = 1;
  }

  if (remote.semana_atual && remote.semana_inicio) {
    const currentStart = toDateKey(startOfWeek());
    const steps = weeksBetween(remote.semana_inicio, currentStart);
    if (steps >= 0 && WEEK_LETTERS.indexOf(remote.semana_atual) < remote.semanas) {
      const letter = shiftLetter(remote.semana_atual, steps, remote.semanas);
      const now = await getCurrentWeek();
      if (letter !== now.letter) {
        await setCurrentWeekLetter(letter);
        changed = 1;
      }
    }
  }

  await setSetting(CYCLE_SYNC_KEY, remote.atualizado_em);
  return changed;
}

/**
 * Envia para o Supabase o ciclo configurado no app (quantidade de semanas e semana atual),
 * para o Claude enxergar a mesma configuração. Falhas não atrapalham o app.
 */
export async function pushCycle() {
  if (!isSyncConfigured()) return;
  const week = await getCurrentWeek();
  // uma linha por usuário: user_id vem do login (default auth.uid() no Supabase)
  const [saved] = await request('ciclo?on_conflict=user_id&select=atualizado_em', {
    as: currentDbOwner(),
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: { semanas: week.count, semana_atual: week.letter, semana_inicio: week.weekStart },
  });
  if (saved?.atualizado_em) await setSetting(CYCLE_SYNC_KEY, saved.atualizado_em);
}
