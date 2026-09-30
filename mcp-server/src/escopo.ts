import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * Única porta de acesso aos dados das ferramentas. O servidor usa a service_role (que ignora
 * o RLS), então é AQUI que cada consulta fica presa ao usuário autenticado:
 *   - leitura, alteração: sempre com user_id = usuário
 *   - inserção: user_id do usuário (sobrescreve qualquer valor enviado)
 *   - alteração nunca troca o dono (user_id é removido do patch)
 *   - base de alimentos (TACO): visível para todos, só leitura
 * As ferramentas recebem um Escopo, nunca o SupabaseClient.
 */

type Linha = Record<string, unknown>;

/** Tabelas em que cada linha tem dono */
export type TabelaPessoal = 'exercicios' | 'ciclo' | 'registros_alimentacao';
/** Tabelas em que o usuário pode gravar (nos alimentos e medidas, só nas próprias linhas) */
export type TabelaGravavel = TabelaPessoal | 'alimentos' | 'alimento_porcoes';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Escopo = ReturnType<typeof criarEscopo>;

export function criarEscopo(supabase: SupabaseClient, userId: string) {
  if (!UUID.test(userId)) throw new Error('Usuário inválido.');
  const semDono = (linha: Linha) => {
    const { user_id: _ignorado, ...resto } = linha;
    return resto;
  };

  return {
    userId,

    /** Linhas do usuário em exercicios, ciclo ou registros_alimentacao */
    ler(tabela: TabelaPessoal, colunas: string) {
      return supabase.from(tabela).select<string, Linha>(colunas).eq('user_id', userId);
    },

    /** Base (TACO/complementos, sem dono) + alimentos próprios do usuário */
    lerAlimentos(colunas: string) {
      return supabase
        .from('alimentos')
        .select<string, Linha>(colunas)
        .or(`and(user_id.is.null,fonte.neq.custom),user_id.eq.${userId}`);
    },

    /** Medidas da base + medidas personalizadas do usuário */
    lerPorcoes(colunas: string) {
      return supabase
        .from('alimento_porcoes')
        .select<string, Linha>(colunas)
        .or(`and(user_id.is.null,personalizada.is.false),user_id.eq.${userId}`);
    },

    inserir(tabela: TabelaGravavel, linhas: Linha | Linha[]) {
      const lista = (Array.isArray(linhas) ? linhas : [linhas]).map((l) => ({ ...semDono(l), user_id: userId }));
      return supabase.from(tabela).insert(lista);
    },

    /** Só altera linhas do usuário (a TACO, sem dono, nunca casa com o filtro) */
    atualizar(tabela: TabelaGravavel, patch: Linha) {
      return supabase.from(tabela).update(semDono(patch)).eq('user_id', userId);
    },

    /** Ciclo: uma linha por usuário */
    salvarCiclo(linha: Linha) {
      return supabase.from('ciclo').upsert({ ...semDono(linha), user_id: userId }, { onConflict: 'user_id' });
    },
  };
}
