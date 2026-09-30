import { ageFrom, parseBirthBR, parseDecimal } from './health';

// Valida um número dentro de uma faixa plausível. Retorna { value, error }.
export function checkNumber(text, { label, min, max, required = true, integer = false }) {
  const value = parseDecimal(text);
  if (value == null) return required ? { error: `Informe ${label}.` } : { value: null };
  if (Number.isNaN(value)) return { error: 'Número inválido.' };
  if (value < min || value > max) return { error: `Use um valor entre ${min} e ${max}.` };
  return { value: integer ? Math.round(value) : value };
}

// Campos de medição usados no cadastro inicial e no check-in
export function validateMeasurement({ weight, waist, restingHr }) {
  const w = checkNumber(weight, { label: 'o peso', min: 30, max: 300 });
  const c = checkNumber(waist, { label: 'a cintura', min: 40, max: 200, required: false });
  const hr = checkNumber(restingHr, { label: 'a frequência', min: 30, max: 130, required: false, integer: true });
  const errors = {};
  if (w.error) errors.weight = w.error;
  if (c.error) errors.waist = c.error;
  if (hr.error) errors.restingHr = hr.error;
  return { errors, data: { weightKg: w.value, waistCm: c.value, restingHr: hr.value } };
}

export function validateProfile({ name, sex, birth, height, goal }) {
  const errors = {};
  if (!name.trim()) errors.name = 'Informe seu nome.';
  if (!sex) errors.sex = 'Selecione o sexo.';

  const birthDate = parseBirthBR(birth);
  if (!birthDate) errors.birth = 'Use o formato DD/MM/AAAA.';
  else {
    const age = ageFrom(birthDate);
    if (age < 8 || age > 100) errors.birth = 'Data de nascimento fora do esperado.';
  }

  const h = checkNumber(height, { label: 'a altura', min: 100, max: 250 });
  const g = checkNumber(goal, { label: 'a meta', min: 30, max: 300, required: false });
  if (h.error) errors.height = h.error;
  if (g.error) errors.goal = g.error;

  return {
    errors,
    data: { name: name.trim(), sex, birthDate, heightCm: h.value, goalWeightKg: g.value },
  };
}
