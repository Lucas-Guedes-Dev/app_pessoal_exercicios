import { getAllExercises, getGameLogs, getMeasurements, getProfile, getSetting, setSetting } from './database';
import { getTrainingProgress } from './progress';
import { parseDateKey } from '../utils/dates';
import { DEFAULT_FACTOR, dailyEnergy, dateRange } from '../utils/energy';
import { ageFrom, basalMetabolicRate } from '../utils/health';

const FACTOR_KEY = 'activity_factor';

export async function getActivityFactor() {
  const v = Number(await getSetting(FACTOR_KEY));
  return v > 1 ? v : DEFAULT_FACTOR;
}

export async function setActivityFactor(factor) {
  await setSetting(FACTOR_KEY, String(factor));
}

/**
 * Gasto estimado por dia entre duas datas (YYYY-MM-DD, inclusive).
 * Retorna { byDate: Map, factor } — byDate vazio se ainda não houver perfil e peso.
 */
export async function getDailyEnergy(fromKey, toKey) {
  const [profile, measurements, training, exercises, gameLogs, factor] = await Promise.all([
    getProfile(),
    getMeasurements(),
    getTrainingProgress(),
    getAllExercises(),
    getGameLogs(),
    getActivityFactor(),
  ]);
  if (!profile || measurements.length === 0) return { byDate: new Map(), factor };

  const age = ageFrom(profile.birth_date);
  const byDate = dailyEnergy({
    dateKeys: dateRange(parseDateKey(fromKey), parseDateKey(toKey)),
    weekSummaries: training.weeks,
    exercisesById: new Map(exercises.map((e) => [e.id, e])),
    gameLogs,
    measurements,
    bmrFor: (weightKg) => basalMetabolicRate({ weightKg, heightCm: profile.height_cm, age, sex: profile.sex }),
    factor,
  });
  return { byDate, factor };
}
