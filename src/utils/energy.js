// Gasto energético estimado por MET (Compendium of Physical Activities).
// kcal da atividade = (MET − 1) × peso (kg) × horas. O "− 1" desconta o gasto em
// repouso, que já está na taxa metabólica basal — senão ele seria contado duas vezes.
// São estimativas: a margem de erro fica em torno de 20–30%.

import { toDateKey } from './dates';

export const ACTIVITIES = [
  { key: 'caminhada', label: 'Caminhada', met: 3.5 },
  { key: 'esteira_leve', label: 'Caminhada rápida / trote leve', met: 5.0 },
  { key: 'corrida', label: 'Corrida', met: 9.0 },
  { key: 'intervalado', label: 'Intervalado (tiro + caminhada)', met: 6.5 },
  { key: 'corda', label: 'Pular corda', met: 11.8 },
  { key: 'bike', label: 'Bicicleta', met: 7.0 },
  { key: 'forca', label: 'Força com peso do corpo', met: 3.8 },
  { key: 'pliometria', label: 'Saltos / pliometria', met: 8.0 },
  { key: 'musculacao', label: 'Musculação', met: 5.0 },
  { key: 'core', label: 'Core / prancha', met: 3.0 },
  { key: 'alongamento', label: 'Alongamento / mobilidade', met: 2.3 },
  { key: 'outro', label: 'Outro (moderado)', met: 4.0 },
];
export const activityOf = (key) => ACTIVITIES.find((a) => a.key === key) ?? ACTIVITIES[ACTIVITIES.length - 1];

// Rotina fora dos treinos (multiplica a TMB)
export const LIFESTYLES = [
  { factor: 1.2, label: 'Sentado a maior parte do dia' },
  { factor: 1.35, label: 'Em pé ou andando bastante' },
  { factor: 1.5, label: 'Trabalho físico pesado' },
];
export const DEFAULT_FACTOR = 1.2;

// Futebol: a nota de intensidade da avaliação escolhe o MET (recreativo 7 → competitivo 10)
const GAME_MET_BY_INTENSITY = { 1: 6, 2: 7, 3: 8, 4: 9, 5: 10 };
const DEFAULT_GAME_MINUTES = { Campo: 40, Salão: 50, Society: 50 };

export const activityKcal = (met, weightKg, minutes) => Math.max(met - 1, 0) * weightKg * (minutes / 60);

export function exerciseKcal(exercise, weightKg) {
  if (!exercise?.duration_min) return 0;
  return activityKcal(activityOf(exercise.activity).met, weightKg, exercise.duration_min);
}

export function gameMinutes(log) {
  return log.minutes ?? DEFAULT_GAME_MINUTES[log.modality] ?? 45;
}

export function gameKcal(log, weightKg) {
  if (log.played !== 1) return 0;
  const met = GAME_MET_BY_INTENSITY[log.intensity] ?? 8;
  return activityKcal(met, weightKg, gameMinutes(log));
}

// ---------- tipo e duração sugeridos para exercícios já cadastrados ----------

// O plano inicial do app, com o tempo em ação (sem contar descanso na corda)
const KNOWN = {
  'Esteira leve': ['esteira_leve', 20],
  'Corda resistência': ['corda', 4],
  'Corda contínua': ['corda', 8],
  'Esteira intervalado leve': ['intervalado', 24],
  'Agachamento livre': ['forca', 8],
  'Afundo alternado': ['forca', 8],
  'Agachamento com salto': ['pliometria', 5],
  'Panturrilha em pé': ['forca', 5],
  Prancha: ['core', 4],
  'Levantamento terra unilateral': ['forca', 8],
  'Ponte de glúteo': ['forca', 6],
  'Elevação de joelho no ar': ['core', 5],
  'Prancha lateral': ['core', 4],
};

const KEYWORDS = [
  [/corda/i, 'corda'],
  [/intervalad|tiro/i, 'intervalado'],
  [/corrida|correr|trote/i, 'corrida'],
  [/esteira|caminhad/i, 'esteira_leve'],
  [/bike|bicicleta|ciclismo/i, 'bike'],
  [/salto|pliom|burpee/i, 'pliometria'],
  [/prancha|abdominal|core/i, 'core'],
  [/along|mobilidade/i, 'alongamento'],
  [/supino|rosca|leg press|halter|barra|m[aá]quina|puxada/i, 'musculacao'],
];

/** Tipo e duração prováveis a partir do nome e dos detalhes ("20 min"). */
export function guessActivity(name, details = '') {
  if (KNOWN[name]) return { activity: KNOWN[name][0], duration: KNOWN[name][1] };
  const text = `${name} ${details}`;
  const activity = KEYWORDS.find(([re]) => re.test(text))?.[1] ?? 'forca';
  const minutes = /(\d+)\s*min/i.exec(details ?? '');
  return { activity, duration: minutes ? Math.min(Number(minutes[1]), 180) : 8 };
}

// ---------- gasto do dia ----------

/** Peso vigente na data: a última medição até aquele dia (ou a primeira, se for antes). */
export function weightOn(dateKey, measurements) {
  if (measurements.length === 0) return null;
  let w = measurements[0].weight_kg;
  for (const m of measurements) {
    if (m.date <= dateKey) w = m.weight_kg;
    else break;
  }
  return w;
}

/**
 * Gasto estimado de cada dia do intervalo.
 * weekSummaries: resumos semanais (itens programados e feitos por dia);
 * exercisesById: Map id -> exercício (com activity e duration_min);
 * bmrFor(weightKg): TMB para um peso; factor: rotina fora dos treinos.
 * Retorna Map dateKey -> { base, training, games, total, items: [{ name, kcal, kind }] }
 */
export function dailyEnergy({ dateKeys, weekSummaries, exercisesById, gameLogs, measurements, bmrFor, factor }) {
  const doneByDate = new Map();
  for (const w of weekSummaries) {
    for (const d of w.days) doneByDate.set(d.dateKey, d.items.filter((i) => i.done));
  }
  const gamesByDate = new Map();
  for (const g of gameLogs) {
    const list = gamesByDate.get(g.date) ?? [];
    list.push(g);
    gamesByDate.set(g.date, list);
  }

  const result = new Map();
  for (const key of dateKeys) {
    const weight = weightOn(key, measurements);
    if (weight == null) continue;
    const base = bmrFor(weight) * factor;
    const items = [];
    for (const done of doneByDate.get(key) ?? []) {
      const ex = exercisesById.get(done.id);
      const kcal = exerciseKcal(ex, weight);
      if (kcal > 0) items.push({ name: ex.name, kcal, kind: 'treino', detail: `${ex.duration_min} min · ${activityOf(ex.activity).label}` });
    }
    for (const g of gamesByDate.get(key) ?? []) {
      const kcal = gameKcal(g, weight);
      if (kcal > 0) {
        items.push({
          name: g.name ?? `Jogo (${g.modality})`,
          kcal,
          kind: 'jogo',
          detail: `${gameMinutes(g)} min${g.minutes == null ? ' (estimado)' : ''} · intensidade ${g.intensity}/5`,
        });
      }
    }
    const training = items.filter((i) => i.kind === 'treino').reduce((s, i) => s + i.kcal, 0);
    const games = items.filter((i) => i.kind === 'jogo').reduce((s, i) => s + i.kcal, 0);
    result.set(key, { base, training, games, total: base + training + games, items, weight });
  }
  return result;
}

/** Datas (YYYY-MM-DD) de um intervalo, inclusive. */
export function dateRange(from, to) {
  const out = [];
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12);
  while (toDateKey(d) <= toDateKey(to)) {
    out.push(toDateKey(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
