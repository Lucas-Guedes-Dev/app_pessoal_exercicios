import { WEEKDAYS, addDays, parseDateKey, toDateKey } from './dates';

export const METRICS = [
  { key: 'skill', label: 'Habilidade', short: 'Habilidade' },
  { key: 'intensity', label: 'Intensidade', short: 'Intensidade' },
  { key: 'stamina', label: 'Físico no fim', short: 'Físico' },
  { key: 'minutes', label: 'Minutos jogados', short: 'Minutos', unit: 'min', decimals: 0 },
];

export const PERIODS = ['Manhã', 'Tarde', 'Noite'];
export const RESULTS = [
  { value: 'V', label: 'Vitória' },
  { value: 'E', label: 'Empate' },
  { value: 'D', label: 'Derrota' },
];

export const played = (logs) => logs.filter((l) => l.played === 1);

export function average(logs, field) {
  const values = logs.map((l) => l[field]).filter((v) => v != null);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Agrupa as partidas por modalidade (salão e campo não se comparam entre si). */
export function byModality(logs) {
  const map = new Map();
  for (const log of played(logs)) {
    const list = map.get(log.modality) ?? [];
    list.push(log);
    map.set(log.modality, list);
  }
  return [...map.entries()].map(([modality, list]) => {
    const recent = list.slice(-4);
    const previous = list.slice(-8, -4);
    return {
      modality,
      logs: list,
      metrics: METRICS.map((m) => ({
        ...m,
        value: average(recent, m.key),
        // só compara com o período anterior se ele tiver pelo menos 2 partidas
        previous: previous.length >= 2 ? average(previous, m.key) : null,
      })),
    };
  });
}

/**
 * Média móvel das últimas `window` partidas. Uma nota solta oscila demais;
 * a média mostra a tendência.
 */
export function movingAverage(logs, field, window = 4) {
  const points = [];
  const valid = logs.filter((l) => l[field] != null);
  for (let i = 0; i < valid.length; i++) {
    const slice = valid.slice(Math.max(0, i - window + 1), i + 1);
    points.push({
      date: parseDateKey(valid[i].date),
      value: slice.reduce((s, l) => s + l[field], 0) / slice.length,
      raw: valid[i][field],
      count: slice.length,
    });
  }
  return points;
}

/** Habilidade por força do adversário: jogo duro e jogo fácil não são a mesma prova. */
export function byOpponentLevel(logs) {
  const bands = [
    { label: 'Adversário fraco (1-2)', test: (n) => n <= 2 },
    { label: 'Equilibrado (3)', test: (n) => n === 3 },
    { label: 'Adversário forte (4-5)', test: (n) => n >= 4 },
  ];
  const withLevel = logs.filter((l) => l.opponent_level != null);
  if (withLevel.length < 3) return null;

  return bands
    .map((b) => {
      const list = withLevel.filter((l) => b.test(l.opponent_level));
      return { label: b.label, count: list.length, skill: average(list, 'skill') };
    })
    .filter((b) => b.count > 0);
}

/** Datas passadas (até hoje) em que o jogo acontece, da mais recente para a mais antiga. */
export function recentOccurrences(dayCode, count = 8, today = new Date()) {
  const idx = WEEKDAYS.indexOf(dayCode);
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const back = (d.getDay() - idx + 7) % 7;
  const dates = [];
  for (let i = 0; i < count; i++) dates.push(toDateKey(addDays(d, -back - 7 * i)));
  return dates;
}

/**
 * Jogos que já aconteceram e ainda não foram avaliados (nem marcados como
 * "não teve jogo"). Considera as últimas `weeks` semanas desde o cadastro do
 * jogo e deixa hoje de fora — o jogo de hoje tem o próprio cartão.
 */
export function pendingEvaluations(games, logs, { weeks = 8, today = new Date() } = {}) {
  const todayKey = toDateKey(today);
  const logged = new Set(logs.map((l) => `${l.game_id}|${l.date}`));
  const pending = [];
  for (const g of games) {
    const createdKey = g.created_at ? g.created_at.slice(0, 10) : '0000-00-00';
    for (const date of recentOccurrences(g.day, weeks, today)) {
      if (date >= todayKey || date < createdKey) continue;
      if (!logged.has(`${g.id}|${date}`)) pending.push({ game: g, date });
    }
  }
  return pending.sort((a, b) => (a.date < b.date ? 1 : -1));
}
