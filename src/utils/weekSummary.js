import { WEEKDAYS_DISPLAY, addDays, parseDateKey, toDateKey } from './dates';
import { hasDay, hasWeek } from './weeks';

/**
 * Monta o resumo de uma semana do ciclo: para cada dia (Seg → Dom), quais
 * exercícios estavam programados e quais foram marcados como feitos.
 * Exercícios criados depois daquele dia não contam.
 */
export function buildWeekSummary(week, exercises, doneSet) {
  const start = parseDateKey(week.weekStart);
  const days = WEEKDAYS_DISPLAY.map((code, i) => {
    const date = addDays(start, i);
    const dateKey = toDateKey(date);
    const items = exercises
      .filter((e) => hasWeek(e, week.letter) && hasDay(e, code))
      .filter((e) => !e.created_at || e.created_at.slice(0, 10) <= dateKey)
      .map((e) => ({ id: e.id, name: e.name, done: doneSet.has(`${e.id}|${dateKey}`) }));
    return { code, date, dateKey, items };
  });

  const total = days.reduce((sum, d) => sum + d.items.length, 0);
  const done = days.reduce((sum, d) => sum + d.items.filter((i) => i.done).length, 0);
  return { ...week, start, end: addDays(start, 6), days, total, done };
}

export function toDoneSet(completions) {
  return new Set(completions.map((c) => `${c.exercise_id}|${c.date}`));
}
