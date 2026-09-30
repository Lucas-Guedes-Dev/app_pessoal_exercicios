// Gera supabase/alimentos_seed.sql a partir de src/data/foods.json (a mesma base embutida no app),
// para o Claude buscar e registrar alimentos da TACO pelo servidor MCP.
//
// Uso: node tools/taco/build-supabase-seed.mjs
// Rode de novo sempre que regerar o foods.json (build-foods.mjs) e rode o .sql no Supabase.
// O .sql pode ser executado várias vezes: atualiza os alimentos da base pelo id e regrava
// só as medidas da base (as personalizadas e os alimentos próprios não são tocados).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FOODS = join(here, '..', '..', 'src', 'data', 'foods.json');
const OUT = join(here, '..', '..', 'supabase', 'alimentos_seed.sql');

// Igual a src/utils/text.js (normalize) e src/utils/food.js (SOURCE_NOTES)
const normalize = (text) =>
  String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const NOTES = {
  rotulo: 'Valor médio de rótulo — confira o do produto que você usa.',
  estimado: 'Estimado a partir do alimento cru (rendimento típico do cozimento).',
};

const str = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (Number.isFinite(v) ? String(v) : '0');

const foods = JSON.parse(readFileSync(FOODS, 'utf8'));
const alimentos = [];
const porcoes = [];
for (const [id, name, category, kcal, protein, carbs, fat, fiber, portions, source, common] of foods) {
  if (id >= 100000) throw new Error(`id ${id} fora da faixa da base (< 100000)`);
  const fonte = source === 'taco' ? 'taco' : 'complemento';
  alimentos.push(
    `(${id}, ${str(name)}, ${str(normalize(name))}, ${str(category)}, ${num(kcal)}, ${num(protein)}, ` +
      `${num(carbs)}, ${num(fat)}, ${num(fiber)}, '${fonte}', ${str(NOTES[source] ?? null)}, ${common ? 'true' : 'false'})`
  );
  for (const [label, grams] of portions) porcoes.push(`(${id}, ${str(label)}, ${num(grams)}, false)`);
}

const sql = `-- GERADO por tools/taco/build-supabase-seed.mjs a partir de src/data/foods.json. Não edite à mão.
-- Base de alimentos (TACO + complementos): ${alimentos.length} alimentos, ${porcoes.length} medidas caseiras.
-- Rode depois de supabase/alimentacao.sql. Pode rodar de novo sem duplicar.

begin;

insert into public.alimentos (id, nome, busca, categoria, kcal, proteina, carbo, gordura, fibra, fonte, observacao, comum)
values
${alimentos.join(',\n')}
on conflict (id) do update set
  nome = excluded.nome, busca = excluded.busca, categoria = excluded.categoria,
  kcal = excluded.kcal, proteina = excluded.proteina, carbo = excluded.carbo,
  gordura = excluded.gordura, fibra = excluded.fibra, fonte = excluded.fonte,
  observacao = excluded.observacao, comum = excluded.comum, deletado = false;

-- Medidas da base são regravadas; as personalizadas (personalizada = true) ficam
delete from public.alimento_porcoes where not personalizada and alimento_id < 100000;

insert into public.alimento_porcoes (alimento_id, rotulo, gramas, personalizada)
values
${porcoes.join(',\n')};

commit;
`;

writeFileSync(OUT, sql);
console.log(`${OUT}: ${alimentos.length} alimentos, ${porcoes.length} medidas (${(sql.length / 1024).toFixed(0)} KB)`);
