// Estatísticas que cruzam treinos e jogos.
// Tudo aqui é correlação: mostra o que anda junto, não prova causa. Por isso
// cada estatística exige um mínimo de dados antes de aparecer.

import { addDays, parseDateKey, toDateKey } from './dates';
import { PERIODS, played } from './games';

export const ADHERENCE_WINDOW_DAYS = 14; // treino "que conta" para um jogo: os 14 dias antes dele
export const GOOD_ADHERENCE = 0.7;

const SCORE_FIELDS = ['skill', 'intensity', 'stamina'];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (from, to) => (from ? ((to - from) / from) * 100 : null);

/** Nota geral do jogo: média de habilidade, intensidade e físico (1 a 5). */
export function gameScore(log) {
  const values = SCORE_FIELDS.map((f) => log[f]).filter((v) => v != null);
  return values.length === SCORE_FIELDS.length ? mean(values) : null;
}

/** Treinos programados x feitos por dia, a partir dos resumos semanais do ciclo. */
export function dailyTraining(weekSummaries) {
  const map = new Map();
  for (const w of weekSummaries) {
    for (const d of w.days) {
      map.set(d.dateKey, { total: d.items.length, done: d.items.filter((i) => i.done).length });
    }
  }
  return map;
}

/** % de treinos feitos nos N dias antes da data (o dia do jogo não conta). */
export function adherenceBefore(dateKey, daily, days = ADHERENCE_WINDOW_DAYS) {
  const date = parseDateKey(dateKey);
  let total = 0;
  let done = 0;
  for (let i = 1; i <= days; i++) {
    const d = daily.get(toDateKey(addDays(date, -i)));
    if (d) {
      total += d.total;
      done += d.done;
    }
  }
  return total > 0 ? done / total : null;
}

/** Partidas jogadas com nota geral e adesão aos treinos antes delas. */
export function enrichGames(logs, weekSummaries) {
  const daily = dailyTraining(weekSummaries);
  return played(logs).map((log) => ({
    ...log,
    score: gameScore(log),
    adherence: adherenceBefore(log.date, daily),
  }));
}

/**
 * Evolução nos jogos: nota geral das primeiras partidas x das últimas,
 * dentro de cada modalidade (salão e campo não se misturam), depois
 * combinada pelo número de jogos de cada uma.
 */
export function gameEvolution(games, { minGames = 4 } = {}) {
  const byMod = new Map();
  for (const g of games.filter((x) => x.score != null)) {
    const list = byMod.get(g.modality) ?? [];
    list.push(g);
    byMod.set(g.modality, list);
  }

  const perModality = [];
  for (const [modality, list] of byMod) {
    if (list.length < minGames) continue;
    const k = Math.min(4, Math.floor(list.length / 2));
    const first = list.slice(0, k);
    const last = list.slice(-k);
    const from = mean(first.map((g) => g.score));
    const to = mean(last.map((g) => g.score));
    const adhFirst = mean(first.map((g) => g.adherence).filter((a) => a != null));
    const adhLast = mean(last.map((g) => g.adherence).filter((a) => a != null));
    perModality.push({
      modality,
      count: list.length,
      window: k,
      from,
      to,
      percent: pct(from, to),
      adherenceFrom: adhFirst,
      adherenceTo: adhLast,
      metrics: SCORE_FIELDS.map((f) => {
        const a = mean(first.map((g) => g[f]));
        const b = mean(last.map((g) => g[f]));
        return { key: f, from: a, to: b, percent: pct(a, b) };
      }),
    });
  }
  if (perModality.length === 0) return null;

  const weight = perModality.reduce((s, m) => s + m.count, 0);
  return {
    percent: perModality.reduce((s, m) => s + m.percent * m.count, 0) / weight,
    perModality,
  };
}

/**
 * Jogos depois de 14 dias de treino em dia (70%+) x jogos depois de pouco treino.
 * Exige pelo menos 2 jogos em cada grupo.
 */
export function trainingEffect(games, { minPerGroup = 2 } = {}) {
  const withAdh = games.filter((g) => g.adherence != null && g.score != null);
  const high = withAdh.filter((g) => g.adherence >= GOOD_ADHERENCE);
  const low = withAdh.filter((g) => g.adherence < GOOD_ADHERENCE);
  if (high.length < minPerGroup || low.length < minPerGroup) return null;

  const fields = [...SCORE_FIELDS, 'score', 'minutes'];
  const stats = Object.fromEntries(
    fields.map((f) => {
      const a = mean(high.map((g) => g[f]).filter((v) => v != null));
      const b = mean(low.map((g) => g[f]).filter((v) => v != null));
      return [f, { high: a, low: b, percent: a != null && b != null ? pct(b, a) : null }];
    })
  );
  return { high: high.length, low: low.length, stats };
}

/** Correlação de Pearson entre adesão aos treinos e uma nota. */
export function correlation(games, field, { minGames = 6 } = {}) {
  const pairs = games
    .filter((g) => g.adherence != null && g[field] != null)
    .map((g) => [g.adherence, g[field]]);
  if (pairs.length < minGames) return null;

  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  const r = num / Math.sqrt(dx * dy);
  const abs = Math.abs(r);
  const strength = abs >= 0.6 ? 'forte' : abs >= 0.3 ? 'moderada' : 'fraca';
  return { r, strength, n: pairs.length };
}

/** Semanas seguidas (já encerradas) com 70%+ dos treinos feitos. */
export function consistencyStreak(weekSummaries) {
  const closed = weekSummaries.slice(0, -1).filter((w) => w.total > 0);
  let streak = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    if (closed[i].done / closed[i].total >= GOOD_ADHERENCE) streak += 1;
    else break;
  }
  return streak;
}

/**
 * Frases prontas com o que os dados mostram. Cada uma só entra se tiver
 * base suficiente; a ordem é da mais importante para a menos.
 */
export function buildInsights({ games, allLogs, weekSummaries, measurements }) {
  const out = [];
  const fmt = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const signed = (n) => `${n > 0 ? '+' : ''}${fmt(n, 0)}%`;

  // 1. Treino antes do jogo x desempenho
  const effect = trainingEffect(games);
  if (effect) {
    const s = effect.stats;
    const best = ['stamina', 'intensity', 'skill']
      .map((k) => ({ k, ...s[k] }))
      .filter((x) => x.percent != null)
      .sort((a, b) => b.percent - a.percent)[0];
    // com artigo, porque o gênero muda: "a intensidade", "o físico"
    const names = { skill: 'a habilidade', intensity: 'a intensidade', stamina: 'o físico no fim' };
    if (s.score.percent != null && s.score.percent > 0) {
      out.push({
        icon: '💪',
        text: `Com os treinos em dia nas 2 semanas anteriores, sua nota geral nos jogos é ${fmt(s.score.percent, 0)}% maior.`,
        detail: `${fmt(s.score.high)} x ${fmt(s.score.low)} · ${effect.high} jogos com treino em dia, ${effect.low} sem`,
      });
    } else if (s.score.percent != null) {
      out.push({
        icon: '🤔',
        text: 'Por enquanto, treinar mais nas semanas anteriores não apareceu na sua nota geral de jogo.',
        detail: `${fmt(s.score.high)} x ${fmt(s.score.low)} · a amostra ainda é pequena`,
      });
    }
    if (best && best.percent > 5) {
      out.push({
        icon: '📌',
        text: `O que mais melhora com treino em dia é ${names[best.k]}: ${signed(best.percent)}.`,
        detail: `${fmt(best.high)} com treino em dia x ${fmt(best.low)} sem`,
      });
    }
    if (s.minutes.high != null && s.minutes.low != null && Math.abs(s.minutes.high - s.minutes.low) >= 3) {
      const more = s.minutes.high > s.minutes.low;
      out.push({
        icon: '⏱️',
        text: `Com treino em dia você fica ${fmt(Math.abs(s.minutes.high - s.minutes.low), 0)} min ${more ? 'a mais' : 'a menos'} jogando por partida.`,
        detail: `${fmt(s.minutes.high, 0)} x ${fmt(s.minutes.low, 0)} min`,
      });
    }
  }

  // 2. Força da relação (precisa de mais jogos)
  const corr = correlation(games, 'stamina');
  if (corr && corr.r > 0.3) {
    out.push({
      icon: '🔗',
      text: `Quanto mais você treina, melhor seu físico no fim do jogo — relação ${corr.strength}.`,
      detail: `correlação ${fmt(corr.r, 2)} em ${corr.n} jogos`,
    });
  }

  // 3. Constância
  const streak = consistencyStreak(weekSummaries);
  if (streak >= 2) {
    out.push({
      icon: '🔥',
      text: `${streak} semanas seguidas com 70%+ dos treinos feitos.`,
      detail: 'Constância é o que mais pesa na evolução física.',
    });
  }

  // 4. Dor/lesão x treino
  const withPain = games.filter((g) => g.pain === 1);
  if (games.length >= 5 && withPain.length > 0) {
    const rate = (withPain.length / games.length) * 100;
    const lowAdh = games.filter((g) => g.adherence != null && g.adherence < GOOD_ADHERENCE);
    const highAdh = games.filter((g) => g.adherence != null && g.adherence >= GOOD_ADHERENCE);
    const painLow = lowAdh.length >= 2 ? lowAdh.filter((g) => g.pain === 1).length / lowAdh.length : null;
    const painHigh = highAdh.length >= 2 ? highAdh.filter((g) => g.pain === 1).length / highAdh.length : null;
    out.push({
      icon: '⚠️',
      text: `Você sentiu dor em ${fmt(rate, 0)}% dos jogos.`,
      detail:
        painLow != null && painHigh != null
          ? `${fmt(painHigh * 100, 0)}% com treino em dia x ${fmt(painLow * 100, 0)}% com pouco treino`
          : `${withPain.length} de ${games.length} jogos`,
    });
  }

  // 5. Horário do jogo x físico
  const byPeriod = PERIODS.map((p) => {
    const list = games.filter((g) => g.period === p && g.stamina != null);
    return { period: p, n: list.length, stamina: mean(list.map((g) => g.stamina)) };
  }).filter((x) => x.n >= 2);
  if (byPeriod.length >= 2) {
    const sorted = [...byPeriod].sort((a, b) => b.stamina - a.stamina);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    if (top.stamina - bottom.stamina >= 0.5) {
      out.push({
        icon: '🕐',
        text: `Seu físico rende mais em jogos de ${top.period.toLowerCase()} do que de ${bottom.period.toLowerCase()}.`,
        detail: `${fmt(top.stamina)} x ${fmt(bottom.stamina)}`,
      });
    }
  }

  // 6. Peso x físico
  if (measurements.length >= 2 && games.length >= 4) {
    const first = measurements[0];
    const last = measurements[measurements.length - 1];
    const deltaKg = last.weight_kg - first.weight_kg;
    const before = games.filter((g) => g.date <= measurements[Math.floor(measurements.length / 2)].date);
    const after = games.filter((g) => g.date > measurements[Math.floor(measurements.length / 2)].date);
    const sBefore = mean(before.map((g) => g.stamina).filter((v) => v != null));
    const sAfter = mean(after.map((g) => g.stamina).filter((v) => v != null));
    if (Math.abs(deltaKg) >= 1 && sBefore != null && sAfter != null && before.length >= 2 && after.length >= 2) {
      out.push({
        icon: '⚖️',
        text: `Desde a primeira medição você ${deltaKg < 0 ? 'perdeu' : 'ganhou'} ${fmt(Math.abs(deltaKg))} kg, e seu físico nos jogos foi de ${fmt(sBefore)} para ${fmt(sAfter)}.`,
        detail: 'Comparação entre a primeira e a segunda metade do período',
      });
    }
  }

  // 7. Resultados e participação em gols
  const withResult = games.filter((g) => g.result);
  if (withResult.length >= 4) {
    const wins = withResult.filter((g) => g.result === 'V').length;
    const ga = games.filter((g) => g.goals != null || g.assists != null);
    const perGame = ga.length ? mean(ga.map((g) => (g.goals ?? 0) + (g.assists ?? 0))) : null;
    out.push({
      icon: '🏅',
      text: `${fmt((wins / withResult.length) * 100, 0)}% de vitórias em ${withResult.length} jogos.`,
      detail: perGame != null ? `${fmt(perGame)} participações em gol (gols + assistências) por jogo` : '',
    });
  }

  // 8. Jogos marcados como "não teve"
  const skipped = allLogs.filter((l) => l.played === 0).length;
  if (skipped >= 2) {
    out.push({
      icon: '📆',
      text: `${skipped} datas sem jogo (folga, chuva ou adiamento) ficaram fora das médias.`,
      detail: '',
    });
  }

  return out;
}
