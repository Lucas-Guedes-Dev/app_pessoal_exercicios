// Intervalos de datas para o relatório. Todos terminam no máximo em hoje.
import { addDays, formatDateBR, parseDateKey, toDateKey } from '../utils/dates';

export const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const clipToToday = (key, todayKey) => (key > todayKey ? todayKey : key);

export function dayPeriod(dateKey) {
  return { fromKey: dateKey, toKey: dateKey, label: `Dia ${formatDateBR(parseDateKey(dateKey))}`, file: dateKey };
}

/** month: 0-11. O mês atual vai só até hoje. */
export function monthPeriod(year, month, today = new Date()) {
  const first = new Date(year, month, 1, 12);
  const last = new Date(year, month + 1, 0, 12);
  const mm = String(month + 1).padStart(2, '0');
  return {
    fromKey: toDateKey(first),
    toKey: clipToToday(toDateKey(last), toDateKey(today)),
    label: `${MONTHS[month]} de ${year}`,
    file: `${year}-${mm}`,
  };
}

/**
 * Ciclos a partir das semanas registradas ({ weekStart, letter, cycle }).
 * Retorna do mais recente para o mais antigo: [{ cycle, fromKey, toKey, letters, current }].
 */
export function cyclesFrom(cycleWeeks, today = new Date()) {
  const todayKey = toDateKey(today);
  const map = new Map();
  for (const w of cycleWeeks) {
    const c = map.get(w.cycle) ?? { cycle: w.cycle, weeks: [] };
    c.weeks.push(w);
    map.set(w.cycle, c);
  }
  const last = cycleWeeks[cycleWeeks.length - 1]?.cycle;
  return [...map.values()]
    .map((c) => {
      const lastWeek = c.weeks[c.weeks.length - 1];
      const end = toDateKey(addDays(parseDateKey(lastWeek.weekStart), 6));
      return {
        cycle: c.cycle,
        fromKey: c.weeks[0].weekStart,
        toKey: clipToToday(end, todayKey),
        letters: c.weeks.map((w) => w.letter).join(' → '),
        current: c.cycle === last,
      };
    })
    .reverse();
}

export function cyclePeriod(c) {
  return {
    fromKey: c.fromKey,
    toKey: c.toKey,
    label: `Ciclo ${c.cycle}${c.current ? ' (atual)' : ''} · semanas ${c.letters}`,
    file: `ciclo-${c.cycle}`,
  };
}

export function customPeriod(fromKey, toKey) {
  return {
    fromKey,
    toKey,
    label: `${formatDateBR(parseDateKey(fromKey))} a ${formatDateBR(parseDateKey(toKey))}`,
    file: `${fromKey}_a_${toKey}`,
  };
}

/** Os últimos N dias, terminando hoje. */
export function lastDaysPeriod(days, today = new Date()) {
  return customPeriod(toDateKey(addDays(today, -(days - 1))), toDateKey(today));
}

export function daysIn(period) {
  return Math.round((parseDateKey(period.toKey) - parseDateKey(period.fromKey)) / 86400000) + 1;
}
