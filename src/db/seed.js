// Plano de treino inicial (inserido apenas quando o banco está vazio).
// Tudo começa na Semana A; as semanas B e C são montadas pelo app.
export const SEED_EXERCISES = [
  // CARDIO
  { name: 'Esteira leve', details: 'Cardio · 20 min ritmo leve (dá pra conversar)', days: 'Seg', weeks: 'A' },
  { name: 'Corda resistência', details: 'Cardio · 5 min (2 séries: 2min pulando / 1min descanso)', days: 'Seg', weeks: 'A' },
  { name: 'Corda contínua', details: 'Cardio · 15 min (1min pulando / 1min descanso)', days: 'Qua', weeks: 'A' },
  { name: 'Esteira intervalado leve', details: 'Cardio · 1min rápido + 2min caminhada, 8x', days: 'Sab', weeks: 'A' },

  // FORÇA A (pernas/explosão)
  { name: 'Agachamento livre', details: 'Força A (pernas/explosão) · 3x15-20', days: 'Ter', weeks: 'A' },
  { name: 'Afundo alternado', details: 'Força A (pernas/explosão) · 3x12 cada perna', days: 'Ter', weeks: 'A' },
  { name: 'Agachamento com salto', details: 'Força A (pernas/explosão) · 3x8-10', days: 'Ter', weeks: 'A' },
  { name: 'Panturrilha em pé', details: 'Força A (pernas/explosão) · 3x20', days: 'Ter', weeks: 'A' },
  { name: 'Prancha', details: 'Força A (pernas/explosão) · 3x30-40s', days: 'Ter', weeks: 'A' },

  // FORÇA B (posterior/core)
  { name: 'Levantamento terra unilateral', details: 'Força B (posterior/core) · 3x10 cada perna', days: 'Sex', weeks: 'A' },
  { name: 'Ponte de glúteo', details: 'Força B (posterior/core) · 3x15', days: 'Sex', weeks: 'A' },
  { name: 'Elevação de joelho no ar', details: 'Força B (posterior/core) · 3x15', days: 'Sex', weeks: 'A' },
  { name: 'Prancha lateral', details: 'Força B (posterior/core) · 3x20-30s cada lado', days: 'Sex', weeks: 'A' },
];
