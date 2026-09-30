import { getAllExercises, getGameLogs, getMeasurements, getProfile, getWeekCount } from '../db/database';
import { getDailyEnergy } from '../db/energy';
import { getDailyTotals, getMealTotals, getTopFoods } from '../db/food';
import { getTrainingProgress } from '../db/progress';
import { addDays, parseDateKey, toDateKey } from '../utils/dates';

/** Data (YYYY-MM-DD) do registro mais antigo de qualquer tipo: início do "todo o histórico". */
export async function getEarliestDataKey() {
  const today = toDateKey(new Date());
  const [measurements, training, gameLogs, food] = await Promise.all([
    getMeasurements(),
    getTrainingProgress(),
    getGameLogs(),
    getDailyTotals('0000-01-01', today),
  ]);
  const firsts = [training.weeks[0]?.weekStart, measurements[0]?.date, gameLogs[0]?.date, food[0]?.date].filter(Boolean);
  return firsts.length ? firsts.sort()[0] : today;
}

/**
 * Lê do banco tudo que o relatório precisa.
 * period: { fromKey, toKey, label } (ver report/periods.js); sections: { body, training, games, food }.
 */
export async function collectReportData(period, sections) {
  const { fromKey, toKey } = period;

  const [profile, measurements, training, exercises, weekCount, gameLogs, foodDays, topFoods, mealTotals, energy] =
    await Promise.all([
      getProfile(),
      getMeasurements(),
      getTrainingProgress(),
      getAllExercises(),
      getWeekCount(),
      getGameLogs(),
      getDailyTotals(fromKey, toKey),
      getTopFoods(fromKey, toKey),
      getMealTotals(fromKey, toKey),
      getDailyEnergy(fromKey, toKey),
    ]);

  // todas as datas do período, para o gráfico mostrar os dias sem registro
  const foodCalendar = [];
  for (let d = parseDateKey(fromKey); toDateKey(d) <= toKey; d = addDays(d, 1)) foodCalendar.push(toDateKey(d));

  return {
    generatedAt: new Date(),
    period: { label: period.label, fromKey, toKey },
    sections,
    profile,
    measurements,
    weeks: training.weeks,
    exercises,
    weekCount,
    gameLogs,
    foodDays,
    foodCalendar,
    topFoods,
    mealTotals,
    energyByDate: Object.fromEntries(energy.byDate),
    activityFactor: energy.factor,
  };
}
