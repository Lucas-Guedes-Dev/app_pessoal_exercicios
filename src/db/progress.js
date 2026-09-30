import { getAllExercises, getCycleWeeks, getDoneCompletionsBetween } from './database';
import { buildWeekSummary, toDoneSet } from '../utils/weekSummary';

// Controla o pedido de medidas ao fim do ciclo: "Agora não" só vale até o app ser fechado
let checkInDismissed = false;
export const dismissCheckIn = () => {
  checkInDismissed = true;
};
export const isCheckInDismissed = () => checkInDismissed;

/**
 * Resumo dos treinos: cada semana do ciclo (mais antiga primeiro) com total e
 * concluídos, e o agregado por ciclo.
 */
export async function getTrainingProgress() {
  const [weeks, exercises] = await Promise.all([getCycleWeeks(), getAllExercises()]);
  if (weeks.length === 0) return { weeks: [], cycles: [], totalDone: 0 };

  const completions = await getDoneCompletionsBetween(weeks[0].weekStart, '9999-12-31');
  const doneSet = toDoneSet(completions);
  const summaries = weeks.map((w) => buildWeekSummary(w, exercises, doneSet));

  const byCycle = new Map();
  for (const w of summaries) {
    const c = byCycle.get(w.cycle) ?? { cycle: w.cycle, done: 0, total: 0, weeks: [] };
    c.done += w.done;
    c.total += w.total;
    c.weeks.push(w);
    byCycle.set(w.cycle, c);
  }

  return {
    weeks: summaries,
    cycles: [...byCycle.values()],
    totalDone: summaries.reduce((sum, w) => sum + w.done, 0),
  };
}
