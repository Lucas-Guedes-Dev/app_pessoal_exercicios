import { currentDbOwner, getDb, getSetting, setSetting } from '../db/database';
import { normalize } from '../utils/text';
import { isSyncConfigured, request as supabaseRequest } from './supabase';

/*
 * Sincronização da alimentação com o Supabase, nos dois sentidos.
 *
 *   SQLite (app)                         Supabase
 *   foods (source 'custom')      ⇄       alimentos (fonte 'custom') — mesmo id numérico
 *   food_portions (custom = 1)   ⇄       alimento_porcoes (personalizada) — remote_id (uuid)
 *   food_entries                 ⇄       registros_alimentacao — remote_id (uuid)
 *
 * A base TACO fica embutida no app (foods.json) e não é sincronizada; favoritos são só locais.
 *
 * Cada rodada: 1) baixa o que mudou no Supabase desde o último cursor (atualizado_em, id) e
 * aplica: a alteração mais recente vence (updated_at local × atualizado_em remoto), "deletado"
 * apaga a linha local; 2) envia a fila de exclusões (sync_deletions) como soft delete;
 * 3) envia as linhas locais com dirty = 1 (upsert pelo id: reenviar não duplica).
 * Sem internet nada é perdido: dirty e a fila continuam para a próxima rodada.
 */

const PAGE = 500;
const PUSH_BATCH = 200;
const DEBOUNCE_MS = 3000;

const TABLES = {
  foods: 'alimentos',
  portions: 'alimento_porcoes',
  entries: 'registros_alimentacao',
};

// ---------- avisos para as telas ----------

const listeners = new Set();

/** Chama `fn` quando a sincronização trouxer mudanças de alimentação. Retorna a função para cancelar. */
export function onFoodSynced(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- disparo ----------

let running = null;
let again = false;
let timer = null;

/**
 * Sincroniza a alimentação. Nunca lança erro. Chamadas durante uma rodada em andamento
 * esperam por ela e garantem mais uma rodada no fim (para enviar o que mudou nesse meio tempo).
 */
export function syncFood() {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let result;
    do {
      again = false;
      result = await runOnce();
    } while (again && result.ok);
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Pede uma sincronização daqui a alguns segundos (agrupa várias alterações seguidas). */
export function requestFoodSync() {
  if (!isSyncConfigured()) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    syncFood();
  }, DEBOUNCE_MS);
}

// Conta dona do banco nesta rodada: toda chamada usa o token dela (ver request em supabase.js)
let runOwner = null;
const request = (path, options = {}) => supabaseRequest(path, { ...options, as: runOwner });

async function runOnce() {
  if (!isSyncConfigured()) return { ok: false, reason: 'not-configured' };
  runOwner = currentDbOwner();
  if (!runOwner) return { ok: false, reason: 'no-account' };
  try {
    const db = await getDb();
    let changed = 0;
    // ordem por causa das chaves estrangeiras: alimentos → medidas → registros
    changed += await pull(db, TABLES.foods, FOOD_COLS, '&fonte=eq.custom', applyFood);
    changed += await pull(db, TABLES.portions, PORTION_COLS, '&personalizada=is.true', applyPortion);
    changed += await pull(db, TABLES.entries, ENTRY_COLS, '', applyEntry);
    await pushDeletions(db);
    await pushFoods(db);
    await pushPortions(db);
    await pushEntries(db);
    if (changed > 0) listeners.forEach((fn) => fn());
    return { ok: true, changed };
  } catch (e) {
    console.log('Alimentação não sincronizada (seguindo com os dados locais):', String(e));
    return { ok: false, reason: 'error', error: e };
  }
}

// ---------- utilitários ----------

const FOOD_COLS = 'id,nome,categoria,kcal,proteina,carbo,gordura,fibra,deletado,atualizado_em';
const PORTION_COLS = 'id,alimento_id,rotulo,gramas,deletado,atualizado_em';
const ENTRY_COLS =
  'id,data,refeicao,alimento_id,nome,gramas,porcao_rotulo,porcao_qtd,kcal,proteina,carbo,gordura,deletado,criado_em,atualizado_em';

const num = (v) => (v == null ? null : Number(v));

// "2026-09-30 14:05:09" (localtime, formato do SQLite) ⇄ ISO do Supabase
function localToIso(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value ?? '');
  if (!m) return new Date().toISOString();
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi, s).toISOString();
}
function isoToLocal(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function isQueuedForDeletion(db, tabela, remoteId) {
  return !!(await db.getFirstAsync(
    'SELECT 1 AS x FROM sync_deletions WHERE tabela = ? AND remote_id = ?',
    tabela,
    String(remoteId)
  ));
}

/** A versão local vence se foi alterada no aparelho depois da versão remota. */
const localWins = (local, remoteUpdatedAt) =>
  !!local && local.dirty === 1 && (local.updated_at ?? 0) > Date.parse(remoteUpdatedAt);

const differs = (a, b, keys) => keys.some((k) => a[k] !== b[k]);

// ---------- baixar (Supabase → SQLite) ----------

/** Lê as páginas alteradas desde o cursor (atualizado_em, id) e aplica cada linha. */
async function pull(db, table, cols, filter, apply) {
  const key = `sync_cursor_${table}`;
  let cursor = JSON.parse((await getSetting(key)) ?? 'null');
  let changed = 0;
  for (;;) {
    const after = cursor
      ? `&or=${encodeURIComponent(
          `(atualizado_em.gt."${cursor.at}",and(atualizado_em.eq."${cursor.at}",id.gt."${cursor.id}"))`
        )}`
      : '';
    const rows = await request(`${table}?select=${cols}${filter}${after}&order=atualizado_em.asc,id.asc&limit=${PAGE}`);
    for (const row of rows) changed += await apply(db, row);
    if (rows.length > 0) {
      const last = rows[rows.length - 1];
      cursor = { at: last.atualizado_em, id: last.id };
      await setSetting(key, JSON.stringify(cursor));
    }
    if (rows.length < PAGE) return changed;
  }
}

async function applyFood(db, r) {
  const id = Number(r.id);
  if (await isQueuedForDeletion(db, TABLES.foods, id)) return 0;
  const local = await db.getFirstAsync(
    "SELECT id, name, kcal, protein, carbs, fat, fiber, dirty, updated_at FROM foods WHERE id = ? AND source = 'custom'",
    id
  );
  if (localWins(local, r.atualizado_em)) return 0;
  const updatedAt = Date.parse(r.atualizado_em);

  if (r.deletado) {
    if (!local) return 0;
    await db.runAsync("DELETE FROM foods WHERE id = ? AND source = 'custom'", id);
    return 1;
  }
  const next = {
    name: r.nome,
    kcal: num(r.kcal),
    protein: num(r.proteina),
    carbs: num(r.carbo),
    fat: num(r.gordura),
    fiber: num(r.fibra),
  };
  if (!local) {
    await db.runAsync(
      `INSERT INTO foods (id, name, search, category, kcal, protein, carbs, fat, fiber, source, updated_at, dirty)
       VALUES (?, ?, ?, 'Meus alimentos', ?, ?, ?, ?, ?, 'custom', ?, 0)`,
      id,
      next.name,
      normalize(next.name),
      next.kcal,
      next.protein,
      next.carbs,
      next.fat,
      next.fiber,
      updatedAt
    );
    return 1;
  }
  if (!differs(local, next, Object.keys(next))) {
    if (local.dirty) await db.runAsync('UPDATE foods SET dirty = 0 WHERE id = ?', id);
    return 0;
  }
  await db.runAsync(
    `UPDATE foods SET name = ?, search = ?, kcal = ?, protein = ?, carbs = ?, fat = ?, fiber = ?,
            updated_at = ?, dirty = 0
      WHERE id = ?`,
    next.name,
    normalize(next.name),
    next.kcal,
    next.protein,
    next.carbs,
    next.fat,
    next.fiber,
    updatedAt,
    id
  );
  return 1;
}

async function applyPortion(db, r) {
  if (await isQueuedForDeletion(db, TABLES.portions, r.id)) return 0;
  const local = await db.getFirstAsync(
    'SELECT id, food_id, label, grams, dirty, updated_at FROM food_portions WHERE remote_id = ?',
    r.id
  );
  if (localWins(local, r.atualizado_em)) return 0;
  const updatedAt = Date.parse(r.atualizado_em);

  if (r.deletado) {
    if (!local) return 0;
    await db.runAsync('DELETE FROM food_portions WHERE id = ?', local.id);
    return 1;
  }
  const next = { label: r.rotulo, grams: num(r.gramas) };
  if (!local) {
    const food = await db.getFirstAsync('SELECT id FROM foods WHERE id = ?', Number(r.alimento_id));
    if (!food) return 0; // alimento removido ou ainda não baixado
    await db.runAsync(
      `INSERT INTO food_portions (food_id, label, grams, custom, remote_id, updated_at, dirty)
       VALUES (?, ?, ?, 1, ?, ?, 0)`,
      food.id,
      next.label,
      next.grams,
      r.id,
      updatedAt
    );
    return 1;
  }
  if (!differs(local, next, Object.keys(next))) {
    if (local.dirty) await db.runAsync('UPDATE food_portions SET dirty = 0 WHERE id = ?', local.id);
    return 0;
  }
  await db.runAsync(
    'UPDATE food_portions SET label = ?, grams = ?, updated_at = ?, dirty = 0 WHERE id = ?',
    next.label,
    next.grams,
    updatedAt,
    local.id
  );
  return 1;
}

async function applyEntry(db, r) {
  if (await isQueuedForDeletion(db, TABLES.entries, r.id)) return 0;
  const local = await db.getFirstAsync(
    `SELECT id, date, meal, food_id, name, grams, portion_label, portion_qty, kcal, protein, carbs, fat,
            dirty, updated_at
       FROM food_entries WHERE remote_id = ?`,
    r.id
  );
  if (localWins(local, r.atualizado_em)) return 0;
  const updatedAt = Date.parse(r.atualizado_em);

  if (r.deletado) {
    if (!local) return 0;
    await db.runAsync('DELETE FROM food_entries WHERE id = ?', local.id);
    return 1;
  }
  // o alimento pode ter sido removido: o registro fica, sem o vínculo (como no app)
  const foodId =
    r.alimento_id != null && (await db.getFirstAsync('SELECT id FROM foods WHERE id = ?', Number(r.alimento_id)))
      ? Number(r.alimento_id)
      : null;
  const next = {
    date: r.data,
    meal: r.refeicao,
    food_id: foodId,
    name: r.nome,
    grams: num(r.gramas),
    portion_label: r.porcao_rotulo ?? null,
    portion_qty: num(r.porcao_qtd),
    kcal: num(r.kcal),
    protein: num(r.proteina),
    carbs: num(r.carbo),
    fat: num(r.gordura),
  };
  if (!local) {
    await db.runAsync(
      `INSERT INTO food_entries (date, meal, food_id, name, grams, portion_label, portion_qty, kcal, protein, carbs, fat,
                                 created_at, remote_id, updated_at, dirty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      ...Object.values(next),
      isoToLocal(r.criado_em),
      r.id,
      updatedAt
    );
    return 1;
  }
  if (!differs(local, next, Object.keys(next))) {
    if (local.dirty) await db.runAsync('UPDATE food_entries SET dirty = 0 WHERE id = ?', local.id);
    return 0;
  }
  await db.runAsync(
    `UPDATE food_entries SET date = ?, meal = ?, food_id = ?, name = ?, grams = ?, portion_label = ?,
            portion_qty = ?, kcal = ?, protein = ?, carbs = ?, fat = ?, updated_at = ?, dirty = 0
      WHERE id = ?`,
    ...Object.values(next),
    updatedAt,
    local.id
  );
  return 1;
}

// ---------- enviar (SQLite → Supabase) ----------

async function pushDeletions(db) {
  const rows = await db.getAllAsync('SELECT tabela, remote_id FROM sync_deletions ORDER BY tabela');
  const guard = {
    [TABLES.foods]: '&fonte=eq.custom',
    [TABLES.portions]: '&personalizada=is.true',
    [TABLES.entries]: '',
  };
  for (const tabela of Object.keys(guard)) {
    const ids = rows.filter((r) => r.tabela === tabela).map((r) => r.remote_id);
    for (let i = 0; i < ids.length; i += PUSH_BATCH) {
      const chunk = ids.slice(i, i + PUSH_BATCH);
      await request(`${tabela}?id=in.(${chunk.join(',')})${guard[tabela]}`, {
        method: 'PATCH',
        body: { deletado: true },
        prefer: 'return=minimal',
      });
      for (const id of chunk) {
        await db.runAsync('DELETE FROM sync_deletions WHERE tabela = ? AND remote_id = ?', tabela, id);
      }
    }
  }
}

/** Envia em lotes as linhas dirty e limpa o dirty só se nada mudou durante o envio. */
async function pushDirty(db, { select, table, toRemote, clear }) {
  for (;;) {
    const rows = await db.getAllAsync(`${select} LIMIT ${PUSH_BATCH}`);
    if (rows.length === 0) return;
    await request(`${table}?on_conflict=id`, {
      method: 'POST',
      body: rows.map(toRemote),
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    let cleared = 0;
    for (const row of rows) {
      const res = await db.runAsync(clear, row.id, row.updated_at);
      cleared += res.changes;
    }
    if (cleared === 0) return; // tudo foi alterado de novo durante o envio: fica para a próxima rodada
  }
}

function pushFoods(db) {
  return pushDirty(db, {
    table: TABLES.foods,
    select: "SELECT * FROM foods WHERE dirty = 1 AND source = 'custom' ORDER BY id",
    toRemote: (f) => ({
      id: f.id,
      nome: f.name,
      busca: normalize(f.name),
      categoria: f.category ?? 'Meus alimentos',
      kcal: f.kcal,
      proteina: f.protein,
      carbo: f.carbs,
      gordura: f.fat,
      fibra: f.fiber ?? 0,
      fonte: 'custom',
      comum: false,
      deletado: false,
    }),
    clear: 'UPDATE foods SET dirty = 0 WHERE id = ? AND updated_at IS ?',
  });
}

function pushPortions(db) {
  return pushDirty(db, {
    table: TABLES.portions,
    select: 'SELECT * FROM food_portions WHERE dirty = 1 AND custom = 1 ORDER BY id',
    toRemote: (p) => ({
      id: p.remote_id,
      alimento_id: p.food_id,
      rotulo: p.label,
      gramas: p.grams,
      personalizada: true,
      deletado: false,
    }),
    clear: 'UPDATE food_portions SET dirty = 0 WHERE id = ? AND updated_at IS ?',
  });
}

function pushEntries(db) {
  return pushDirty(db, {
    table: TABLES.entries,
    select: 'SELECT * FROM food_entries WHERE dirty = 1 ORDER BY id',
    toRemote: (e) => ({
      id: e.remote_id,
      data: e.date,
      refeicao: e.meal,
      alimento_id: e.food_id,
      nome: e.name,
      gramas: e.grams,
      porcao_rotulo: e.portion_label,
      porcao_qtd: e.portion_qty,
      kcal: e.kcal,
      proteina: e.protein,
      carbo: e.carbs,
      gordura: e.fat,
      criado_em: localToIso(e.created_at),
      deletado: false,
    }),
    clear: 'UPDATE food_entries SET dirty = 0 WHERE id = ? AND updated_at IS ?',
  });
}
