// Gera src/data/foods.json a partir dos dados públicos da TACO (NEPA/UNICAMP, 4ª ed.)
// e da Tabela de Medidas Referidas da POF 2008-2009 (IBGE), via github.com/brolesi/taco.
//
// Uso: node tools/taco/build-foods.mjs
//
// Cada alimento sai no formato compacto:
//   [id, nome, categoria, kcal, proteína, carboidrato, gordura, fibra, porções, fonte, comum]
// com valores por 100 g e porções como [rótulo, gramas].

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RAW = join(here, 'raw');
const OUT = join(here, '..', '..', 'src', 'data', 'foods.json');

// ---------- CSV (com aspas) ----------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows.filter((r) => r.length > 1);
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const taco = parseCsv(readFileSync(join(RAW, 'taco_composicao.csv'), 'utf8'));
const pof = parseCsv(readFileSync(join(RAW, 'pof_medidas_caseiras.csv'), 'utf8'));

// ---------- valores ----------
// Na TACO, "Tr" (traço) virou 1e-05 e "NA" virou vazio. Traço conta como 0.
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? (n < 0.001 ? 0 : n) : null;
};
const r1 = (n) => (n == null ? 0 : Math.round(n * 10) / 10);

// ---------- ligação TACO -> nome do alimento na POF ----------
// Primeira regra que casar com a descrição da TACO vence.
const LINKS = [
  [/^Arroz, integral/, 'ARROZ INTEGRAL'],
  [/^Arroz, tipo/, 'ARROZ (POLIDO, PARBOILIZADO)'],
  [/^Feijão, (carioca|preto|rajado|jalo|rosinha|roxo|fradinho)/, 'FEIJAO (PRETO, MULATINHO, ROXO, ROSINHA, ETC)'],
  [/^Macarrão, trigo/, 'MACARRAO'],
  [/^Batata, inglesa/, 'BATATA INGLESA'],
  [/^Batata, doce/, 'BATATA DOCE'],
  [/^Mandioca, farofa/, 'FAROFA'],
  [/^Mandioca, (cozida|frita|crua)/, 'MANDIOCA'],
  [/^Farinha, de mandioca/, 'FARINHA DE MANDIOCA'],
  [/^Cuscuz, de milho/, 'CUSCUZ'],
  [/^Cuscuz, paulista/, 'CUSCUZ PAULISTA'],
  [/^Aveia, flocos/, 'AVEIA EM FLOCOS'],
  [/^Tapioca/, 'TAPIOCA DE GOMA'],
  [/^Pão, trigo, francês/, 'PAO DE SAL'],
  [/^Pão, trigo, forma, integral/, 'PAO INTEGRAL'],
  [/^Pão, (aveia|glúten|milho), forma/, 'PAO DE FORMA INDUSTRIALIZADO DE QUALQUER MARCA'],
  [/^Pão, de queijo/, 'PAO DE QUEIJO'],
  [/^Frango, (peito|coxa|sobrecoxa|asa|filé|inteiro|caipira)/, 'FRANGO EM PEDACOS'],
  [/^Carne, bovina/, 'CARNE BOVINA'],
  [/^Hambúrguer, bovino/, 'HAMBURGUER DE CARNE BOVINA'],
  [/^Porco, lombo/, 'LOMBO SUINO'],
  [/^Porco/, 'CARNE SUINA'],
  [/^Presunto/, 'PRESUNTO'],
  [/^Atum, conserva/, 'ATUM EM CONSERVA'],
  [/^Sardinha, conserva/, 'SARDINHA EM CONSERVA'],
  [/^Ovo, de galinha, inteiro/, 'OVO DE GALINHA'],
  [/^Queijo, minas/, 'QUEIJO DE MINAS'],
  [/^Queijo, mozarela/, 'QUEIJO MUZARELLA'],
  [/^Queijo, prato/, 'QUEIJO PRATO'],
  [/^Queijo, requeijão/, 'REQUEIJAO'],
  [/^Iogurte, natural/, 'IOGURTE NATURAL'],
  [/^Iogurte, sabor/, 'IOGURTE DE QUALQUER SABOR'],
  [/^Manteiga/, 'MANTEIGA COM OU SEM SAL'],
  [/^Margarina/, 'MARGARINA COM OU SEM SAL'],
  [/^Óleo, de soja/, 'OLEO DE SOJA'],
  [/^Óleo/, 'OLEO NAO ESPECIFICADO'],
  [/^Azeite, de oliva/, 'AZEITE DE OLIVA'],
  [/^Açúcar, mascavo/, 'ACUCAR MASCAVO'],
  [/^Açúcar/, 'ACUCAR'],
  [/^Achocolatado, pó/, 'ACHOCOLATADO EM PO'],
  [/^Mel, de abelha/, 'MEL'],
  [/^Café, infusão/, 'CAFE'],
  [/^Banana, (prata|nanica|maçã|ouro|da terra|figo|pacova)/, 'BANANA (OURO, PRATA, D´AGUA, DA TERRA, ETC)'],
  [/^Maçã/, 'MACA'],
  [/^Mamão/, 'MAMAO'],
  [/^Laranja, .*, suco/, 'SUCO DE LARANJA'],
  [/^Laranja/, 'LARANJA (PERA, SELETA, LIMA, DA TERRA, ETC)'],
  [/^Melancia/, 'MELANCIA'],
  [/^Abacate/, 'ABACATE'],
  [/^Manga/, 'MANGA'],
  [/^Uva, (Itália|Rubi)/, 'UVA'],
  [/^Morango/, 'MORANGO'],
  [/^Alface/, 'ALFACE'],
  [/^Tomate, com semente/, 'TOMATE'],
  [/^Cenoura/, 'CENOURA'],
  [/^Brócolis/, 'BROCOLIS'],
  [/^Beterraba/, 'BETERRABA'],
  [/^Pepino/, 'PEPINO'],
  [/^Amendoim, (grão|torrado)/, 'AMENDOIM (EM GRAO) (IN NATURA)'],
  [/^Castanha-de-caju/, 'CASTANHA DE CAJU'],
  [/^Castanha-do-Brasil/, 'CASTANHA DO PARA'],
  [/^Biscoito, salgado/, 'BISCOITO NAO ESPECIFICADO'],
  [/^Biscoito, doce, recheado/, 'BISCOITO RECHEADO'],
  [/^Biscoito, doce/, 'BISCOITO DOCE'],
  [/^Chocolate, (ao leite|meio amargo)/, 'CHOCOLATE'],
  [/^Refrigerante, tipo cola/, 'REFRIGERANTE DE COLA TRADICIONAL'],
  [/^Refrigerante, tipo guaraná/, 'REFRIGERANTE DE GUARANA TRADICIONAL'],
  [/^Coxinha/, 'COXINHA'],
];

// preparo da TACO -> preparação da POF ("CROZIDO(A)" é a grafia da própria POF)
const PREP = [
  [/cozid|infusão/, 'CROZIDO(A)'],
  [/grelhad/, 'GRELHADO(A)/BRASA/CHURRASCO'],
  [/frit/, 'FRITO(A)'],
  [/assad/, 'ASSADO(A)'],
  [/refogad/, 'REFOGADO(A)'],
  [/cru/, 'CRU(A)'],
];

// medidas úteis no dia a dia, na ordem em que aparecem no app
const MEASURES = [
  ['UNIDADE', 'unidade'],
  ['UNIDADE PEQUENA', 'unidade pequena'],
  ['UNIDADE MEDIA', 'unidade média'],
  ['UNIDADE GRANDE', 'unidade grande'],
  ['FATIA', 'fatia'],
  ['FILE', 'filé'],
  ['BIFE', 'bife'],
  ['PEITO', 'peito'],
  ['COXA', 'coxa'],
  ['SOBRECOXA', 'sobrecoxa'],
  ['COLHER DE SOPA', 'colher de sopa'],
  ['COLHER DE ARROZ/SERVIR', 'colher de servir'],
  ['CONCHA', 'concha'],
  ['ESCUMADEIRA', 'escumadeira'],
  ['COPO AMERICANO', 'copo americano'],
  ['COPO MEDIO', 'copo médio'],
  ['COPO GRANDE', 'copo grande'],
  ['XICARA DE CHA', 'xícara de chá'],
  ['XICARA DE CAFE', 'xícara de café'],
  ['LATA', 'lata'],
  ['POTE', 'pote'],
  ['PEDACO', 'pedaço'],
  ['COLHER DE SOBREMESA', 'colher de sobremesa'],
  ['COLHER DE CHA', 'colher de chá'],
  ['PORCAO', 'porção'],
];
const MAX_PORTIONS = 7;
const BODY_PARTS = ['peito', 'coxa', 'sobrecoxa'];
const COOKED_BEFORE_EATING = new Set([
  'Cereais e derivados',
  'Leguminosas e derivados',
  'Carnes e derivados',
  'Pescados e frutos do mar',
]);

const pofByName = new Map();
for (const p of pof) {
  const list = pofByName.get(p.descricao_alimento) ?? [];
  list.push(p);
  pofByName.set(p.descricao_alimento, list);
}

function portionsFor(food) {
  // A POF registra medidas "cruas" de macarrão iguais às do cozido (concha de 110 g),
  // o que não serve para massa crua: fica só em gramas.
  if (/^Macarrão, trigo, cru/.test(food.descricao)) return [];

  const link = LINKS.find(([re]) => re.test(food.descricao));
  if (!link) return [];
  const pofName = link[1];
  const rows = pofByName.get(pofName);
  if (!rows) throw new Error(`Nome da POF não existe: "${pofName}" (ligado a "${food.descricao}")`);

  const prep = PREP.find(([re]) => re.test(`${food.preparo} ${food.descricao}`.toLowerCase()))?.[1];
  const preps = new Set(rows.map((r) => r.descricao_preparacao));

  // Alimento cru que normalmente é cozido antes de comer (arroz, feijão, macarrão, carnes):
  // sem medida de cru na POF, as medidas disponíveis são do alimento pronto — e uma
  // "concha de macarrão cru" daria mais que o dobro das calorias reais. Fica só em gramas.
  if (prep === 'CRU(A)' && !preps.has('CRU(A)') && COOKED_BEFORE_EATING.has(food.categoria)) return [];

  const chosen = prep && preps.has(prep) ? prep : preps.has('NAO SE APLICA') ? 'NAO SE APLICA' : [...preps][0];
  const desc = food.descricao.toLowerCase();

  const portions = [];
  for (const [code, label] of MEASURES) {
    // partes do frango só valem para a própria parte (peito não tem "coxa")
    if (BODY_PARTS.includes(label) && !new RegExp(`\\b${label}\\b`).test(desc)) continue;
    const matches = rows.filter((r) => r.descricao_preparacao === chosen && r.descricao_medida === code);
    if (matches.length === 0) continue;
    const grams = matches.map((m) => Number(m.quantidade_g)).sort((a, b) => a - b)[Math.floor(matches.length / 2)];
    if (grams > 0 && !portions.some(([, g]) => g === grams && label.startsWith('colher'))) {
      portions.push([label, r1(grams)]);
    }
    if (portions.length >= MAX_PORTIONS) break;
  }
  return portions;
}

// ---------- alimentos da TACO ----------
const foods = [];
const skipped = [];
for (const t of taco) {
  const kcal = num(t.energia_kcal);
  if (kcal == null) {
    skipped.push(t.descricao);
    continue;
  }
  foods.push([
    Number(t.numero_alimento),
    t.descricao.replace(/\s+/g, ' ').trim(),
    t.categoria,
    r1(kcal),
    r1(num(t.proteina_g)),
    r1(num(t.carboidrato_g)),
    r1(num(t.lipideos_g)),
    r1(num(t.fibra_g)),
    portionsFor(t),
    'taco',
  ]);
}

// ---------- complemento: itens comuns que a TACO não analisou ----------
// Valores médios de rótulos de produtos brasileiros, por 100 g/ml. O app avisa
// que são valores de rótulo para a pessoa conferir com o produto que usa.
const pofPortions = (name, prep = 'NAO SE APLICA') =>
  portionsFor({ descricao: `__${name}`, preparo: prep }) ?? [];
LINKS.push([/^__LEITE INTEGRAL/, 'LEITE DE VACA INTEGRAL'], [/^__LEITE DESNATADO/, 'LEITE DE VACA DESNATADO'], [/^__AGUA DE COCO/, 'AGUA DE COCO']);

foods.push(
  [9001, 'Leite, de vaca, integral, UHT', 'Leite e derivados', 60, 3, 4.6, 3, 0, pofPortions('LEITE INTEGRAL'), 'rotulo'],
  [9002, 'Leite, de vaca, desnatado, UHT', 'Leite e derivados', 35, 3, 4.9, 0, 0, pofPortions('LEITE DESNATADO'), 'rotulo'],
  [9003, 'Água de coco', 'Bebidas (alcoólicas e não alcoólicas)', 19, 0, 4.5, 0, 0, pofPortions('AGUA DE COCO'), 'rotulo'],
  [9004, 'Whey protein, concentrado', 'Suplementos', 400, 78, 10, 6, 0, [['scoop (30 g)', 30]], 'rotulo'],
);

// Macarrão: a TACO só tem o cru. O cozido é estimado pelo rendimento típico da massa
// de trigo (absorve água e fica ~2,4x mais pesada), com as medidas da POF para macarrão cozido.
const PASTA_YIELD = 2.4;
const rawPasta = foods.find((f) => f[1] === 'Macarrão, trigo, cru');
LINKS.push([/^__MACARRAO COZIDO/, 'MACARRAO']);
foods.push([
  9005,
  'Macarrão, trigo, cozido',
  rawPasta[2],
  ...rawPasta.slice(3, 8).map((v) => r1(v / PASTA_YIELD)),
  portionsFor({ descricao: '__MACARRAO COZIDO', preparo: 'cozido', categoria: rawPasta[2] }),
  'estimado',
]);

// Alimentos do dia a dia sobem na busca ("leite" acha o de vaca antes do de cabra)
const COMMON = [
  /^Arroz, (tipo 1|integral), cozido/,
  /^Feijão, (carioca|preto), cozido/,
  /^Pão, trigo, francês/,
  /^Pão, trigo, forma, integral/,
  /^Frango, peito, sem pele, (grelhado|cozido)/,
  /^Frango, coxa, sem pele, cozida/,
  /^Carne, bovina, (patinho, sem gordura, grelhado|acém, moído, cozido|contra-filé, sem gordura, grelhado)/,
  /^Ovo, de galinha, inteiro, (cozido|frito)/,
  /^Leite, de vaca, (integral|desnatado), UHT/,
  /^Macarrão, trigo, cozido/,
  /^Batata, (inglesa|doce), cozida/,
  /^Mandioca, cozida/,
  /^Cuscuz, de milho/,
  /^Aveia, flocos/,
  /^Banana, (prata|nanica)/,
  /^Maçã, Fuji/,
  /^Mamão, Papaia/,
  /^Laranja, pêra, (crua|suco)/,
  /^Alface, crespa/,
  /^Tomate, com semente/,
  /^Café, infusão/,
  /^Açúcar, refinado/,
  /^Queijo, (mozarela|minas, frescal)/,
  /^Presunto, sem capa/,
  /^Manteiga, com sal/,
  /^Azeite, de oliva/,
  /^Iogurte, natural$/,
  /^Whey protein/,
  /^Água de coco/,
];
for (const f of foods) f.push(COMMON.some((re) => re.test(f[1])) ? 1 : 0);

writeFileSync(OUT, JSON.stringify(foods));

// ---------- relatório ----------
const withPortions = foods.filter((f) => f[8].length > 0).length;
console.log(`${foods.length} alimentos (${withPortions} com medidas caseiras, ${foods.filter((f) => f[10]).length} comuns) -> ${OUT}`);
console.log(`sem calorias na TACO (fora da base): ${skipped.join('; ')}`);
const unused = LINKS.filter(([re]) => !foods.some((f) => re.test(f[1])) && !String(re).includes('__'));
if (unused.length) console.log('regras sem nenhum alimento:', unused.map(([re]) => String(re)).join(' '));
