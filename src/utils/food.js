export const MEALS = [
  { key: 'cafe', label: 'Café da manhã', icon: '☕' },
  { key: 'almoco', label: 'Almoço', icon: '🍛' },
  { key: 'lanche', label: 'Lanche', icon: '🥪' },
  { key: 'jantar', label: 'Jantar', icon: '🍽️' },
  { key: 'ceia', label: 'Ceia', icon: '🌙' },
];

export const mealLabel = (key) => MEALS.find((m) => m.key === key)?.label ?? key;

// Refeição sugerida pelo horário, para o "+" genérico já cair no lugar certo
export function mealForHour(hour = new Date().getHours()) {
  if (hour < 10) return 'cafe';
  if (hour < 15) return 'almoco';
  if (hour < 18) return 'lanche';
  if (hour < 22) return 'jantar';
  return 'ceia';
}

export const SOURCE_NOTES = {
  rotulo: 'Valor médio de rótulo — confira o do produto que você usa.',
  estimado: 'Estimado a partir do alimento cru (rendimento típico do cozimento).',
  custom: 'Alimento cadastrado por você.',
};

/** Calorias e macros de uma quantidade em gramas (valores do alimento são por 100 g). */
export function nutrientsFor(food, grams) {
  const f = grams / 100;
  return {
    kcal: food.kcal * f,
    protein: food.protein * f,
    carbs: food.carbs * f,
    fat: food.fat * f,
  };
}

export function sumNutrients(entries) {
  return entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      protein: acc.protein + e.protein,
      carbs: acc.carbs + e.carbs,
      fat: acc.fat + e.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

// "2 conchas", "1,5 colher de sopa", "150 g"
export function describeAmount(entry) {
  if (entry.portion_label && entry.portion_qty) {
    const qty = String(Math.round(entry.portion_qty * 100) / 100).replace('.', ',');
    return `${qty} × ${entry.portion_label} (${Math.round(entry.grams)} g)`;
  }
  return `${Math.round(entry.grams)} g`;
}

export const formatKcal = (n) => Math.round(n).toLocaleString('pt-BR');
