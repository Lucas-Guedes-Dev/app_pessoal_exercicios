// Gráficos do relatório em SVG puro (o PDF é gerado a partir de HTML).
// Sem interação no papel: os valores ficam nas tabelas logo abaixo de cada gráfico.
import { linear, niceDomain } from '../components/charts/scale';

const C = {
  primary: '#0f7b3f',
  grid: '#e3e8e5',
  axis: '#b9c2bd',
  muted: '#6b7570',
  text: '#1b1f1d',
  surface: '#ffffff',
};

const fmt = (n, d = 1) => n.toFixed(d).replace('.', ',');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Linha de uma série. points: [{ date: Date, value }]. Rotula o primeiro e o último valor.
 * goal: número opcional desenhado como linha tracejada.
 */
export function lineChartSvg(points, { width = 700, height = 220, decimals = 1, goal, goalLabel, formatDate } = {}) {
  if (points.length === 0) return '';
  const pad = { top: 16, right: 56, bottom: 26, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const values = points.map((p) => p.value);
  const domain = niceDomain(goal != null ? [...values, goal] : values);
  const times = points.map((p) => p.date.getTime());
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const x = tMax === tMin ? () => pad.left + plotW / 2 : linear(tMin, tMax, pad.left, pad.left + plotW);
  const y = linear(domain.min, domain.max, pad.top + plotH, pad.top);

  const parts = [];
  for (const t of domain.ticks) {
    parts.push(`<line x1="${pad.left}" x2="${pad.left + plotW}" y1="${y(t)}" y2="${y(t)}" stroke="${C.grid}" />`);
    parts.push(`<text x="${pad.left - 6}" y="${y(t) + 4}" font-size="11" fill="${C.muted}" text-anchor="end">${fmt(t, Number.isInteger(t) ? 0 : 1)}</text>`);
  }
  if (goal != null) {
    parts.push(`<line x1="${pad.left}" x2="${pad.left + plotW}" y1="${y(goal)}" y2="${y(goal)}" stroke="${C.muted}" stroke-width="1.5" stroke-dasharray="5,4" />`);
    parts.push(`<text x="${pad.left + plotW + 4}" y="${y(goal) + 4}" font-size="11" fill="${C.muted}">${esc(goalLabel ?? '')}</text>`);
  }
  const xs = points.map((p) => x(p.date.getTime()));
  const ys = points.map((p) => y(p.value));
  if (points.length > 1) {
    const d = xs.map((px, i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="${C.primary}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`);
  }
  points.forEach((_, i) => {
    parts.push(`<circle cx="${xs[i]}" cy="${ys[i]}" r="4" fill="${C.primary}" stroke="${C.surface}" stroke-width="2" />`);
  });
  // rótulos diretos só nas pontas
  const label = (i, anchor) =>
    parts.push(`<text x="${xs[i] + (anchor === 'start' ? 8 : -8)}" y="${ys[i] - 8}" font-size="11" font-weight="700" fill="${C.text}" text-anchor="${anchor}">${fmt(points[i].value, decimals)}</text>`);
  if (points.length > 1) label(0, 'start');
  label(points.length - 1, points.length > 1 ? 'end' : 'start');

  parts.push(`<text x="${xs[0]}" y="${height - 6}" font-size="11" fill="${C.muted}" text-anchor="${points.length > 1 ? 'start' : 'middle'}">${esc(formatDate(points[0].date))}</text>`);
  if (points.length > 1) {
    parts.push(`<text x="${xs[xs.length - 1]}" y="${height - 6}" font-size="11" fill="${C.muted}" text-anchor="end">${esc(formatDate(points[points.length - 1].date))}</text>`);
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

/**
 * Barras de uma série, ancoradas em zero, cantos de cima arredondados.
 * bars: [{ label, value, partial }]. reference: { value, label } tracejada.
 */
export function barChartSvg(bars, { width = 700, height = 200, max, formatTick = (t) => String(t), reference, targets } = {}) {
  if (bars.length === 0) return '';
  const pad = { top: 16, right: 64, bottom: 24, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const top = max ?? Math.max(...bars.map((b) => b.value), 1);
  const y = linear(0, top, pad.top + plotH, pad.top);
  const slot = plotW / bars.length;
  const barW = Math.max(Math.min(slot - 2, 26), 2);
  const labelEvery = Math.ceil(bars.length / 16); // não amontoa rótulos

  const parts = [];
  for (const t of [0, top / 2, top]) {
    parts.push(`<line x1="${pad.left}" x2="${pad.left + plotW}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? C.axis : C.grid}" />`);
    parts.push(`<text x="${pad.left - 6}" y="${y(t) + 4}" font-size="11" fill="${C.muted}" text-anchor="end">${esc(formatTick(t))}</text>`);
  }
  bars.forEach((b, i) => {
    const cx = pad.left + slot * i + slot / 2;
    const h = Math.max(y(0) - y(Math.max(b.value, 0)), 0);
    if (h > 0) {
      const r = Math.min(4, barW / 2, h);
      const x0 = cx - barW / 2;
      const yt = y(0) - h;
      parts.push(
        `<path d="M${x0},${y(0)} L${x0},${yt + r} Q${x0},${yt} ${x0 + r},${yt} L${x0 + barW - r},${yt} Q${x0 + barW},${yt} ${x0 + barW},${yt + r} L${x0 + barW},${y(0)} Z" fill="${C.primary}" opacity="${b.partial ? 0.45 : 1}" />`
      );
    }
    if (i % labelEvery === 0) {
      parts.push(`<text x="${cx}" y="${height - 6}" font-size="10" fill="${C.muted}" text-anchor="middle">${esc(b.label)}</text>`);
    }
  });
  // meta por barra (ex.: gasto do dia): traço escuro com contorno branco
  targets?.forEach((t, i) => {
    if (t == null || t > top) return;
    const cx = pad.left + slot * i + slot / 2;
    const x1 = cx - barW / 2 - 2;
    const x2 = cx + barW / 2 + 2;
    parts.push(`<line x1="${x1}" x2="${x2}" y1="${y(t)}" y2="${y(t)}" stroke="${C.surface}" stroke-width="5" stroke-linecap="round" />`);
    parts.push(`<line x1="${x1}" x2="${x2}" y1="${y(t)}" y2="${y(t)}" stroke="${C.text}" stroke-width="2.5" stroke-linecap="round" />`);
  });
  if (reference && reference.value <= top) {
    parts.push(`<line x1="${pad.left}" x2="${pad.left + plotW}" y1="${y(reference.value)}" y2="${y(reference.value)}" stroke="${C.text}" stroke-width="1.5" stroke-dasharray="5,4" />`);
    parts.push(`<text x="${pad.left + plotW + 4}" y="${y(reference.value) + 4}" font-size="11" fill="${C.text}">${esc(reference.label)}</text>`);
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}
