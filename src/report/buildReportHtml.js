// Monta o HTML do relatório em PDF. Função pura: recebe os dados já lidos do banco.
import { WEEKDAYS_DISPLAY, formatDateBR, formatShortBR, parseDateKey, weekdayName } from '../utils/dates';
import { mealLabel } from '../utils/food';
import { METRICS, RESULTS, byModality, played } from '../utils/games';
import {
  ageFrom,
  basalMetabolicRate,
  bmi,
  bmiCategory,
  formatNumber,
  healthyWeightRange,
} from '../utils/health';
import { buildInsights, enrichGames, gameEvolution, trainingEffect } from '../utils/insights';
import { hasDay, hasWeek, lettersFor } from '../utils/weeks';
import { barChartSvg, lineChartSvg } from './svgCharts';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const n0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString('pt-BR'));
const n1 = (v) => (v == null ? '—' : formatNumber(v, 1));
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const signedPct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v)}%`);
const dateBR = (key) => formatDateBR(parseDateKey(key));
const shortBR = (d) => formatShortBR(d);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const inPeriod = (key, period) => key >= period.fromKey && key <= period.toKey;

function table(headers, rows, { numeric = [] } = {}) {
  if (rows.length === 0) return '<p class="empty">Sem registros no período.</p>';
  const th = headers.map((h, i) => `<th class="${numeric.includes(i) ? 'num' : ''}">${esc(h)}</th>`).join('');
  const body = rows
    .map((r) => `<tr>${r.map((c, i) => `<td class="${numeric.includes(i) ? 'num' : ''}">${c}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

const tile = (label, value, note = '') =>
  `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${value}</div><div class="tile-note">${esc(note)}</div></div>`;

// ---------- seções ----------

function summarySection(ctx) {
  const { body, training, games, food } = ctx;
  const tiles = [];
  if (body?.latest) {
    tiles.push(
      tile(
        'Peso atual',
        `${n1(body.latest.weight_kg)} <small>kg</small>`,
        body.periodDelta != null ? `${body.periodDelta > 0 ? '+' : ''}${n1(body.periodDelta)} kg no período` : ''
      )
    );
    tiles.push(tile('IMC', n1(body.bmi), bmiCategory(body.bmi)));
  }
  if (training) tiles.push(tile('Treinos feitos', pct(training.adherence), `${training.done} de ${training.total} no período`));
  if (games) {
    tiles.push(
      tile(
        'Jogos avaliados',
        String(games.played.length),
        games.avgScore != null ? `nota geral média ${n1(games.avgScore)} de 5` : ''
      )
    );
  }
  if (food) {
    tiles.push(
      tile(
        'Alimentação',
        `${n0(food.avgKcal)} <small>kcal/dia</small>`,
        food.avgProteinPerKg != null ? `${n1(food.avgProteinPerKg)} g de proteína por kg` : `${food.days.length} dias registrados`
      )
    );
  }
  return `<section><h2>Resumo do período</h2><div class="tiles">${tiles.join('')}</div></section>`;
}

function bodySection({ body, profile }) {
  const age = ageFrom(profile.birth_date);
  const range = healthyWeightRange(profile.height_cm);
  const info = table(
    ['Idade', 'Sexo', 'Altura', 'Peso meta', 'Taxa metabólica basal', 'Faixa de peso saudável'],
    [[
      `${age} anos`,
      profile.sex === 'F' ? 'Feminino' : 'Masculino',
      `${formatNumber(profile.height_cm / 100, 2)} m`,
      profile.goal_weight_kg != null ? `${n1(profile.goal_weight_kg)} kg` : '—',
      body.bmr ? `${n0(body.bmr)} kcal/dia` : '—',
      `${n1(range.min)} a ${n1(range.max)} kg`,
    ]]
  );
  const points = body.inPeriod.map((m) => ({ date: parseDateKey(m.date), value: m.weight_kg }));
  const chart = points.length
    ? `<h3>Peso (kg)</h3>${lineChartSvg(points, {
        goal: profile.goal_weight_kg ?? undefined,
        goalLabel: profile.goal_weight_kg != null ? `meta ${n1(profile.goal_weight_kg)}` : '',
        formatDate: shortBR,
      })}`
    : '';
  const rows = [...body.inPeriod].reverse().map((m) => [
    dateBR(m.date),
    String(m.cycle),
    n1(m.weight_kg),
    n1(bmi(m.weight_kg, profile.height_cm)),
    m.waist_cm != null ? n1(m.waist_cm) : '—',
    m.resting_hr ?? '—',
  ]);
  return `<section class="break"><h2>Corpo</h2>${info}${chart}<h3>Medições</h3>${table(
    ['Data', 'Ciclo', 'Peso (kg)', 'IMC', 'Cintura (cm)', 'FC repouso (bpm)'],
    rows,
    { numeric: [1, 2, 3, 4, 5] }
  )}</section>`;
}

function trainingSection({ training, exercises, weekCount }) {
  const bars = training.weeks.map((w) => ({
    label: `${w.letter} ${shortBR(w.start)}`,
    value: w.total ? (w.done / w.total) * 100 : 0,
    partial: w.isCurrent,
  }));
  const chart = barChartSvg(bars, { max: 100, formatTick: (t) => `${t}%` });
  const rows = [...training.weeks].reverse().map((w) => [
    `${shortBR(w.start)} a ${shortBR(w.end)}${w.isCurrent ? ' <em>(em andamento)</em>' : ''}`,
    w.letter,
    String(w.cycle),
    `${w.done}/${w.total}`,
    w.total ? pct(w.done / w.total) : '—',
  ]);

  // plano atual: cada semana do ciclo, dia a dia
  const plan = lettersFor(weekCount)
    .map((letter) => {
      const days = WEEKDAYS_DISPLAY.map((code) => {
        const items = exercises.filter((e) => hasWeek(e, letter) && hasDay(e, code));
        if (items.length === 0) return '';
        const list = items
          .map((e) => `<li><strong>${esc(e.name)}</strong>${e.details ? ` — ${esc(e.details)}` : ''}</li>`)
          .join('');
        return `<div class="plan-day"><div class="plan-day-name">${esc(weekdayName(code))}</div><ul>${list}</ul></div>`;
      }).join('');
      return `<div class="plan-week"><h4>Semana ${letter}</h4>${days || '<p class="empty">Sem exercícios.</p>'}</div>`;
    })
    .join('');

  return `<section class="break"><h2>Treinos</h2>
    <h3>Treinos feitos por semana (%)</h3>${chart}
    <p class="note">A barra clara é a semana em andamento.</p>
    ${table(['Semana', 'Letra', 'Ciclo', 'Feitos', '%'], rows, { numeric: [2, 3, 4] })}
    <h3>Plano de treino atual</h3>${plan}</section>`;
}

function gamesSection({ games, allWeeks, measurements }) {
  const parts = [];
  const enriched = enrichGames(games.logs, allWeeks);
  const evo = gameEvolution(enriched);
  const effect = trainingEffect(enriched);
  const insights = buildInsights({ games: enriched, allLogs: games.logs, weekSummaries: allWeeks, measurements });

  if (evo) {
    parts.push(`<div class="hero"><div class="hero-value">${signedPct(evo.percent)}</div><div>de evolução na nota geral dos jogos (habilidade, intensidade e físico), das primeiras para as últimas partidas do período.</div></div>`);
    parts.push(
      table(
        ['Modalidade', 'Jogos', 'Nota no início', 'Nota no fim', 'Evolução', 'Treinos antes (início → fim)'],
        evo.perModality.map((m) => [
          esc(m.modality),
          String(m.count),
          n1(m.from),
          n1(m.to),
          signedPct(m.percent),
          m.adherenceFrom != null && m.adherenceTo != null ? `${pct(m.adherenceFrom)} → ${pct(m.adherenceTo)}` : '—',
        ]),
        { numeric: [1, 2, 3, 4] }
      )
    );
  }

  const groups = byModality(games.logs);
  if (groups.length) {
    parts.push('<h3>Médias por modalidade (últimas 4 partidas)</h3>');
    parts.push(
      table(
        ['Modalidade', ...METRICS.map((m) => m.short)],
        groups.map((g) => [
          esc(g.modality),
          ...g.metrics.map((m) => (m.value == null ? '—' : m.unit ? `${n0(m.value)} ${m.unit}` : `${n1(m.value)}/5`)),
        ]),
        { numeric: [1, 2, 3, 4] }
      )
    );
  }

  if (effect) {
    parts.push('<h3>Treino em dia x pouco treino (14 dias antes do jogo)</h3>');
    const row = (label, key) => [
      label,
      n1(effect.stats[key].high),
      n1(effect.stats[key].low),
      signedPct(effect.stats[key].percent),
    ];
    parts.push(
      table(
        ['Nota', `Treino em dia (${effect.high} jogos)`, `Pouco treino (${effect.low})`, 'Diferença'],
        [row('Nota geral', 'score'), row('Habilidade', 'skill'), row('Intensidade', 'intensity'), row('Físico no fim', 'stamina')],
        { numeric: [1, 2, 3] }
      )
    );
  }

  if (insights.length) {
    parts.push('<h3>O que os dados mostram</h3><ul class="insights">');
    for (const i of insights) {
      parts.push(`<li><span class="icon">${i.icon}</span> ${esc(i.text)}${i.detail ? `<br><small>${esc(i.detail)}</small>` : ''}</li>`);
    }
    parts.push('</ul><p class="note">São relações nos dados, não prova de causa: adversário, cansaço e horário também pesam.</p>');
  }

  const resultLabel = (v) => RESULTS.find((r) => r.value === v)?.label ?? '—';
  const rows = [...games.logs].reverse().map((l) =>
    l.played === 0
      ? [dateBR(l.date), esc(l.name), esc(l.modality), '<em>não teve jogo</em>', '', '', '', '', '', '']
      : [
          dateBR(l.date),
          esc(l.name),
          esc(l.modality),
          `${l.skill} / ${l.intensity} / ${l.stamina}`,
          l.minutes ?? '—',
          l.opponent_level != null ? `${l.opponent_level}/5` : '—',
          resultLabel(l.result),
          `${l.goals ?? 0} / ${l.assists ?? 0}`,
          l.pain === 1 ? 'sim' : '',
          esc(l.notes ?? ''),
        ]
  );
  parts.push('<h3>Todas as partidas do período</h3>');
  parts.push(
    table(['Data', 'Jogo', 'Modalidade', 'Hab / Int / Fís', 'Min', 'Adversário', 'Resultado', 'Gols / Assist.', 'Dor', 'Observações'], rows, {
      numeric: [4],
    })
  );

  return `<section class="break"><h2>Jogos</h2>${parts.join('')}</section>`;
}

function foodSection({ food, bmr, energy, factor }) {
  const byDate = new Map(food.days.map((d) => [d.date, d]));
  const bars = food.calendar.map((key) => {
    const d = byDate.get(key);
    return { label: shortBR(parseDateKey(key)), value: d?.kcal ?? 0, partial: key === food.today };
  });
  const targets = food.calendar.map((key) => energy[key]?.total ?? null);
  // topo em milhares redondos: as marcas do eixo saem limpas (0 / 2k / 4k)
  const top = Math.max(...bars.map((b) => b.value), ...targets.filter((t) => t != null), 1000);
  const chart = barChartSvg(bars, {
    max: Math.ceil((top * 1.1) / 1000) * 1000,
    formatTick: (t) => (t >= 1000 ? `${formatNumber(t / 1000, t % 1000 ? 1 : 0)}k` : String(t)),
    targets,
  });

  const complete = food.days.filter((d) => d.date !== food.today && energy[d.date]);
  const avgSpent = mean(complete.map((d) => energy[d.date].total));
  const avgBalance = mean(complete.map((d) => d.kcal - energy[d.date].total));
  const weeklyKg = avgBalance != null ? (avgBalance * 7) / 7700 : null;
  const activity = Object.values(energy).reduce(
    (acc, e) => ({ training: acc.training + e.training, games: acc.games + e.games }),
    { training: 0, games: 0 }
  );

  const summary = table(
    ['Dias registrados', 'Consumo médio*', 'Gasto médio*', 'Saldo médio*', 'Proteína/dia', 'Carbo/dia', 'Gordura/dia'],
    [[
      `${food.days.length} de ${food.calendar.length}`,
      `${n0(food.avgKcal)} kcal`,
      avgSpent != null ? `${n0(avgSpent)} kcal` : '—',
      avgBalance != null ? `${avgBalance > 0 ? '+' : ''}${n0(avgBalance)} kcal` : '—',
      food.avgProtein != null ? `${n0(food.avgProtein)} g${food.avgProteinPerKg != null ? ` (${n1(food.avgProteinPerKg)} g/kg)` : ''}` : '—',
      food.avgCarbs != null ? `${n0(food.avgCarbs)} g` : '—',
      food.avgFat != null ? `${n0(food.avgFat)} g` : '—',
    ]],
    { numeric: [1, 2, 3] }
  );
  const energyNote = `<p class="note">Gasto estimado = taxa metabólica basal (${bmr ? `${n0(bmr)} kcal` : '—'}) × ${String(factor).replace('.', ',')} pela rotina fora dos treinos + treinos marcados como feitos + jogos avaliados (cálculo por MET, margem de erro de ~20–30%). No período, treinos somaram ${n0(activity.training)} kcal e jogos ${n0(activity.games)} kcal.${weeklyKg != null ? ` Nesse ritmo, o saldo equivale a ${weeklyKg > 0 ? '+' : ''}${formatNumber(weeklyKg, 2)} kg por semana (ordem de grandeza: ~7.700 kcal por kg) — compare com as medições de peso.` : ''}</p>`;
  const days = [...food.days].reverse().map((d) => {
    const spent = energy[d.date]?.total;
    return [
      dateBR(d.date),
      n0(d.kcal),
      spent != null ? n0(spent) : '—',
      spent != null ? `${d.kcal - spent > 0 ? '+' : ''}${n0(d.kcal - spent)}` : '—',
      n0(d.protein),
      n0(d.carbs),
      n0(d.fat),
    ];
  });
  const topFoods = food.topFoods.map((f) => [esc(f.name), String(f.times), `${n0(f.grams)} g`, n0(f.kcal)]);
  const meals = food.byMeal.map((m) => [esc(mealLabel(m.meal)), n0(m.kcal / Math.max(food.days.length, 1)), pct(m.kcal / Math.max(food.totalKcal, 1))]);

  return `<section class="break"><h2>Alimentação</h2>
    ${summary}
    <p class="note">* Médias dos ${food.completeDays} dias completos registrados (o dia de hoje fica de fora por estar em andamento).</p>
    ${energyNote}
    <h3>Consumo x gasto por dia (kcal)</h3>${chart}
    <p class="note">Barras: consumido. Traço escuro: gasto estimado do dia. Barra clara: hoje, ainda em andamento. Dias sem registro ficam fora das médias.</p>
    <h3>Por refeição (média nos dias registrados)</h3>${table(['Refeição', 'kcal/dia', '% do total'], meals, { numeric: [1, 2] })}
    <h3>Alimentos mais registrados</h3>${table(['Alimento', 'Vezes', 'Quantidade total', 'kcal total'], topFoods, { numeric: [1, 2, 3] })}
    <h3>Dia a dia</h3>${table(['Data', 'Consumo', 'Gasto', 'Saldo', 'Proteína (g)', 'Carbo (g)', 'Gordura (g)'], days, { numeric: [1, 2, 3, 4, 5, 6] })}
  </section>`;
}

// ---------- montagem ----------

/**
 * data: {
 *   generatedAt: Date, period: { label, fromKey, toKey }, sections: { body, training, games, food },
 *   profile, measurements, weeks (resumos semanais, todos), exercises, weekCount,
 *   gameLogs (todos), foodDays, foodCalendar (datas do período), topFoods, mealTotals
 * }
 */
export function buildReportHtml(data) {
  const { period, sections, profile } = data;
  const ctx = {};

  const latest = data.measurements[data.measurements.length - 1];
  const bmr =
    profile && latest
      ? basalMetabolicRate({ weightKg: latest.weight_kg, heightCm: profile.height_cm, age: ageFrom(profile.birth_date), sex: profile.sex })
      : null;

  if (sections.body && profile) {
    const inP = data.measurements.filter((m) => inPeriod(m.date, period));
    ctx.body = {
      latest,
      bmr,
      bmi: latest ? bmi(latest.weight_kg, profile.height_cm) : null,
      inPeriod: inP,
      periodDelta: inP.length > 1 ? inP[inP.length - 1].weight_kg - inP[0].weight_kg : null,
    };
  }

  if (sections.training) {
    const currentStart = data.weeks[data.weeks.length - 1]?.weekStart;
    const weeks = data.weeks
      .filter((w) => w.weekStart <= period.toKey && w.days[6].dateKey >= period.fromKey)
      .map((w) => ({ ...w, isCurrent: w.weekStart === currentStart }));
    const done = weeks.reduce((s, w) => s + w.done, 0);
    const total = weeks.reduce((s, w) => s + w.total, 0);
    ctx.training = { weeks, done, total, adherence: total ? done / total : null };
  }

  if (sections.games) {
    const logs = data.gameLogs.filter((l) => inPeriod(l.date, period));
    const enriched = enrichGames(logs, data.weeks);
    ctx.games = { logs, played: played(logs), avgScore: mean(enriched.map((g) => g.score).filter((s) => s != null)) };
  }

  if (sections.food) {
    const days = data.foodDays;
    // médias só com dias completos: hoje ainda está em andamento
    const complete = days.filter((d) => d.date !== period.toKey);
    const avg = (f) => mean(complete.map((d) => d[f]));
    const avgProtein = avg('protein');
    const totalKcal = days.reduce((s, d) => s + d.kcal, 0);
    ctx.food = {
      days,
      calendar: data.foodCalendar,
      avgKcal: avg('kcal'),
      avgProtein,
      avgCarbs: avg('carbs'),
      avgFat: avg('fat'),
      avgProteinPerKg: avgProtein != null && latest ? avgProtein / latest.weight_kg : null,
      topFoods: data.topFoods,
      byMeal: data.mealTotals,
      totalKcal,
      completeDays: complete.length,
      today: period.toKey,
    };
  }

  const body = [
    summarySection(ctx),
    ctx.body ? bodySection({ body: ctx.body, profile }) : '',
    ctx.training ? trainingSection({ training: ctx.training, exercises: data.exercises, weekCount: data.weekCount }) : '',
    ctx.games ? gamesSection({ games: ctx.games, allWeeks: data.weeks, measurements: data.measurements }) : '',
    ctx.food ? foodSection({ food: ctx.food, bmr, energy: data.energyByDate ?? {}, factor: data.activityFactor ?? 1.2 }) : '',
  ].join('');

  const generated = `${formatDateBR(data.generatedAt)} às ${String(data.generatedAt.getHours()).padStart(2, '0')}:${String(
    data.generatedAt.getMinutes()
  ).padStart(2, '0')}`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relatório de treino${profile ? ` — ${esc(profile.name)}` : ''}</title>
<style>${CSS}</style></head><body>
<header class="cover">
  <div class="brand">⚽ Treino Futebol</div>
  <h1>Relatório de treino${profile ? ` — ${esc(profile.name)}` : ''}</h1>
  <div class="meta">Período: <strong>${esc(period.label)}</strong>${
    period.fromKey === period.toKey ? '' : ` (${dateBR(period.fromKey)} a ${dateBR(period.toKey)})`
  } · gerado em ${generated}</div>
</header>
${body}
<footer>
  Alimentos: Tabela Brasileira de Composição de Alimentos (TACO, NEPA/UNICAMP, 4ª ed.) e medidas caseiras da POF 2008-2009 (IBGE).
  IMC, taxa metabólica basal (Mifflin-St Jeor) e calorias são estimativas gerais e não substituem avaliação de profissionais de saúde.
</footer>
</body></html>`;
}

const CSS = `
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, Roboto, "Segoe UI", Helvetica, Arial, sans-serif; color: #1b1f1d; font-size: 11px; line-height: 1.45; margin: 0; }
.cover { border-bottom: 3px solid #0f7b3f; padding-bottom: 10px; margin-bottom: 14px; }
.brand { color: #0f7b3f; font-weight: 700; font-size: 12px; letter-spacing: .3px; }
h1 { font-size: 22px; margin: 4px 0 4px; }
.meta { color: #6b7570; font-size: 11px; }
h2 { font-size: 16px; color: #0f7b3f; margin: 0 0 10px; padding-bottom: 4px; border-bottom: 1px solid #d7ddd9; }
h3 { font-size: 12.5px; margin: 16px 0 6px; }
h4 { font-size: 12px; margin: 10px 0 4px; color: #0f7b3f; }
section { margin-bottom: 18px; }
section.break { page-break-before: always; break-before: page; }
.tiles { display: flex; flex-wrap: wrap; gap: 8px; }
.tile { flex: 1 1 30%; border: 1px solid #d7ddd9; border-radius: 8px; padding: 8px 10px; }
.tile-label { color: #6b7570; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .3px; }
.tile-value { font-size: 20px; font-weight: 800; margin-top: 2px; }
.tile-value small { font-size: 11px; font-weight: 500; color: #6b7570; }
.tile-note { color: #6b7570; font-size: 10px; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; font-size: 10.5px; }
thead { display: table-header-group; }
th { text-align: left; background: #eef4f0; color: #1b1f1d; font-weight: 700; padding: 5px 6px; border-bottom: 1px solid #c9d3cd; }
td { padding: 4px 6px; border-bottom: 1px solid #eceff0; vertical-align: top; }
tr { page-break-inside: avoid; }
tbody tr:nth-child(even) td { background: #fafbfa; }
.num { text-align: right; white-space: nowrap; }
.note { color: #6b7570; font-size: 10px; margin: 2px 0 8px; }
.empty { color: #6b7570; font-style: italic; }
.hero { display: flex; align-items: center; gap: 12px; border: 1px solid #d7ddd9; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }
.hero-value { font-size: 30px; font-weight: 800; color: #0f7b3f; }
.insights { padding-left: 0; list-style: none; margin: 4px 0; }
.insights li { padding: 5px 0; border-bottom: 1px solid #eceff0; }
.insights small { color: #6b7570; }
.icon { display: inline-block; width: 18px; }
.plan-week { page-break-inside: avoid; }
.plan-day { display: flex; gap: 8px; padding: 3px 0; border-bottom: 1px solid #eceff0; }
.plan-day-name { width: 95px; font-weight: 700; flex-shrink: 0; }
.plan-day ul { margin: 0; padding-left: 14px; }
svg { display: block; margin: 4px 0; }
footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #d7ddd9; color: #6b7570; font-size: 9.5px; }
`;
