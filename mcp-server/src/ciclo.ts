import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SEMANAS } from './dias.js';

const TABELA = 'ciclo';
const COLUNAS = 'semanas, semana_atual, semana_inicio, atualizado_em';
const DIA_MS = 24 * 60 * 60 * 1000;

type Ciclo = {
  semanas: number;
  semana_atual: string | null;
  semana_inicio: string | null;
  atualizado_em: string;
};

// ---------- Datas no fuso do usuário (mesma regra do app: a semana vira na segunda) ----------

function hojeSaoPaulo(): string {
  // en-CA formata como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function paraData(chave: string): Date {
  return new Date(`${chave}T12:00:00Z`);
}

function segundaDaSemana(chave: string): string {
  const d = paraData(chave);
  const diff = (d.getUTCDay() + 6) % 7; // segunda = 0 ... domingo = 6
  return new Date(d.getTime() - diff * DIA_MS).toISOString().slice(0, 10);
}

function semanasEntre(de: string, ate: string): number {
  return Math.round((paraData(ate).getTime() - paraData(de).getTime()) / (7 * DIA_MS));
}

// Igual a shiftLetter do app (src/utils/weeks.js)
function avancarLetra(letra: string, passos: number, total: number): string {
  let idx = Math.max((SEMANAS as readonly string[]).indexOf(letra), 0);
  if (idx >= total) idx = total - 1;
  return SEMANAS[(idx + passos) % total];
}

/** Letra da semana de hoje segundo a configuração salva (null se não houver âncora). */
function letraDeHoje(c: Pick<Ciclo, 'semanas' | 'semana_atual' | 'semana_inicio'>): string | null {
  if (!c.semana_atual || !c.semana_inicio) return null;
  const passos = semanasEntre(c.semana_inicio, segundaDaSemana(hojeSaoPaulo()));
  return passos < 0 ? c.semana_atual : avancarLetra(c.semana_atual, passos, c.semanas);
}

function descrever(c: Ciclo) {
  const letras = SEMANAS.slice(0, c.semanas);
  return {
    semanas_no_ciclo: c.semanas,
    sequencia: `${letras.join(' → ')} → A`,
    semana_de_hoje: letraDeHoje(c),
    atualizado_em: c.atualizado_em,
  };
}

function ok(texto: string, dados: unknown) {
  return { content: [{ type: 'text' as const, text: `${texto}\n\n${JSON.stringify(dados, null, 2)}` }] };
}

function erro(texto: string) {
  return { content: [{ type: 'text' as const, text: texto }], isError: true };
}

async function lerCiclo(supabase: SupabaseClient): Promise<Ciclo | null> {
  const { data, error } = await supabase.from(TABELA).select(COLUNAS).eq('id', 1).maybeSingle();
  if (error) throw new Error(`Erro ao ler o ciclo no Supabase: ${error.message}`);
  return (data as Ciclo | null) ?? null;
}

export function registrarFerramentasCiclo(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    'ver_ciclo',
    {
      title: 'Ver ciclo de semanas',
      description:
        'Mostra quantas semanas tem o ciclo de treino (A, B, C...) e qual é a semana de hoje. ' +
        'Use antes de montar treinos por semana, para saber quais letras realmente aparecem no app.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const c = await lerCiclo(supabase);
        if (!c) {
          return erro(
            'O ciclo ainda não foi configurado por aqui. O app está usando a configuração local ' +
              '(padrão: 3 semanas, A → B → C). Use configurar_ciclo para definir.'
          );
        }
        return ok('Ciclo de semanas atual.', descrever(c));
      } catch (e) {
        return erro(e instanceof Error ? e.message : String(e));
      }
    }
  );

  server.registerTool(
    'configurar_ciclo',
    {
      title: 'Configurar ciclo de semanas',
      description:
        'Define quantas semanas tem o ciclo de treino (1 a 6, letras A a F) e/ou em qual semana o ' +
        'usuário está agora. O app troca de letra toda segunda-feira e volta para a A depois da ' +
        'última. Exercícios cadastrados em letras fora do ciclo ficam ocultos no app. ' +
        'O app aplica a mudança na próxima sincronização (ao abrir ou puxar a tela).',
      inputSchema: {
        semanas: z
          .number()
          .int()
          .min(1)
          .max(6)
          .optional()
          .describe('Quantidade de semanas no ciclo. Ex.: 6 para A → B → C → D → E → F.'),
        semana_atual: z
          .string()
          .optional()
          .describe('Letra da semana em que o usuário está AGORA (A a F). Omita para manter a sequência atual.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ semanas, semana_atual }) => {
      try {
        if (semanas === undefined && semana_atual === undefined) {
          return erro('Informe semanas e/ou semana_atual.');
        }

        const atual = await lerCiclo(supabase);
        const total = semanas ?? atual?.semanas;
        if (!total) return erro('O ciclo ainda não existe: informe também "semanas".');

        const segunda = segundaDaSemana(hojeSaoPaulo());
        let letra: string | null = null;

        if (semana_atual !== undefined) {
          letra = semana_atual.trim().toUpperCase();
          const idx = (SEMANAS as readonly string[]).indexOf(letra);
          if (idx === -1) return erro(`Semana inválida: ${semana_atual}. Use uma letra de A a F.`);
          if (idx >= total) {
            return erro(`A semana ${letra} não existe num ciclo de ${total} semana(s).`);
          }
        } else if (atual) {
          // Só mudou a quantidade: ancora na letra de hoje (calculada com a configuração antiga)
          const hoje = letraDeHoje(atual);
          if (hoje) letra = (SEMANAS as readonly string[]).indexOf(hoje) >= total ? 'A' : hoje;
        }

        const linha = {
          id: 1,
          semanas: total,
          semana_atual: letra,
          semana_inicio: letra ? segunda : null,
        };

        const { data, error } = await supabase
          .from(TABELA)
          .upsert(linha, { onConflict: 'id' })
          .select(COLUNAS)
          .single();
        if (error) return erro(`Erro ao salvar o ciclo no Supabase: ${error.message}`);

        const texto = letra
          ? `Ciclo salvo. O app vai aplicar na próxima sincronização.`
          : `Ciclo salvo com ${total} semana(s). A semana atual continua a que está no app.`;
        return ok(texto, descrever(data as Ciclo));
      } catch (e) {
        return erro(e instanceof Error ? e.message : String(e));
      }
    }
  );
}
