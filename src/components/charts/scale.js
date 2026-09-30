// Escalas e marcações "redondas" para os eixos dos gráficos

function niceStep(rawStep) {
  const exp = Math.floor(Math.log10(rawStep));
  const base = rawStep / 10 ** exp;
  const nice = base <= 1 ? 1 : base <= 2 ? 2 : base <= 2.5 ? 2.5 : base <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

// Domínio com folga e ~4 marcações em valores redondos
export function niceDomain(values, { minSpan = 2, ticks = 4 } = {}) {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < minSpan) {
    const mid = (max + min) / 2;
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
  }
  const step = niceStep((max - min) / (ticks - 1));
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const result = [];
  for (let v = lo; v <= hi + step / 2; v += step) result.push(Number(v.toFixed(6)));
  return { min: lo, max: hi, ticks: result };
}

export function linear(domainMin, domainMax, rangeMin, rangeMax) {
  const span = domainMax - domainMin || 1;
  return (v) => rangeMin + ((v - domainMin) / span) * (rangeMax - rangeMin);
}

// Índice do item cujo x está mais perto do toque
export function nearestIndex(xs, touchX) {
  let best = 0;
  for (let i = 1; i < xs.length; i++) {
    if (Math.abs(xs[i] - touchX) < Math.abs(xs[best] - touchX)) best = i;
  }
  return best;
}
