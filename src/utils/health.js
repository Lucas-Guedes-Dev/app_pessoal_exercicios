// Cálculos de saúde. São estimativas gerais, não substituem avaliação profissional.

// Aceita "78,5" ou "78.5"; retorna null se vazio/inválido
export function parseDecimal(text) {
  if (text == null) return null;
  const clean = String(text).trim().replace(',', '.');
  if (clean === '') return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : NaN;
}

export function formatNumber(value, decimals = 1) {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(decimals).replace('.', ',');
}

// "DD/MM/AAAA" -> "AAAA-MM-DD" (ou null se a data não existir)
export function parseBirthBR(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  const date = new Date(y, mo - 1, d, 12);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function formatBirthBR(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}

// Máscara enquanto digita: 01011990 -> 01/01/1990
export function maskDateBR(text) {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function ageFrom(birthKey, today = new Date()) {
  const [y, m, d] = birthKey.split('-').map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
}

export function bmi(weightKg, heightCm) {
  const h = heightCm / 100;
  return weightKg / (h * h);
}

// Classificação da OMS para adultos
export function bmiCategory(value) {
  if (value < 18.5) return 'Abaixo do peso';
  if (value < 25) return 'Peso normal';
  if (value < 30) return 'Sobrepeso';
  if (value < 35) return 'Obesidade grau I';
  if (value < 40) return 'Obesidade grau II';
  return 'Obesidade grau III';
}

// Faixa de peso com IMC entre 18,5 e 24,9
export function healthyWeightRange(heightCm) {
  const h = heightCm / 100;
  return { min: 18.5 * h * h, max: 24.9 * h * h };
}

// Taxa metabólica basal (Mifflin-St Jeor), em kcal/dia
export function basalMetabolicRate({ weightKg, heightCm, age, sex }) {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'F' ? -161 : 5);
}
