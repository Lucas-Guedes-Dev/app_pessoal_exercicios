import FOODS from '../data/foods.json';
import { normalize } from '../utils/text';

// Suba este número quando src/data/foods.json for regerado (tools/taco/build-foods.mjs):
// a base embutida é regravada na próxima abertura, sem mexer em favoritos,
// alimentos personalizados, medidas criadas pela pessoa ou no que já foi registrado.
const FOODS_VERSION = 1;

/**
 * Grava a base de alimentos (TACO + complementos) no banco. Formato de cada item:
 * [id, nome, categoria, kcal, proteína, carboidrato, gordura, fibra, porções, fonte, comum]
 */
export async function seedFoods(db) {
  const row = await db.getFirstAsync("SELECT value FROM settings WHERE key = 'foods_version'");
  if (Number(row?.value ?? 0) >= FOODS_VERSION) return;

  await db.withTransactionAsync(async () => {
    const upsertFood = await db.prepareAsync(
      `INSERT INTO foods (id, name, search, category, kcal, protein, carbs, fat, fiber, source, common)
       VALUES ($id, $name, $search, $category, $kcal, $protein, $carbs, $fat, $fiber, $source, $common)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, search = excluded.search, category = excluded.category,
         kcal = excluded.kcal, protein = excluded.protein, carbs = excluded.carbs,
         fat = excluded.fat, fiber = excluded.fiber, source = excluded.source, common = excluded.common`
    );
    const insertPortion = await db.prepareAsync(
      'INSERT INTO food_portions (food_id, label, grams, custom) VALUES ($foodId, $label, $grams, 0)'
    );
    try {
      // medidas da base são regravadas; as criadas pela pessoa (custom = 1) ficam
      await db.runAsync("DELETE FROM food_portions WHERE custom = 0 AND food_id < 100000");
      for (const [id, name, category, kcal, protein, carbs, fat, fiber, portions, source, common] of FOODS) {
        await upsertFood.executeAsync({
          $id: id,
          $name: name,
          $search: normalize(name),
          $category: category,
          $kcal: kcal,
          $protein: protein,
          $carbs: carbs,
          $fat: fat,
          $fiber: fiber,
          $source: source,
          $common: common,
        });
        for (const [label, grams] of portions) {
          await insertPortion.executeAsync({ $foodId: id, $label: label, $grams: grams });
        }
      }
    } finally {
      await upsertFood.finalizeAsync();
      await insertPortion.finalizeAsync();
    }

    await db.runAsync(
      `INSERT INTO settings (key, value) VALUES ('foods_version', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      String(FOODS_VERSION)
    );
  });
}
