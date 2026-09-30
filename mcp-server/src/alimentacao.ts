import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { hojeSaoPaulo } from './ciclo.js';

// Mesmas regras do app: src/db/food.js, src/utils/food.js e src/utils/text.js

const T_ALIMENTOS = 'alimentos';
const T_PORCOES = 'alimento_porcoes';
const T_REGISTROS = 'registros_alimentacao';

const COL_ALIMENTO =
  'id, nome, busca, categoria, kcal, proteina, carbo, gordura, fibra, fonte, observacao, comum, deletado';
const COL_PORCAO = 'id, alimento_id, rotulo, gramas, personalizada';
const COL_REGISTRO =
  'id, data, refeicao, alimento_id, nome, gramas, porcao_rotulo, porcao_qtd, kcal, proteina, carbo, gordura, criado_em';

const REFEICOES = [
  { key: 'cafe', label: 'Café da manhã' },
  { key: 'almoco', label: 'Almoço' },
  { key: 'lanche', label: 'Lanche' },
  { key: 'jantar', label: 'Jantar' },
  { key: 'ceia', label: 'Ceia' },
] as const;
type Refeicao = (typeof REFEICOES)[number]['key'];
const rotuloRefeicao = (k: string) => REFEICOES.find((r) => r.key === k)?.label ?? k;
const ordemRefeicao = (k: string) => REFEICOES.findIndex((r) => r.key === k);

type Alimento = {
  id: number;
  nome: string;
  busca: string;
  categoria: string | null;
  kcal: number;
  proteina: number;
  carbo: number;
  gordura: number;
  fibra: number;
  fonte: 'taco' | 'complemento' | 'custom';
  observacao: string | null;
  comum: boolean;
  deletado: boolean;
};
type Porcao = { id: string; alimento_id: number; rotulo: string; gramas: number; personalizada: boolean };
type Registro = {
  id: string;
  data: string;
  refeicao: Refeicao;
  alimento_id: number | null;
  nome: string;
  gramas: number;
  porcao_rotulo: string | null;
  porcao_qtd: number | null;
  kcal: number;
  proteina: number;
  carbo: number;
  gordura: number;
  criado_em: string;
};
type Nutrientes = { kcal: number; proteina: number; carbo: number; gordura: number };

// ---------- utilitários ----------

// PostgREST devolve numeric como número, mas garantimos (e o seed pode vir como texto)
const n = (v: unknown) => Number(v ?? 0);
const r1 = (v: number) => Math.round(v * 10) / 10;

function paraAlimento(row: Record<string, unknown>): Alimento {
  return {
    ...(row as Alimento),
    id: n(row.id),
    kcal: n(row.kcal),
    proteina: n(row.proteina),
    carbo: n(row.carbo),
    gordura: n(row.gordura),
    fibra: n(row.fibra),
  };
}
function paraPorcao(row: Record<string, unknown>): Porcao {
  return { ...(row as Porcao), alimento_id: n(row.alimento_id), gramas: n(row.gramas) };
}
function paraRegistro(row: Record<string, unknown>): Registro {
  return {
    ...(row as Registro),
    alimento_id: row.alimento_id == null ? null : n(row.alimento_id),
    gramas: n(row.gramas),
    porcao_qtd: row.porcao_qtd == null ? null : n(row.porcao_qtd),
    kcal: n(row.kcal),
    proteina: n(row.proteina),
    carbo: n(row.carbo),
    gordura: n(row.gordura),
  };
}

/** "Feijão, Carioca" → "feijao, carioca" (igual ao normalize do app) */
export function normalizar(texto: string): string {
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Igual a nutrientsFor do app: valores do alimento são por 100 g */
function nutrientesPara(a: Alimento, gramas: number): Nutrientes {
  const f = gramas / 100;
  return { kcal: a.kcal * f, proteina: a.proteina * f, carbo: a.carbo * f, gordura: a.gordura * f };
}

function somar(itens: Nutrientes[]): Nutrientes {
  return itens.reduce(
    (t, i) => ({
      kcal: t.kcal + i.kcal,
      proteina: t.proteina + i.proteina,
      carbo: t.carbo + i.carbo,
      gordura: t.gordura + i.gordura,
    }),
    { kcal: 0, proteina: 0, carbo: 0, gordura: 0 }
  );
}

const arredondar = (t: Nutrientes) => ({
  kcal: Math.round(t.kcal),
  proteina: r1(t.proteina),
  carbo: r1(t.carbo),
  gordura: r1(t.gordura),
});

// "2 × concha (200 g)" ou "150 g", como describeAmount do app
function descreverQuantidade(r: Pick<Registro, 'gramas' | 'porcao_rotulo' | 'porcao_qtd'>): string {
  if (r.porcao_rotulo && r.porcao_qtd) {
    const qtd = String(Math.round(r.porcao_qtd * 100) / 100).replace('.', ',');
    return `${qtd} × ${r.porcao_rotulo} (${Math.round(r.gramas)} g)`;
  }
  return `${Math.round(r.gramas)} g`;
}

function descreverAlimento(a: Alimento, porcoes: Porcao[]) {
  return {
    id: a.id,
    nome: a.nome,
    categoria: a.categoria,
    fonte: a.fonte,
    ...(a.observacao ? { observacao: a.observacao } : {}),
    por_100g: {
      kcal: r1(a.kcal),
      proteina: r1(a.proteina),
      carbo: r1(a.carbo),
      gordura: r1(a.gordura),
      fibra: r1(a.fibra),
    },
    porcoes: porcoes.map((p) => ({ rotulo: p.rotulo, gramas: r1(p.gramas), ...(p.personalizada ? { personalizada: true } : {}) })),
  };
}

function ok(texto: string, dados: unknown) {
  return { content: [{ type: 'text' as const, text: `${texto}\n\n${JSON.stringify(dados, null, 2)}` }] };
}
function erro(texto: string) {
  return { content: [{ type: 'text' as const, text: texto }], isError: true };
}
const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Itens gravados juntos ganham 1 ms de diferença, para o diário manter a ordem em que foram ditos
const criadoEmSequencial = (i: number, base = Date.now()) => new Date(base + i).toISOString();

const DIA_MS = 24 * 60 * 60 * 1000;
function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / DIA_MS);
}

// ---------- acesso ao Supabase ----------

type Resultado = { data: unknown[] | null; error: { message: string } | null };

/** Lê todas as páginas (o Supabase devolve no máximo 1000 linhas por vez). */
async function lerTudo(montar: (de: number, ate: number) => PromiseLike<Resultado>): Promise<Record<string, unknown>[]> {
  const PAGINA = 1000;
  const todas: Record<string, unknown>[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await montar(de, de + PAGINA - 1);
    if (error) throw new Error(`Erro no Supabase: ${error.message}`);
    const linhas = (data ?? []) as Record<string, unknown>[];
    todas.push(...linhas);
    if (linhas.length < PAGINA) return todas;
  }
}

async function lerAlimento(supabase: SupabaseClient, id: number): Promise<Alimento | null> {
  const { data, error } = await supabase.from(T_ALIMENTOS).select(COL_ALIMENTO).eq('id', id).maybeSingle();
  if (error) throw new Error(`Erro ao ler o alimento: ${error.message}`);
  return data ? paraAlimento(data) : null;
}

async function lerPorcoes(supabase: SupabaseClient, ids: number[]): Promise<Map<number, Porcao[]>> {
  const mapa = new Map<number, Porcao[]>();
  if (ids.length === 0) return mapa;
  const { data, error } = await supabase
    .from(T_PORCOES)
    .select(COL_PORCAO)
    .in('alimento_id', ids)
    .eq('deletado', false)
    .order('personalizada', { ascending: false })
    .order('gramas');
  if (error) throw new Error(`Erro ao ler as medidas: ${error.message}`);
  for (const row of data ?? []) {
    const p = paraPorcao(row);
    mapa.set(p.alimento_id, [...(mapa.get(p.alimento_id) ?? []), p]);
  }
  return mapa;
}

/** Busca sem acento, exigindo todas as palavras, na mesma ordem do app. */
async function buscar(supabase: SupabaseClient, texto: string, limite: number): Promise<Alimento[]> {
  const termos = normalizar(texto)
    .replace(/[%_()*]/g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean);
  if (termos.length === 0) return [];
  let q = supabase.from(T_ALIMENTOS).select(COL_ALIMENTO).eq('deletado', false);
  for (const t of termos) q = q.ilike('busca', `%${t}%`);
  const { data, error } = await q.limit(500);
  if (error) throw new Error(`Erro na busca: ${error.message}`);
  const lista = (data ?? []).map(paraAlimento);
  // comum primeiro, depois quem começa com o 1º termo, depois o nome mais curto
  const chave = (a: Alimento) => [a.comum ? 0 : 1, a.busca.startsWith(termos[0]) ? 0 : 1, a.nome.length];
  lista.sort((a, b) => {
    const [x, y] = [chave(a), chave(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  return lista.slice(0, limite);
}

/** Palavras significativas de um nome, para achar cadastros repetidos. */
function palavras(texto: string): Set<string> {
  return new Set(
    normalizar(texto)
      .split(/[^a-z0-9]+/)
      .filter((p) => p.length >= 3)
  );
}

async function parecidos(supabase: SupabaseClient, nome: string, ignorarId?: number): Promise<Alimento[]> {
  const alvo = palavras(nome);
  if (alvo.size === 0) return [];
  const maior = [...alvo].sort((a, b) => b.length - a.length)[0];
  const { data, error } = await supabase
    .from(T_ALIMENTOS)
    .select(COL_ALIMENTO)
    .eq('deletado', false)
    .ilike('busca', `%${maior}%`)
    .limit(300);
  if (error) throw new Error(`Erro ao procurar alimentos parecidos: ${error.message}`);
  const buscaNova = normalizar(nome);
  return (data ?? [])
    .map(paraAlimento)
    .filter((a) => a.id !== ignorarId)
    .map((a) => {
      const outro = palavras(a.nome);
      const comuns = [...alvo].filter((p) => outro.has(p)).length;
      const jaccard = comuns / new Set([...alvo, ...outro]).size;
      const contem = a.busca.includes(buscaNova) || buscaNova.includes(a.busca);
      return { a, nota: contem ? 1 : jaccard };
    })
    .filter((x) => x.nota >= 0.6)
    .sort((x, y) => y.nota - x.nota)
    .slice(0, 5)
    .map((x) => x.a);
}

/** Acha a medida pelo rótulo, sem acento ("concha", "colher de sopa"). */
function acharPorcao(porcoes: Porcao[], rotulo: string): Porcao | { erro: string } {
  const alvo = normalizar(rotulo);
  const exatas = porcoes.filter((p) => normalizar(p.rotulo) === alvo);
  if (exatas.length) return exatas[0]; // personalizadas vêm primeiro
  const inicio = porcoes.filter((p) => normalizar(p.rotulo).startsWith(alvo));
  const rotulos = [...new Set(inicio.map((p) => p.rotulo))];
  if (rotulos.length === 1) return inicio[0];
  const disponiveis = porcoes.map((p) => `${p.rotulo} (${r1(p.gramas)} g)`).join(', ') || 'nenhuma';
  return {
    erro:
      rotulos.length > 1
        ? `Medida "${rotulo}" é ambígua: ${rotulos.join(', ')}.`
        : `Medida "${rotulo}" não encontrada. Medidas disponíveis: ${disponiveis}. ` +
          'Use gramas ou crie a medida com adicionar_porcao.',
  };
}

// ---------- schemas compartilhados ----------

const dataSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
  .describe('Data no formato AAAA-MM-DD. Ex.: "2026-09-30".');

const refeicaoSchema = z
  .enum(['cafe', 'almoco', 'lanche', 'jantar', 'ceia'])
  .describe('Refeição: cafe (café da manhã), almoco, lanche, jantar ou ceia.');

const valoresNutricionais = {
  kcal: z.number().min(0).describe('Calorias (kcal) na quantidade de gramas_base.'),
  proteina: z.number().min(0).describe('Proteína (g) na quantidade de gramas_base.'),
  carbo: z.number().min(0).describe('Carboidrato (g) na quantidade de gramas_base.'),
  gordura: z.number().min(0).describe('Gordura total (g) na quantidade de gramas_base.'),
  fibra: z.number().min(0).optional().describe('Fibra (g) na quantidade de gramas_base. Opcional (0).'),
};

const gramasBaseSchema = z
  .number()
  .positive()
  .max(5000)
  .describe(
    'A quantidade (em gramas) a que os valores nutricionais se referem. Ex.: 30 se o rótulo diz ' +
      '"porção de 30 g"; 100 se os valores já são por 100 g. O servidor converte para 100 g.'
  );

// ---------- ferramentas ----------

export function registrarFerramentasAlimentacao(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    'buscar_alimentos',
    {
      title: 'Buscar alimentos',
      description:
        'Busca alimentos na base do app (tabela TACO + alimentos cadastrados pelo usuário), sem ' +
        'acento e exigindo todas as palavras. Ex.: "feijao cozido", "arroz integral", "whey". ' +
        'Retorna o id, os nutrientes por 100 g e as medidas caseiras (concha, colher...). ' +
        'SEMPRE use antes de registrar_alimentacao para achar o id do alimento. Dica: a TACO usa ' +
        'nomes como "Feijão, carioca, cozido"; se não achar, tente menos palavras.',
      inputSchema: {
        texto: z.string().min(1).describe('Palavras do nome do alimento. Ex.: "frango grelhado".'),
        limite: z.number().int().min(1).max(50).optional().describe('Máximo de resultados (padrão 10).'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ texto, limite }) => {
      try {
        const lista = await buscar(supabase, texto, limite ?? 10);
        if (lista.length === 0) {
          return ok(`Nenhum alimento encontrado para "${texto}". Tente menos palavras ou cadastre com cadastrar_alimento.`, []);
        }
        const porcoes = await lerPorcoes(supabase, lista.map((a) => a.id));
        return ok(
          `${lista.length} alimento(s) para "${texto}" (valores por 100 g).`,
          lista.map((a) => descreverAlimento(a, porcoes.get(a.id) ?? []))
        );
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );

  server.registerTool(
    'detalhar_alimento',
    {
      title: 'Detalhar alimento',
      description: 'Mostra um alimento pelo id: nutrientes por 100 g, fonte, observações e todas as medidas caseiras.',
      inputSchema: { id: z.number().int().describe('id do alimento (de buscar_alimentos).') },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      try {
        const a = await lerAlimento(supabase, id);
        if (!a || a.deletado) return erro(`Alimento ${id} não encontrado.`);
        const porcoes = await lerPorcoes(supabase, [id]);
        return ok(`Alimento ${a.nome}.`, descreverAlimento(a, porcoes.get(id) ?? []));
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );

  server.registerTool(
    'cadastrar_alimento',
    {
      title: 'Cadastrar alimento próprio',
      description:
        'Cadastra um alimento que não existe na base (ex.: um produto industrializado, a partir do ' +
        'rótulo). Os valores podem ser "por porção": informe gramas_base (ex.: 30) e os valores ' +
        'daquela porção; o servidor converte para 100 g e, se informar porcao_rotulo, cria a medida ' +
        'caseira (ex.: "scoop" = 30 g). Antes de cadastrar, procure com buscar_alimentos. Se já ' +
        'existir um alimento com nome muito parecido, a ferramenta não cadastra e lista os parecidos: ' +
        'pergunte ao usuário e, se ele quiser mesmo assim, chame de novo com confirmar = true.',
      inputSchema: {
        nome: z.string().min(1).describe('Nome do alimento. Ex.: "Whey protein baunilha Marca X".'),
        gramas_base: gramasBaseSchema,
        ...valoresNutricionais,
        porcao_rotulo: z
          .string()
          .optional()
          .describe('Nome da porção do rótulo, para virar medida caseira. Ex.: "scoop", "unidade", "fatia".'),
        confirmar: z
          .boolean()
          .optional()
          .describe('true para cadastrar mesmo existindo alimento com nome parecido.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ nome, gramas_base, kcal, proteina, carbo, gordura, fibra, porcao_rotulo, confirmar }) => {
      try {
        if (!confirmar) {
          const iguais = await parecidos(supabase, nome);
          if (iguais.length) {
            return ok(
              `Não cadastrei: já existe(m) alimento(s) com nome parecido. Confirme com o usuário; ` +
                `para cadastrar mesmo assim, chame de novo com confirmar = true.`,
              iguais.map((a) => ({ id: a.id, nome: a.nome, fonte: a.fonte, kcal_100g: r1(a.kcal) }))
            );
          }
        }
        // Igual a saveCustomFood: valores do rótulo → por 100 g
        const f = 100 / gramas_base;
        const { data, error } = await supabase
          .from(T_ALIMENTOS)
          .insert({
            nome: nome.trim(),
            busca: normalizar(nome),
            categoria: 'Meus alimentos',
            kcal: kcal * f,
            proteina: proteina * f,
            carbo: carbo * f,
            gordura: gordura * f,
            fibra: (fibra ?? 0) * f,
            fonte: 'custom',
          })
          .select(COL_ALIMENTO)
          .single();
        if (error) return erro(`Erro ao cadastrar: ${error.message}`);
        const a = paraAlimento(data);

        // a porção do rótulo vira uma medida caseira (ex.: "scoop" = 30 g)
        if (porcao_rotulo?.trim() && gramas_base !== 100) {
          const { error: e2 } = await supabase
            .from(T_PORCOES)
            .insert({ alimento_id: a.id, rotulo: porcao_rotulo.trim(), gramas: gramas_base, personalizada: true });
          if (e2) return erro(`Alimento ${a.id} criado, mas a medida falhou: ${e2.message}`);
        }
        const porcoes = await lerPorcoes(supabase, [a.id]);
        return ok(`Alimento cadastrado (id ${a.id}). Valores convertidos para 100 g.`, descreverAlimento(a, porcoes.get(a.id) ?? []));
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );

  server.registerTool(
    'editar_alimento',
    {
      title: 'Editar alimento próprio',
      description:
        'Altera um alimento cadastrado pelo usuário (fonte "custom"). Alimentos da TACO não podem ser ' +
        'alterados. Para mudar nutrientes, envie gramas_base e TODOS os valores (kcal, proteina, carbo, ' +
        'gordura e, se tiver, fibra) daquela quantidade. Registros antigos do diário não mudam.',
      inputSchema: {
        id: z.number().int().describe('id do alimento (de buscar_alimentos).'),
        campos: z
          .object({
            nome: z.string().min(1).optional().describe('Novo nome.'),
            gramas_base: gramasBaseSchema.optional(),
            kcal: valoresNutricionais.kcal.optional(),
            proteina: valoresNutricionais.proteina.optional(),
            carbo: valoresNutricionais.carbo.optional(),
            gordura: valoresNutricionais.gordura.optional(),
            fibra: valoresNutricionais.fibra,
          })
          .describe('Só o que muda.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, campos }) => {
      try {
        const a = await lerAlimento(supabase, id);
        if (!a || a.deletado) return erro(`Alimento ${id} não encontrado.`);
        if (a.fonte !== 'custom') return erro(`"${a.nome}" é da base (${a.fonte}) e não pode ser alterado.`);

        const alteracoes: Record<string, unknown> = {};
        if (campos.nome !== undefined) {
          alteracoes.nome = campos.nome.trim();
          alteracoes.busca = normalizar(campos.nome);
        }
        const nutri = ['kcal', 'proteina', 'carbo', 'gordura'] as const;
        const algum = nutri.some((k) => campos[k] !== undefined) || campos.fibra !== undefined;
        if (algum) {
          const faltando = nutri.filter((k) => campos[k] === undefined);
          if (faltando.length) return erro(`Para mudar nutrientes, envie também: ${faltando.join(', ')}.`);
          const f = 100 / (campos.gramas_base ?? 100);
          for (const k of nutri) alteracoes[k] = (campos[k] as number) * f;
          alteracoes.fibra = (campos.fibra ?? 0) * f;
        }
        if (Object.keys(alteracoes).length === 0) return erro('Nenhum campo para alterar.');

        const { data, error } = await supabase
          .from(T_ALIMENTOS)
          .update(alteracoes)
          .eq('id', id)
          .eq('fonte', 'custom')
          .select(COL_ALIMENTO)
          .single();
        if (error) return erro(`Erro ao editar: ${error.message}`);
        const porcoes = await lerPorcoes(supabase, [id]);
        return ok('Alimento atualizado.', descreverAlimento(paraAlimento(data), porcoes.get(id) ?? []));
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );

  server.registerTool(
    'remover_alimento',
    {
      title: 'Remover alimento próprio',
      description:
        'Remove um alimento cadastrado pelo usuário (fonte "custom"). Registros do diário que já o ' +
        'usaram continuam intactos. Alimentos da TACO não podem ser removidos. Confirme com o usuário antes.',
      inputSchema: { id: z.number().int().describe('id do alimento.') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      try {
        const a = await lerAlimento(supabase, id);
        if (!a || a.deletado) return erro(`Alimento ${id} não encontrado (ou já removido).`);
        if (a.fonte !== 'custom') return erro(`"${a.nome}" é da base (${a.fonte}) e não pode ser removido.`);
        const { error } = await supabase.from(T_ALIMENTOS).update({ deletado: true }).eq('id', id).eq('fonte', 'custom');
        if (error) return erro(`Erro ao remover: ${error.message}`);
        return ok(`Alimento "${a.nome}" removido.`, { id, nome: a.nome });
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );

  server.registerTool(
    'adicionar_porcao',
    {
      title: 'Adicionar medida caseira',
      description:
        'Cria uma medida caseira para um alimento (qualquer um, inclusive da TACO), para depois ' +
        'registrar por medida. Ex.: "pote" = 170 g, "fatia" = 25 g. Se já existir uma medida ' +
        'personalizada com o mesmo nome, atualiza as gramas.',
      inputSchema: {
        alimento_id: z.number().int().describe('id do alimento.'),
        rotulo: z.string().min(1).describe('Nome da medida. Ex.: "pote", "fatia", "scoop".'),
        gramas: z.number().positive().max(5000).describe('Quantas gramas tem 1 dessa medida.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ alimento_id, rotulo, gramas }) => {
      try {
        const a = await lerAlimento(supabase, alimento_id);
        if (!a || a.deletado) return erro(`Alimento ${alimento_id} não encontrado.`);
        const atuais = (await lerPorcoes(supabase, [alimento_id])).get(alimento_id) ?? [];
        const existente = atuais.find((p) => p.personalizada && normalizar(p.rotulo) === normalizar(rotulo));
        const { error } = existente
          ? await supabase.from(T_PORCOES).update({ gramas }).eq('id', existente.id)
          : await supabase
              .from(T_PORCOES)
              .insert({ alimento_id, rotulo: rotulo.trim(), gramas, personalizada: true });
        if (error) return erro(`Erro ao salvar a medida: ${error.message}`);
        const porcoes = await lerPorcoes(supabase, [alimento_id]);
        return ok(
          `Medida "${rotulo.trim()}" = ${r1(gramas)} g ${existente ? 'atualizada' : 'criada'} em ${a.nome}.`,
          descreverAlimento(a, porcoes.get(alimento_id) ?? [])
        );
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );

  server.registerTool(
    'registrar_alimentacao',
    {
      title: 'Registrar alimentação',
      description:
        'Registra no diário o que o usuário comeu, um ou vários itens de uma vez, numa refeição. ' +
        'Antes, use buscar_alimentos para achar o id de cada alimento. Para cada item informe ' +
        'gramas OU porcao (nome da medida caseira, ex.: "concha") + quantidade (padrão 1). ' +
        'Calorias e macros são calculados na hora e ficam guardados no registro. ' +
        'Ex.: almoço com 2 conchas de feijão e 150 g de arroz.',
      inputSchema: {
        data: dataSchema.optional().describe('Data do registro (AAAA-MM-DD). Padrão: hoje, no horário de Brasília.'),
        refeicao: refeicaoSchema,
        itens: z
          .array(
            z.object({
              alimento_id: z.number().int().describe('id do alimento (de buscar_alimentos).'),
              gramas: z.number().positive().max(5000).optional().describe('Quantidade em gramas. Ex.: 150.'),
              porcao: z.string().optional().describe('Medida caseira do alimento. Ex.: "concha", "colher de sopa".'),
              quantidade: z.number().positive().max(100).optional().describe('Quantas medidas. Ex.: 2 ou 1.5. Padrão 1.'),
            })
          )
          .min(1)
          .describe('Itens comidos nessa refeição.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ data, refeicao, itens }) => {
      try {
        const dia = data ?? hojeSaoPaulo();
        const ids = [...new Set(itens.map((i) => i.alimento_id))];
        const { data: rows, error } = await supabase.from(T_ALIMENTOS).select(COL_ALIMENTO).in('id', ids);
        if (error) return erro(`Erro ao ler os alimentos: ${error.message}`);
        const alimentos = new Map((rows ?? []).map((r) => [n(r.id), paraAlimento(r)]));
        const porcoes = await lerPorcoes(supabase, ids);

        // valida tudo antes de gravar qualquer coisa
        const linhas = [];
        for (const [i, item] of itens.entries()) {
          const a = alimentos.get(item.alimento_id);
          if (!a || a.deletado) return erro(`Item ${i + 1}: alimento ${item.alimento_id} não encontrado. Use buscar_alimentos.`);
          if ((item.gramas === undefined) === (item.porcao === undefined)) {
            return erro(`Item ${i + 1} (${a.nome}): informe gramas OU porcao (+ quantidade).`);
          }
          let gramas = item.gramas ?? 0;
          let porcaoRotulo: string | null = null;
          let porcaoQtd: number | null = null;
          if (item.porcao !== undefined) {
            const p = acharPorcao(porcoes.get(a.id) ?? [], item.porcao);
            if ('erro' in p) return erro(`Item ${i + 1} (${a.nome}): ${p.erro}`);
            porcaoQtd = item.quantidade ?? 1;
            porcaoRotulo = p.rotulo;
            gramas = p.gramas * porcaoQtd;
          }
          linhas.push({
            criado_em: criadoEmSequencial(i),
            data: dia,
            refeicao,
            alimento_id: a.id,
            nome: a.nome,
            gramas,
            porcao_rotulo: porcaoRotulo,
            porcao_qtd: porcaoQtd,
            ...nutrientesPara(a, gramas),
          });
        }

        const { data: salvos, error: e2 } = await supabase.from(T_REGISTROS).insert(linhas).select(COL_REGISTRO);
        if (e2) return erro(`Erro ao registrar: ${e2.message}`);
        const regs = (salvos ?? []).map(paraRegistro);
        return ok(`${regs.length} item(ns) registrado(s) em ${rotuloRefeicao(refeicao)} de ${dia}.`, {
          itens: regs.map((r) => ({ id: r.id, nome: r.nome, quantidade: descreverQuantidade(r), ...arredondar(r) })),
          total: arredondar(somar(regs)),
        });
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );

  server.registerTool(
    'listar_diario',
    {
      title: 'Listar diário alimentar',
      description:
        'Mostra o que foi registrado no diário, por refeição, com totais por refeição e do dia ' +
        '(kcal, proteína, carboidrato e gordura). Informe data, ou de + ate (até 31 dias). ' +
        'Sem datas, mostra hoje. Traz o id de cada registro, para editar_registro/remover_registro.',
      inputSchema: {
        data: dataSchema.optional(),
        de: dataSchema.optional().describe('Início do período (AAAA-MM-DD).'),
        ate: dataSchema.optional().describe('Fim do período (AAAA-MM-DD).'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ data, de, ate }) => {
      try {
        const inicio = data ?? de ?? ate ?? hojeSaoPaulo();
        const fim = data ?? ate ?? de ?? inicio;
        if (fim < inicio) return erro('"ate" precisa ser igual ou depois de "de".');
        if (diasEntre(inicio, fim) > 31) return erro('Período máximo: 31 dias. Para períodos maiores use resumo_alimentacao.');

        const regs = (
          await lerTudo((a, b) =>
            supabase
              .from(T_REGISTROS)
              .select(COL_REGISTRO)
              .eq('deletado', false)
              .gte('data', inicio)
              .lte('data', fim)
              .order('data')
              .order('criado_em')
              .order('id')
              .range(a, b)
          )
        ).map(paraRegistro);

        const dias = [...new Set(regs.map((r) => r.data))].map((d) => {
          const doDia = regs.filter((r) => r.data === d);
          const refeicoes = REFEICOES.map((m) => doDia.filter((r) => r.refeicao === m.key))
            .filter((l) => l.length)
            .map((l) => ({
              refeicao: l[0].refeicao,
              nome: rotuloRefeicao(l[0].refeicao),
              itens: l.map((r) => ({ id: r.id, nome: r.nome, quantidade: descreverQuantidade(r), ...arredondar(r) })),
              total: arredondar(somar(l)),
            }));
          return { data: d, refeicoes, total_do_dia: arredondar(somar(doDia)) };
        });

        const periodo = inicio === fim ? inicio : `${inicio} a ${fim}`;
        if (dias.length === 0) return ok(`Nada registrado em ${periodo}.`, []);
        return ok(`Diário de ${periodo}: ${regs.length} registro(s).`, dias);
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );

  server.registerTool(
    'editar_registro',
    {
      title: 'Editar registro do diário',
      description:
        'Altera um registro do diário: data, refeição ou quantidade (gramas, ou porcao + quantidade). ' +
        'Ao mudar a quantidade, recalcula calorias e macros. Descubra o id com listar_diario.',
      inputSchema: {
        id: z.string().uuid().describe('id do registro (de listar_diario).'),
        campos: z
          .object({
            data: dataSchema.optional(),
            refeicao: refeicaoSchema.optional(),
            gramas: z.number().positive().max(5000).optional().describe('Nova quantidade em gramas.'),
            porcao: z.string().optional().describe('Nova medida caseira. Ex.: "concha".'),
            quantidade: z
              .number()
              .positive()
              .max(100)
              .optional()
              .describe('Quantas medidas. Sem "porcao", usa a medida que o registro já tem.'),
          })
          .describe('Só o que muda.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, campos }) => {
      try {
        const { data: row, error } = await supabase
          .from(T_REGISTROS)
          .select(COL_REGISTRO)
          .eq('id', id)
          .eq('deletado', false)
          .maybeSingle();
        if (error) return erro(`Erro ao ler o registro: ${error.message}`);
        if (!row) return erro(`Registro ${id} não encontrado (ou removido).`);
        const r = paraRegistro(row);

        const alteracoes: Record<string, unknown> = {};
        if (campos.data !== undefined) alteracoes.data = campos.data;
        if (campos.refeicao !== undefined) alteracoes.refeicao = campos.refeicao;

        let novasGramas: number | null = null;
        if (campos.gramas !== undefined && (campos.porcao !== undefined || campos.quantidade !== undefined)) {
          return erro('Informe gramas OU porcao/quantidade, não os dois.');
        }
        const alimento = r.alimento_id != null ? await lerAlimento(supabase, r.alimento_id) : null;
        if (campos.gramas !== undefined) {
          novasGramas = campos.gramas;
          alteracoes.porcao_rotulo = null;
          alteracoes.porcao_qtd = null;
        } else if (campos.porcao !== undefined) {
          if (!alimento) return erro('O alimento deste registro não existe mais; use gramas.');
          const p = acharPorcao((await lerPorcoes(supabase, [alimento.id])).get(alimento.id) ?? [], campos.porcao);
          if ('erro' in p) return erro(p.erro);
          const qtd = campos.quantidade ?? 1;
          novasGramas = p.gramas * qtd;
          alteracoes.porcao_rotulo = p.rotulo;
          alteracoes.porcao_qtd = qtd;
        } else if (campos.quantidade !== undefined) {
          if (!r.porcao_rotulo || !r.porcao_qtd) {
            return erro('Este registro não usa medida caseira: informe gramas, ou porcao + quantidade.');
          }
          novasGramas = (r.gramas / r.porcao_qtd) * campos.quantidade;
          alteracoes.porcao_qtd = campos.quantidade;
        }

        if (novasGramas !== null) {
          alteracoes.gramas = novasGramas;
          // como saveEntry: recalcula pelo alimento; se ele sumiu, escala os valores guardados
          const nutri = alimento
            ? nutrientesPara(alimento, novasGramas)
            : (() => {
                const f = novasGramas / r.gramas;
                return { kcal: r.kcal * f, proteina: r.proteina * f, carbo: r.carbo * f, gordura: r.gordura * f };
              })();
          Object.assign(alteracoes, nutri);
        }
        if (Object.keys(alteracoes).length === 0) return erro('Nenhum campo para alterar.');

        const { data: salvo, error: e2 } = await supabase
          .from(T_REGISTROS)
          .update(alteracoes)
          .eq('id', id)
          .select(COL_REGISTRO)
          .single();
        if (e2) return erro(`Erro ao editar: ${e2.message}`);
        const s = paraRegistro(salvo);
        return ok('Registro atualizado.', {
          id: s.id,
          data: s.data,
          refeicao: s.refeicao,
          nome: s.nome,
          quantidade: descreverQuantidade(s),
          ...arredondar(s),
        });
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );

  server.registerTool(
    'remover_registro',
    {
      title: 'Remover registro do diário',
      description: 'Remove um item do diário (some do app na próxima sincronização). Descubra o id com listar_diario.',
      inputSchema: { id: z.string().uuid().describe('id do registro (de listar_diario).') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      try {
        const { data, error } = await supabase
          .from(T_REGISTROS)
          .update({ deletado: true })
          .eq('id', id)
          .eq('deletado', false)
          .select(COL_REGISTRO);
        if (error) return erro(`Erro ao remover: ${error.message}`);
        if (!data?.length) return erro(`Registro ${id} não encontrado (ou já removido).`);
        const r = paraRegistro(data[0]);
        return ok(`Removido: ${r.nome} (${descreverQuantidade(r)}) de ${rotuloRefeicao(r.refeicao)} em ${r.data}.`, { id });
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );

  server.registerTool(
    'copiar_refeicao',
    {
      title: 'Copiar refeição',
      description:
        'Copia todos os itens de uma refeição de um dia para outro (ex.: repetir o café da manhã de ' +
        'ontem hoje), com as mesmas quantidades e valores.',
      inputSchema: {
        de_data: dataSchema.describe('Dia de origem (AAAA-MM-DD).'),
        para_data: dataSchema.optional().describe('Dia de destino (AAAA-MM-DD). Padrão: hoje.'),
        refeicao: refeicaoSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ de_data, para_data, refeicao }) => {
      try {
        const destino = para_data ?? hojeSaoPaulo();
        const { data, error } = await supabase
          .from(T_REGISTROS)
          .select(COL_REGISTRO)
          .eq('deletado', false)
          .eq('data', de_data)
          .eq('refeicao', refeicao)
          .order('criado_em')
          .order('id');
        if (error) return erro(`Erro ao ler a refeição: ${error.message}`);
        const origem = (data ?? []).map(paraRegistro);
        if (origem.length === 0) return erro(`Nada registrado em ${rotuloRefeicao(refeicao)} de ${de_data}.`);

        const agora = Date.now();
        const copias = origem.map((r, i) => ({
          criado_em: criadoEmSequencial(i, agora),
          data: destino,
          refeicao,
          alimento_id: r.alimento_id,
          nome: r.nome,
          gramas: r.gramas,
          porcao_rotulo: r.porcao_rotulo,
          porcao_qtd: r.porcao_qtd,
          kcal: r.kcal,
          proteina: r.proteina,
          carbo: r.carbo,
          gordura: r.gordura,
        }));
        const { data: salvos, error: e2 } = await supabase.from(T_REGISTROS).insert(copias).select(COL_REGISTRO);
        if (e2) return erro(`Erro ao copiar: ${e2.message}`);
        const regs = (salvos ?? []).map(paraRegistro);
        return ok(`${regs.length} item(ns) copiado(s) de ${de_data} para ${destino} (${rotuloRefeicao(refeicao)}).`, {
          itens: regs.map((r) => ({ id: r.id, nome: r.nome, quantidade: descreverQuantidade(r) })),
          total: arredondar(somar(regs)),
        });
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );

  server.registerTool(
    'resumo_alimentacao',
    {
      title: 'Resumo da alimentação',
      description:
        'Resumo de um período (até 366 dias), como o relatório do app: média diária de calorias e ' +
        'macros (nos dias com registro), calorias por refeição e os alimentos mais registrados.',
      inputSchema: {
        de: dataSchema.describe('Início do período (AAAA-MM-DD).'),
        ate: dataSchema.describe('Fim do período (AAAA-MM-DD).'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ de, ate }) => {
      try {
        if (ate < de) return erro('"ate" precisa ser igual ou depois de "de".');
        if (diasEntre(de, ate) > 366) return erro('Período máximo: 366 dias.');
        const regs = (
          await lerTudo((a, b) =>
            supabase
              .from(T_REGISTROS)
              .select(COL_REGISTRO)
              .eq('deletado', false)
              .gte('data', de)
              .lte('data', ate)
              .order('data')
              .order('id')
              .range(a, b)
          )
        ).map(paraRegistro);
        if (regs.length === 0) return ok(`Nada registrado entre ${de} e ${ate}.`, {});

        // getDailyTotals
        const porDia = new Map<string, Registro[]>();
        for (const r of regs) porDia.set(r.data, [...(porDia.get(r.data) ?? []), r]);
        const totaisDia = [...porDia.entries()].map(([data, l]) => ({ data, ...somar(l) }));
        const dias = totaisDia.length;
        const total = somar(totaisDia);
        const media = { kcal: total.kcal / dias, proteina: total.proteina / dias, carbo: total.carbo / dias, gordura: total.gordura / dias };

        // getMealTotals
        const porRefeicao = REFEICOES.map((m) => {
          const kcal = regs.filter((r) => r.refeicao === m.key).reduce((s, r) => s + r.kcal, 0);
          return { refeicao: m.key, nome: m.label, kcal: Math.round(kcal), percentual: Math.round((kcal / total.kcal) * 100) || 0 };
        }).filter((x) => x.kcal > 0);

        // getTopFoods: por nome, mais vezes primeiro, depois mais kcal
        const porNome = new Map<string, { nome: string; vezes: number; gramas: number; kcal: number }>();
        for (const r of regs) {
          const t = porNome.get(r.nome) ?? { nome: r.nome, vezes: 0, gramas: 0, kcal: 0 };
          t.vezes += 1;
          t.gramas += r.gramas;
          t.kcal += r.kcal;
          porNome.set(r.nome, t);
        }
        const maisUsados = [...porNome.values()]
          .sort((a, b) => b.vezes - a.vezes || b.kcal - a.kcal)
          .slice(0, 10)
          .map((t) => ({ nome: t.nome, vezes: t.vezes, gramas: Math.round(t.gramas), kcal: Math.round(t.kcal) }));

        return ok(`Resumo de ${de} a ${ate}: ${dias} dia(s) com registro.`, {
          dias_no_periodo: diasEntre(de, ate) + 1,
          dias_com_registro: dias,
          media_diaria: arredondar(media),
          por_refeicao: porRefeicao,
          mais_usados: maisUsados,
          por_dia: totaisDia.map((d) => ({ data: d.data, ...arredondar(d) })),
        });
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );
}
