import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  DIAS,
  TODAS_SEMANAS,
  diasParaTexto,
  nomeDia,
  normalizarDia,
  semanasParaTexto,
  temDia,
} from './dias.js';

const TABELA = 'exercicios';
const COLUNAS = 'id, nome, quantidade, descricao, dia_semana, semanas, criado_em, atualizado_em';

type Exercicio = {
  id: string;
  nome: string;
  quantidade: string;
  descricao: string | null;
  dia_semana: string;
  semanas: string;
  criado_em: string;
  atualizado_em: string;
};

const diasSchema = z
  .array(z.string())
  .min(1)
  .describe(
    `Dias da semana em que o exercício deve ser feito. Use os códigos ${DIAS.join(', ')} ` +
      '(nomes como "terça" ou "Quinta-feira" também são aceitos). Ex.: ["Ter", "Qui"].'
  );

const semanasSchema = z
  .array(z.string())
  .min(1)
  .describe(
    'Semanas do ciclo de treino (letras de A a F) em que o exercício aparece. ' +
      'O app alterna as semanas A, B, C... a cada segunda-feira. ' +
      'Omita para valer em todas as semanas.'
  );

function ok(texto: string, dados: unknown) {
  return {
    content: [{ type: 'text' as const, text: `${texto}\n\n${JSON.stringify(dados, null, 2)}` }],
  };
}

function erro(texto: string) {
  return { content: [{ type: 'text' as const, text: texto }], isError: true };
}

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function registrarFerramentas(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    'cadastrar_exercicios',
    {
      title: 'Cadastrar exercícios',
      description:
        'Cadastra um ou mais exercícios no plano de treino do app. Use quando o usuário pedir para ' +
        'adicionar, incluir ou montar exercícios em certos dias da semana. Todos os exercícios ' +
        'informados são cadastrados nos mesmos dias (um registro por exercício, valendo para todos ' +
        'os dias). O app sincroniza sozinho e passa a mostrar e lembrar desses exercícios.',
      inputSchema: {
        dias: diasSchema,
        exercicios: z
          .array(
            z.object({
              nome: z.string().min(1).describe('Nome do exercício. Ex.: "Glute bridge".'),
              quantidade: z
                .string()
                .min(1)
                .describe('Quanto fazer: repetições, séries ou tempo. Ex.: "30s", "3x12", "10x cada perna".'),
              descricao: z
                .string()
                .optional()
                .describe('Como executar o exercício, em uma ou duas frases. Opcional.'),
            })
          )
          .min(1)
          .describe('Lista de exercícios a cadastrar.'),
        semanas: semanasSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ dias, exercicios, semanas }) => {
      try {
        const diaSemana = diasParaTexto(dias);
        const semanasTexto = semanas ? semanasParaTexto(semanas) : TODAS_SEMANAS;
        const linhas = exercicios.map((e) => ({
          nome: e.nome.trim(),
          quantidade: e.quantidade.trim(),
          descricao: e.descricao?.trim() || null,
          dia_semana: diaSemana,
          semanas: semanasTexto,
        }));

        const { data, error } = await supabase.from(TABELA).insert(linhas).select(COLUNAS);
        if (error) return erro(`Erro ao cadastrar no Supabase: ${error.message}`);
        return ok(`${data.length} exercício(s) cadastrado(s) em ${diaSemana}.`, data);
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );

  server.registerTool(
    'listar_exercicios',
    {
      title: 'Listar exercícios',
      description:
        'Lista os exercícios ativos do plano de treino, com id, nome, quantidade, descrição, dias e ' +
        'semanas do ciclo. Use para responder "quais exercícios eu tenho", para conferir o plano de ' +
        'um dia e SEMPRE antes de editar ou remover, para descobrir o id correto.',
      inputSchema: {
        dia: z
          .string()
          .optional()
          .describe(`Filtra por um dia da semana (${DIAS.join(', ')} ou o nome do dia). Omita para listar todos.`),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ dia }) => {
      try {
        const codigo = dia ? normalizarDia(dia) : null;
        if (dia && !codigo) return erro(`Dia inválido: ${dia}. Use: ${DIAS.join(', ')}.`);

        const { data, error } = await supabase
          .from(TABELA)
          .select(COLUNAS)
          .eq('deletado', false)
          .order('criado_em');
        if (error) return erro(`Erro ao listar no Supabase: ${error.message}`);

        const lista = (data as Exercicio[]).filter((e) => !codigo || temDia(e.dia_semana, codigo));
        const titulo = codigo
          ? `${lista.length} exercício(s) na ${nomeDia(codigo)}.`
          : `${lista.length} exercício(s) no plano.`;
        return ok(titulo, lista);
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );

  server.registerTool(
    'editar_exercicio',
    {
      title: 'Editar exercício',
      description:
        'Altera um exercício existente: nome, quantidade, descrição, dias ou semanas do ciclo. ' +
        'Só os campos enviados são alterados. Descubra o id com listar_exercicios antes.',
      inputSchema: {
        id: z.string().uuid().describe('id (uuid) do exercício, obtido em listar_exercicios.'),
        campos: z
          .object({
            nome: z.string().min(1).optional().describe('Novo nome.'),
            quantidade: z.string().min(1).optional().describe('Nova quantidade. Ex.: "3x15", "45s".'),
            descricao: z
              .string()
              .nullable()
              .optional()
              .describe('Nova descrição. Envie null ou "" para apagar a descrição.'),
            dias: diasSchema.optional(),
            semanas: semanasSchema.optional(),
          })
          .describe('Campos a alterar. Envie só o que muda.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, campos }) => {
      try {
        const alteracoes: Record<string, string | null> = {};
        if (campos.nome !== undefined) alteracoes.nome = campos.nome.trim();
        if (campos.quantidade !== undefined) alteracoes.quantidade = campos.quantidade.trim();
        if (campos.descricao !== undefined) alteracoes.descricao = campos.descricao?.trim() || null;
        if (campos.dias !== undefined) alteracoes.dia_semana = diasParaTexto(campos.dias);
        if (campos.semanas !== undefined) alteracoes.semanas = semanasParaTexto(campos.semanas);
        if (Object.keys(alteracoes).length === 0) return erro('Nenhum campo para alterar foi informado.');

        const { data, error } = await supabase
          .from(TABELA)
          .update(alteracoes)
          .eq('id', id)
          .eq('deletado', false)
          .select(COLUNAS);
        if (error) return erro(`Erro ao editar no Supabase: ${error.message}`);
        if (!data.length) return erro(`Exercício ${id} não encontrado (ou já removido).`);
        return ok('Exercício atualizado.', data[0]);
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );

  server.registerTool(
    'remover_exercicio',
    {
      title: 'Remover exercício',
      description:
        'Remove um exercício do plano de treino (ele some do app na próxima sincronização). ' +
        'Descubra o id com listar_exercicios antes e confirme com o usuário qual exercício remover.',
      inputSchema: {
        id: z.string().uuid().describe('id (uuid) do exercício, obtido em listar_exercicios.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ id }) => {
      try {
        // Soft delete: o app precisa ver o registro marcado para removê-lo localmente
        const { data, error } = await supabase
          .from(TABELA)
          .update({ deletado: true })
          .eq('id', id)
          .eq('deletado', false)
          .select(COLUNAS);
        if (error) return erro(`Erro ao remover no Supabase: ${error.message}`);
        if (!data.length) return erro(`Exercício ${id} não encontrado (ou já removido).`);
        return ok(`Exercício "${data[0].nome}" removido.`, data[0]);
      } catch (e) {
        return erro(mensagemDe(e));
      }
    }
  );
}
