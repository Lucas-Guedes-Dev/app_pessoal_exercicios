import { UUID_SQL, getDb } from './database';
import { nutrientsFor } from '../utils/food';
import { normalize } from '../utils/text';
import { requestFoodSync } from '../services/food-sync';

// Alimentos próprios criados no app: 100000–999999. Os criados pelo Claude (Supabase)
// começam em 1000000, então os dois lados nunca geram o mesmo id.
const CUSTOM_ID_START = 100000;
const CUSTOM_ID_END = 999999;

// Exclusão local: apaga a linha e guarda o id para virar "deletado" no Supabase
async function queueDeletion(db, tabela, remoteId) {
  if (remoteId == null) return;
  await db.runAsync('INSERT OR IGNORE INTO sync_deletions (tabela, remote_id) VALUES (?, ?)', tabela, String(remoteId));
}
const FOOD_COLUMNS = 'id, name, category, kcal, protein, carbs, fat, fiber, source, favorite';

// ---------- busca ----------

/**
 * Busca sem acento, por todas as palavras digitadas ("feijao cozido").
 * Favoritos e alimentos usados recentemente vêm primeiro.
 */
export async function searchFoods(query, limit = 60) {
  const db = await getDb();
  const terms = normalize(query).split(/[\s,]+/).filter(Boolean);
  if (terms.length === 0) return getFrequentFoods(limit);

  const where = terms.map(() => 'f.search LIKE ?').join(' AND ');
  return db.getAllAsync(
    `SELECT ${FOOD_COLUMNS.split(', ').map((c) => `f.${c}`).join(', ')},
            (SELECT MAX(e.created_at) FROM food_entries e WHERE e.food_id = f.id) AS last_used
       FROM foods f
      WHERE ${where}
      ORDER BY f.favorite DESC,
               last_used IS NULL, last_used DESC,
               f.common DESC,
               f.search LIKE ? DESC,
               length(f.name)
      LIMIT ?`,
    ...terms.map((t) => `%${t}%`),
    `${terms[0]}%`,
    limit
  );
}

/** Favoritos e os mais usados nos últimos 60 dias: a lista que aparece antes de digitar. */
export async function getFrequentFoods(limit = 40) {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT ${FOOD_COLUMNS.split(', ').map((c) => `f.${c}`).join(', ')},
            COUNT(e.id) AS uses, MAX(e.created_at) AS last_used
       FROM foods f
       LEFT JOIN food_entries e ON e.food_id = f.id AND e.date >= date('now', 'localtime', '-60 days')
      GROUP BY f.id
     HAVING f.favorite = 1 OR COUNT(e.id) > 0
      ORDER BY f.favorite DESC, uses DESC, last_used DESC
      LIMIT ?`,
    limit
  );
}

export async function getFood(id) {
  const db = await getDb();
  const food = await db.getFirstAsync(`SELECT ${FOOD_COLUMNS} FROM foods WHERE id = ?`, id);
  if (!food) return null;
  food.portions = await db.getAllAsync(
    'SELECT id, label, grams, custom FROM food_portions WHERE food_id = ? ORDER BY custom DESC, id',
    id
  );
  return food;
}

export async function toggleFavorite(id) {
  const db = await getDb();
  await db.runAsync('UPDATE foods SET favorite = 1 - favorite WHERE id = ?', id);
}

// ---------- medidas criadas pela pessoa ----------

export async function addPortion(foodId, label, grams) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO food_portions (food_id, label, grams, custom, remote_id, updated_at, dirty)
     VALUES (?, ?, ?, 1, ${UUID_SQL}, ?, 1)`,
    foodId,
    label,
    grams,
    Date.now()
  );
  requestFoodSync();
}

export async function deletePortion(id) {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT remote_id FROM food_portions WHERE id = ? AND custom = 1', id);
  if (!row) return;
  await queueDeletion(db, 'alimento_porcoes', row.remote_id);
  await db.runAsync('DELETE FROM food_portions WHERE id = ? AND custom = 1', id);
  requestFoodSync();
}

// ---------- alimentos personalizados ----------

/**
 * Salva um alimento próprio. Os valores podem vir de um rótulo "por porção"
 * (ex.: 30 g) — aqui são convertidos para 100 g, como o resto da base.
 */
export async function saveCustomFood({ id, name, baseGrams, portionLabel, kcal, protein, carbs, fat, fiber }) {
  const db = await getDb();
  const f = 100 / baseGrams;
  const values = [kcal * f, protein * f, carbs * f, fat * f, fiber * f];

  const now = Date.now();
  let foodId = id;
  if (foodId) {
    await db.runAsync(
      `UPDATE foods SET name = ?, search = ?, kcal = ?, protein = ?, carbs = ?, fat = ?, fiber = ?,
              updated_at = ?, dirty = 1
        WHERE id = ?`,
      name,
      normalize(name),
      ...values,
      now,
      foodId
    );
  } else {
    const row = await db.getFirstAsync(
      'SELECT MAX(id) AS maxId FROM foods WHERE id BETWEEN ? AND ?',
      CUSTOM_ID_START,
      CUSTOM_ID_END
    );
    foodId = Math.max(row?.maxId ?? 0, CUSTOM_ID_START - 1) + 1;
    await db.runAsync(
      `INSERT INTO foods (id, name, search, category, kcal, protein, carbs, fat, fiber, source, updated_at, dirty)
       VALUES (?, ?, ?, 'Meus alimentos', ?, ?, ?, ?, ?, 'custom', ?, 1)`,
      foodId,
      name,
      normalize(name),
      ...values,
      now
    );
  }

  // a porção do rótulo vira uma medida caseira (ex.: "scoop" = 30 g)
  if (portionLabel && baseGrams !== 100) {
    const exists = await db.getFirstAsync(
      'SELECT id FROM food_portions WHERE food_id = ? AND label = ?',
      foodId,
      portionLabel
    );
    if (exists) {
      await db.runAsync(
        'UPDATE food_portions SET grams = ?, updated_at = ?, dirty = 1 WHERE id = ?',
        baseGrams,
        now,
        exists.id
      );
    } else await addPortion(foodId, portionLabel, baseGrams);
  }
  requestFoodSync();
  return foodId;
}

export async function deleteCustomFood(id) {
  const db = await getDb();
  const row = await db.getFirstAsync("SELECT id FROM foods WHERE id = ? AND source = 'custom'", id);
  if (!row) return;
  await queueDeletion(db, 'alimentos', row.id);
  await db.runAsync("DELETE FROM foods WHERE id = ? AND source = 'custom'", id);
  requestFoodSync();
}

// ---------- registros do dia ----------

export async function getEntriesForDate(dateKey) {
  const db = await getDb();
  return db.getAllAsync('SELECT * FROM food_entries WHERE date = ? ORDER BY id', dateKey);
}

export async function getEntry(id) {
  const db = await getDb();
  return db.getFirstAsync('SELECT * FROM food_entries WHERE id = ?', id);
}

/** Registra (ou atualiza, com entryId) o que foi comido, copiando nome e valores. */
export async function saveEntry({ entryId, date, meal, food, grams, portionLabel, portionQty }) {
  const db = await getDb();
  const n = nutrientsFor(food, grams);
  const now = Date.now();
  if (entryId) {
    await db.runAsync(
      `UPDATE food_entries SET date = ?, meal = ?, grams = ?, portion_label = ?, portion_qty = ?,
              kcal = ?, protein = ?, carbs = ?, fat = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      date,
      meal,
      grams,
      portionLabel ?? null,
      portionQty ?? null,
      n.kcal,
      n.protein,
      n.carbs,
      n.fat,
      now,
      entryId
    );
    requestFoodSync();
    return;
  }
  await db.runAsync(
    `INSERT INTO food_entries (date, meal, food_id, name, grams, portion_label, portion_qty, kcal, protein, carbs, fat,
                               remote_id, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${UUID_SQL}, ?, 1)`,
    date,
    meal,
    food.id,
    food.name,
    grams,
    portionLabel ?? null,
    portionQty ?? null,
    n.kcal,
    n.protein,
    n.carbs,
    n.fat,
    now
  );
  requestFoodSync();
}

export async function deleteEntry(id) {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT remote_id FROM food_entries WHERE id = ?', id);
  if (!row) return;
  await queueDeletion(db, 'registros_alimentacao', row.remote_id);
  await db.runAsync('DELETE FROM food_entries WHERE id = ?', id);
  requestFoodSync();
}

/** Copia as refeições de um dia para outro (ex.: repetir o café de ontem). */
export async function copyMeal(fromDate, toDate, meal) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO food_entries (date, meal, food_id, name, grams, portion_label, portion_qty, kcal, protein, carbs, fat,
                               remote_id, updated_at, dirty)
     SELECT ?, meal, food_id, name, grams, portion_label, portion_qty, kcal, protein, carbs, fat,
            ${UUID_SQL}, ?, 1
       FROM food_entries WHERE date = ? AND meal = ? ORDER BY id`,
    toDate,
    Date.now(),
    fromDate,
    meal
  );
  requestFoodSync();
}

/** Totais por dia no intervalo (só dias com algum registro). */
export async function getDailyTotals(fromKey, toKey) {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT date, SUM(kcal) AS kcal, SUM(protein) AS protein, SUM(carbs) AS carbs, SUM(fat) AS fat,
            COUNT(*) AS items
       FROM food_entries
      WHERE date BETWEEN ? AND ?
      GROUP BY date
      ORDER BY date`,
    fromKey,
    toKey
  );
}

/** Alimentos mais registrados no intervalo (para o relatório). */
export async function getTopFoods(fromKey, toKey, limit = 10) {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT name, COUNT(*) AS times, SUM(grams) AS grams, SUM(kcal) AS kcal
       FROM food_entries
      WHERE date BETWEEN ? AND ?
      GROUP BY name
      ORDER BY times DESC, kcal DESC
      LIMIT ?`,
    fromKey,
    toKey,
    limit
  );
}

/** Calorias por refeição no intervalo. */
export async function getMealTotals(fromKey, toKey) {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT meal, SUM(kcal) AS kcal
       FROM food_entries
      WHERE date BETWEEN ? AND ?
      GROUP BY meal
      ORDER BY CASE meal WHEN 'cafe' THEN 1 WHEN 'almoco' THEN 2 WHEN 'lanche' THEN 3 WHEN 'jantar' THEN 4 ELSE 5 END`,
    fromKey,
    toKey
  );
}
