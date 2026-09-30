// Ordem igual a Date.getDay(): 0 = domingo ... 6 = sábado
export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

// Ordem de exibição (semana começando na segunda)
export const WEEKDAYS_DISPLAY = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];

const WEEKDAY_NAMES = {
  Dom: 'Domingo',
  Seg: 'Segunda-feira',
  Ter: 'Terça-feira',
  Qua: 'Quarta-feira',
  Qui: 'Quinta-feira',
  Sex: 'Sexta-feira',
  Sab: 'Sábado',
};

export function weekdayCode(date = new Date()) {
  return WEEKDAYS[date.getDay()];
}

export function weekdayName(code) {
  return WEEKDAY_NAMES[code] ?? code;
}

// YYYY-MM-DD no fuso local (toISOString usaria UTC e erraria o dia à noite)
export function toDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Meio-dia evita problemas de horário de verão ao somar dias
export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Segunda-feira da semana da data informada
export function startOfWeek(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const diff = (d.getDay() + 6) % 7; // segunda = 0 ... domingo = 6
  return addDays(d, -diff);
}

export function formatDateBR(date = new Date()) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()}`;
}

export function formatShortBR(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}`;
}
