import * as SQLite from 'expo-sqlite';
import { SEED_EXERCISES } from './seed';
import { seedFoods } from './foodSeed';
import { addDays, parseDateKey, startOfWeek, toDateKey } from '../utils/dates';
import { DEFAULT_WEEKS, MAX_WEEKS, MIN_WEEKS, WEEK_LETTERS, shiftLetter } from '../utils/weeks';
import { guessActivity } from '../utils/energy';

let dbPromise = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('exercicios.db');
      await migrate(db);
      await seedIfEmpty(db);
      await fillExerciseActivities(db);
      await seedFoods(db);
      return db;
    })();
  }
  return dbPromise;
}

async function migrate(db) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      details TEXT,
      days TEXT NOT NULL,
      weeks TEXT NOT NULL DEFAULT 'A',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
      UNIQUE (exercise_id, date)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Uma linha por semana do calendário (segunda-feira) com a letra do ciclo
    CREATE TABLE IF NOT EXISTS cycle_weeks (
      week_start TEXT PRIMARY KEY,
      letter TEXT NOT NULL
    );

    -- Perfil da pessoa (sempre uma única linha, id = 1)
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      sex TEXT NOT NULL CHECK (sex IN ('M', 'F')),
      birth_date TEXT NOT NULL,
      height_cm REAL NOT NULL,
      goal_weight_kg REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- Jogos que se repetem na semana (ex.: salão nas terças, campo nos sábados).
    -- O horário do jogo varia (campeonato), então guardamos só a hora do lembrete.
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      modality TEXT NOT NULL,
      day TEXT NOT NULL,
      reminder_hour INTEGER NOT NULL DEFAULT 18,
      reminder_minute INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- Uma linha por partida. played = 0 quando não teve jogo (folga, chuva, adiado)
    CREATE TABLE IF NOT EXISTS game_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      played INTEGER NOT NULL DEFAULT 1 CHECK (played IN (0, 1)),
      skill INTEGER,
      intensity INTEGER,
      stamina INTEGER,
      minutes INTEGER,
      period TEXT,
      opponent_level INTEGER,
      result TEXT,
      goals INTEGER,
      assists INTEGER,
      pain INTEGER NOT NULL DEFAULT 0 CHECK (pain IN (0, 1)),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE (game_id, date)
    );

    -- Alimentos: base TACO embutida (id da TACO), complementos (9001+) e
    -- personalizados (100000+). Valores por 100 g. "search" é o nome sem acento.
    CREATE TABLE IF NOT EXISTS foods (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      search TEXT NOT NULL,
      category TEXT,
      kcal REAL NOT NULL,
      protein REAL NOT NULL DEFAULT 0,
      carbs REAL NOT NULL DEFAULT 0,
      fat REAL NOT NULL DEFAULT 0,
      fiber REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      common INTEGER NOT NULL DEFAULT 0,
      favorite INTEGER NOT NULL DEFAULT 0
    );

    -- Medidas caseiras (colher, concha, unidade...) em gramas
    CREATE TABLE IF NOT EXISTS food_portions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      food_id INTEGER NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      grams REAL NOT NULL,
      custom INTEGER NOT NULL DEFAULT 0
    );

    -- O que foi comido. Nome e valores são copiados no registro, para o
    -- histórico não mudar se o alimento for editado ou apagado depois.
    CREATE TABLE IF NOT EXISTS food_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      meal TEXT NOT NULL,
      food_id INTEGER REFERENCES foods(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      grams REAL NOT NULL,
      portion_label TEXT,
      portion_qty REAL,
      kcal REAL NOT NULL,
      protein REAL NOT NULL DEFAULT 0,
      carbs REAL NOT NULL DEFAULT 0,
      fat REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_food_entries_date ON food_entries (date);
    CREATE INDEX IF NOT EXISTS idx_food_portions_food ON food_portions (food_id);

    -- Medições corporais; "cycle" é o ciclo de semanas em que foi registrada
    CREATE TABLE IF NOT EXISTS measurements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      cycle INTEGER NOT NULL,
      weight_kg REAL NOT NULL,
      waist_cm REAL,
      resting_hr INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);

  // Bancos da versão anterior não têm a coluna "weeks": o plano existente vira a Semana A
  const columns = await db.getAllAsync('PRAGMA table_info(exercises)');
  if (!columns.some((c) => c.name === 'weeks')) {
    await db.execAsync("ALTER TABLE exercises ADD COLUMN weeks TEXT NOT NULL DEFAULT 'A'");
  }
  // Tipo de atividade e duração, para estimar o gasto calórico dos treinos
  if (!columns.some((c) => c.name === 'activity')) {
    await db.execAsync('ALTER TABLE exercises ADD COLUMN activity TEXT');
    await db.execAsync('ALTER TABLE exercises ADD COLUMN duration_min INTEGER');
  }

  await db.runAsync(
    "INSERT OR IGNORE INTO settings (key, value) VALUES ('week_count', ?)",
    String(DEFAULT_WEEKS)
  );
}

async function seedIfEmpty(db) {
  const row = await db.getFirstAsync('SELECT COUNT(*) AS total FROM exercises');
  if (row.total > 0) return;

  await db.withTransactionAsync(async () => {
    for (const ex of SEED_EXERCISES) {
      await db.runAsync(
        'INSERT INTO exercises (name, details, days, weeks) VALUES (?, ?, ?, ?)',
        ex.name,
        ex.details,
        ex.days,
        ex.weeks
      );
    }
  });
}

// Exercícios sem tipo/duração (plano inicial ou versão anterior do app) ganham uma
// sugestão pelo nome — a pessoa pode ajustar depois na edição do exercício.
async function fillExerciseActivities(db) {
  const rows = await db.getAllAsync('SELECT id, name, details FROM exercises WHERE activity IS NULL');
  for (const r of rows) {
    const { activity, duration } = guessActivity(r.name, r.details);
    await db.runAsync('UPDATE exercises SET activity = ?, duration_min = ? WHERE id = ?', activity, duration, r.id);
  }
}

// ---------- Ciclo de semanas ----------

export async function getWeekCount() {
  const db = await getDb();
  const row = await db.getFirstAsync("SELECT value FROM settings WHERE key = 'week_count'");
  const n = parseInt(row?.value, 10);
  return Number.isNaN(n) ? DEFAULT_WEEKS : Math.min(Math.max(n, MIN_WEEKS), MAX_WEEKS);
}

// Garante uma linha em cycle_weeks para cada semana até a atual.
// Cada segunda-feira nova avança uma letra; depois da última, volta para a A.
// Várias telas chamam isso ao mesmo tempo na abertura do app, então as execuções
// são enfileiradas para não calcularem a mesma semana duas vezes.
let cycleLock = Promise.resolve();

function ensureCycleUpToDate(db, count) {
  const run = cycleLock.then(() => fillCycleWeeks(db, count));
  cycleLock = run.catch(() => {});
  return run;
}

async function fillCycleWeeks(db, count) {
  const currentStart = toDateKey(startOfWeek());
  const last = await db.getFirstAsync(
    'SELECT week_start, letter FROM cycle_weeks ORDER BY week_start DESC LIMIT 1'
  );

  if (!last) {
    await db.runAsync(
      'INSERT OR IGNORE INTO cycle_weeks (week_start, letter) VALUES (?, ?)',
      currentStart,
      'A'
    );
    return;
  }

  let start = last.week_start;
  let letter = last.letter;
  while (start < currentStart) {
    start = toDateKey(addDays(parseDateKey(start), 7));
    letter = shiftLetter(letter, 1, count);
    await db.runAsync(
      'INSERT OR IGNORE INTO cycle_weeks (week_start, letter) VALUES (?, ?)',
      start,
      letter
    );
  }
}

/**
 * Todas as semanas registradas (mais antiga primeiro), com o número do ciclo.
 * Um ciclo novo começa quando a letra "volta" (ex.: C → A).
 */
export async function getCycleWeeks() {
  const db = await getDb();
  const count = await getWeekCount();
  await ensureCycleUpToDate(db, count);

  const currentStart = toDateKey(startOfWeek());
  const rows = await db.getAllAsync(
    'SELECT week_start, letter FROM cycle_weeks WHERE week_start <= ? ORDER BY week_start',
    currentStart
  );

  let cycle = 1;
  let prevIdx = -1;
  return rows.map((row) => {
    const idx = WEEK_LETTERS.indexOf(row.letter);
    if (prevIdx !== -1 && idx <= prevIdx) cycle += 1;
    prevIdx = idx;
    return { weekStart: row.week_start, letter: row.letter, cycle };
  });
}

export async function getCurrentWeek() {
  const count = await getWeekCount();
  const weeks = await getCycleWeeks();
  const current = weeks[weeks.length - 1] ?? {
    weekStart: toDateKey(startOfWeek()),
    letter: 'A',
    cycle: 1,
  };
  return { ...current, count };
}

export async function setCurrentWeekLetter(letter) {
  const db = await getDb();
  const count = await getWeekCount();
  await ensureCycleUpToDate(db, count);
  await db.runAsync(
    'UPDATE cycle_weeks SET letter = ? WHERE week_start = ?',
    letter,
    toDateKey(startOfWeek())
  );
}

export async function setWeekCount(count) {
  const db = await getDb();
  const n = Math.min(Math.max(count, MIN_WEEKS), MAX_WEEKS);
  await db.runAsync("UPDATE settings SET value = ? WHERE key = 'week_count'", String(n));

  // Se a semana atual deixou de existir no ciclo (ex.: estava na C e reduziu para 2), volta pra A
  const current = await getCurrentWeek();
  if (WEEK_LETTERS.indexOf(current.letter) >= n) {
    await setCurrentWeekLetter('A');
  }
}

// ---------- Exercícios ----------

// "days" e "weeks" são salvos como "Seg,Qua" / "A,B". Comparamos com vírgulas nas
// pontas para não haver falso positivo por substring.
export async function getExercisesForDay(dayCode, weekLetter, dateKey) {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT e.id, e.name, e.details, e.days, e.weeks, COALESCE(c.done, 0) AS done
       FROM exercises e
       LEFT JOIN completions c ON c.exercise_id = e.id AND c.date = ?
      WHERE (',' || e.days || ',') LIKE ?
        AND (',' || e.weeks || ',') LIKE ?
      ORDER BY e.id`,
    dateKey,
    `%,${dayCode},%`,
    `%,${weekLetter},%`
  );
}

export async function getAllExercises() {
  const db = await getDb();
  return db.getAllAsync(
    'SELECT id, name, details, days, weeks, activity, duration_min, created_at FROM exercises ORDER BY id'
  );
}

export async function addExercise({ name, details, days, weeks, activity, durationMin }) {
  const db = await getDb();
  const result = await db.runAsync(
    'INSERT INTO exercises (name, details, days, weeks, activity, duration_min) VALUES (?, ?, ?, ?, ?, ?)',
    name,
    details,
    days,
    weeks,
    activity,
    durationMin
  );
  return result.lastInsertRowId;
}

export async function getExercise(id) {
  const db = await getDb();
  return db.getFirstAsync(
    'SELECT id, name, details, days, weeks, activity, duration_min, created_at FROM exercises WHERE id = ?',
    id
  );
}

export async function updateExercise(id, { name, details, days, weeks, activity, durationMin }) {
  const db = await getDb();
  await db.runAsync(
    'UPDATE exercises SET name = ?, details = ?, days = ?, weeks = ?, activity = ?, duration_min = ? WHERE id = ?',
    name,
    details,
    days,
    weeks,
    activity,
    durationMin,
    id
  );
}

export async function deleteExercise(id) {
  const db = await getDb();
  await db.runAsync('DELETE FROM exercises WHERE id = ?', id);
}

// ---------- Conclusões ----------

export async function setCompletion(exerciseId, dateKey, done) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO completions (exercise_id, date, done) VALUES (?, ?, ?)
     ON CONFLICT (exercise_id, date) DO UPDATE SET done = excluded.done`,
    exerciseId,
    dateKey,
    done ? 1 : 0
  );
}

export async function getDoneCompletionsBetween(startKey, endKey) {
  const db = await getDb();
  return db.getAllAsync(
    'SELECT exercise_id, date FROM completions WHERE done = 1 AND date BETWEEN ? AND ?',
    startKey,
    endKey
  );
}

// ---------- Perfil e medições ----------

export async function getProfile() {
  const db = await getDb();
  return db.getFirstAsync(
    'SELECT name, sex, birth_date, height_cm, goal_weight_kg FROM profile WHERE id = 1'
  );
}

export async function saveProfile({ name, sex, birthDate, heightCm, goalWeightKg }) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO profile (id, name, sex, birth_date, height_cm, goal_weight_kg)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name,
       sex = excluded.sex,
       birth_date = excluded.birth_date,
       height_cm = excluded.height_cm,
       goal_weight_kg = excluded.goal_weight_kg,
       updated_at = datetime('now', 'localtime')`,
    name,
    sex,
    birthDate,
    heightCm,
    goalWeightKg ?? null
  );
}

// Mais antiga primeiro
export async function getMeasurements() {
  const db = await getDb();
  return db.getAllAsync(
    'SELECT id, date, cycle, weight_kg, waist_cm, resting_hr FROM measurements ORDER BY date, id'
  );
}

export async function addMeasurement({ weightKg, waistCm, restingHr }) {
  const db = await getDb();
  const current = await getCurrentWeek();
  await db.runAsync(
    'INSERT INTO measurements (date, cycle, weight_kg, waist_cm, resting_hr) VALUES (?, ?, ?, ?, ?)',
    toDateKey(new Date()),
    current.cycle,
    weightKg,
    waistCm ?? null,
    restingHr ?? null
  );
}

export async function deleteMeasurement(id) {
  const db = await getDb();
  await db.runAsync('DELETE FROM measurements WHERE id = ?', id);
}

/**
 * Pede novas medidas quando um ciclo de semanas terminou (ex.: acabou o A→B→C
 * e começou o ciclo 2) e ainda não há medição registrada no ciclo atual.
 * Retorna o número do ciclo encerrado, ou null se não precisa pedir.
 */
export async function getPendingCheckInCycle() {
  const db = await getDb();
  const [profile, current] = await Promise.all([getProfile(), getCurrentWeek()]);
  if (!profile || current.cycle <= 1) return null;

  const row = await db.getFirstAsync('SELECT MAX(cycle) AS last FROM measurements');
  if (row?.last != null && row.last >= current.cycle) return null;
  return current.cycle - 1;
}

// ---------- Jogos ----------

export async function getGames() {
  const db = await getDb();
  return db.getAllAsync(
    'SELECT id, name, modality, day, reminder_hour, reminder_minute, created_at FROM games ORDER BY id'
  );
}

export async function getGame(id) {
  const db = await getDb();
  return db.getFirstAsync(
    'SELECT id, name, modality, day, reminder_hour, reminder_minute FROM games WHERE id = ?',
    id
  );
}

export async function saveGame({ id, name, modality, day, reminderHour, reminderMinute }) {
  const db = await getDb();
  if (id) {
    await db.runAsync(
      'UPDATE games SET name = ?, modality = ?, day = ?, reminder_hour = ?, reminder_minute = ? WHERE id = ?',
      name,
      modality,
      day,
      reminderHour,
      reminderMinute,
      id
    );
    return id;
  }
  const result = await db.runAsync(
    'INSERT INTO games (name, modality, day, reminder_hour, reminder_minute) VALUES (?, ?, ?, ?, ?)',
    name,
    modality,
    day,
    reminderHour,
    reminderMinute
  );
  return result.lastInsertRowId;
}

export async function deleteGame(id) {
  const db = await getDb();
  await db.runAsync('DELETE FROM games WHERE id = ?', id);
}

// Jogos de um dia da semana, com a avaliação daquela data (se já houver)
export async function getGamesForDate(dayCode, dateKey) {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT g.id, g.name, g.modality, g.day, g.reminder_hour, g.reminder_minute,
            l.id AS log_id, l.played, l.skill, l.intensity, l.stamina, l.minutes
       FROM games g
       LEFT JOIN game_logs l ON l.game_id = g.id AND l.date = ?
      WHERE g.day = ?
      ORDER BY g.id`,
    dateKey,
    dayCode
  );
}

// Avaliações, da mais antiga para a mais nova, já com os dados do jogo
export async function getGameLogs() {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT l.*, g.name, g.modality, g.day
       FROM game_logs l
       JOIN games g ON g.id = l.game_id
      ORDER BY l.date, l.id`
  );
}

export async function getGameLog(gameId, dateKey) {
  const db = await getDb();
  return db.getFirstAsync('SELECT * FROM game_logs WHERE game_id = ? AND date = ?', gameId, dateKey);
}

export async function saveGameLog(gameId, dateKey, data) {
  const db = await getDb();
  const {
    played = 1,
    skill = null,
    intensity = null,
    stamina = null,
    minutes = null,
    period = null,
    opponentLevel = null,
    result = null,
    goals = null,
    assists = null,
    pain = 0,
    notes = null,
  } = data;

  await db.runAsync(
    `INSERT INTO game_logs
       (game_id, date, played, skill, intensity, stamina, minutes, period, opponent_level, result, goals, assists, pain, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (game_id, date) DO UPDATE SET
       played = excluded.played, skill = excluded.skill, intensity = excluded.intensity,
       stamina = excluded.stamina, minutes = excluded.minutes, period = excluded.period,
       opponent_level = excluded.opponent_level, result = excluded.result,
       goals = excluded.goals, assists = excluded.assists, pain = excluded.pain, notes = excluded.notes`,
    gameId,
    dateKey,
    played ? 1 : 0,
    skill,
    intensity,
    stamina,
    minutes,
    period,
    opponentLevel,
    result,
    goals,
    assists,
    pain ? 1 : 0,
    notes
  );
}

export async function deleteGameLog(id) {
  const db = await getDb();
  await db.runAsync('DELETE FROM game_logs WHERE id = ?', id);
}

// ---------- Preferências simples ----------

export async function getSetting(key) {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setSetting(key, value) {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    key,
    value
  );
}
