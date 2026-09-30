export const WEEK_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const MIN_WEEKS = 1;
export const MAX_WEEKS = WEEK_LETTERS.length;
export const DEFAULT_WEEKS = 3;

export function lettersFor(count) {
  return WEEK_LETTERS.slice(0, Math.min(Math.max(count, MIN_WEEKS), MAX_WEEKS));
}

// Avança "steps" semanas no ciclo. Depois da última letra, volta para a A.
export function shiftLetter(letter, steps, count) {
  let idx = Math.max(WEEK_LETTERS.indexOf(letter), 0);
  // letra fora do ciclo (ex.: estava na C e o ciclo foi reduzido para 2) conta como a última
  if (idx >= count) idx = count - 1;
  return WEEK_LETTERS[(idx + steps) % count];
}

export function hasWeek(exercise, letter) {
  return exercise.weeks.split(',').includes(letter);
}

export function hasDay(exercise, dayCode) {
  return exercise.days.split(',').includes(dayCode);
}
