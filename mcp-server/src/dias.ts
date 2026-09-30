// Mesma representação do app (src/utils/dates.js e src/utils/weeks.js)
export const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'] as const;
export type Dia = (typeof DIAS)[number];

export const SEMANAS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export const TODAS_SEMANAS = SEMANAS.join(',');

const NOMES_DIAS: Record<Dia, string> = {
  Seg: 'Segunda-feira',
  Ter: 'Terça-feira',
  Qua: 'Quarta-feira',
  Qui: 'Quinta-feira',
  Sex: 'Sexta-feira',
  Sab: 'Sábado',
  Dom: 'Domingo',
};

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Aceita "Ter", "terça", "Terça-feira", "TER"... e devolve o código do app ("Ter"). */
export function normalizarDia(valor: string): Dia | null {
  const chave = semAcento(valor.trim().toLowerCase()).slice(0, 3);
  return DIAS.find((d) => d.toLowerCase() === chave) ?? null;
}

/** Converte a lista recebida em "Ter,Qui" (ordem Seg → Dom, sem repetição). */
export function diasParaTexto(dias: string[]): string {
  const invalidos = dias.filter((d) => !normalizarDia(d));
  if (invalidos.length) {
    throw new Error(`Dia(s) inválido(s): ${invalidos.join(', ')}. Use: ${DIAS.join(', ')}.`);
  }
  const codigos = new Set(dias.map((d) => normalizarDia(d)));
  return DIAS.filter((d) => codigos.has(d)).join(',');
}

export function semanasParaTexto(semanas: string[]): string {
  const letras = new Set(semanas.map((s) => s.trim().toUpperCase()));
  const invalidas = [...letras].filter((l) => !(SEMANAS as readonly string[]).includes(l));
  if (invalidas.length) {
    throw new Error(`Semana(s) inválida(s): ${invalidas.join(', ')}. Use letras de A a F.`);
  }
  return SEMANAS.filter((s) => letras.has(s)).join(',');
}

export function temDia(diaSemana: string, dia: Dia): boolean {
  return diaSemana.split(',').includes(dia);
}

export function nomeDia(dia: Dia): string {
  return NOMES_DIAS[dia];
}
