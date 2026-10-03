// La despensa y el recetario contra la base. Spec 21.

import type { SQLiteDatabase } from 'expo-sqlite';

import type { IsoDate } from '../core/dates.ts';
import type {
  NutritionFoodRow,
  PantryItemRow,
  PantryRecipeIngredientRow,
  PantryRecipeRow,
} from '../db/types.ts';
import { inTransaction } from '../db/transaction.ts';
import { createBatch } from '../nutrition/queries.ts';

import { perGram, potOf, type NeedsWeight } from './cook.ts';
import { toItem, toRecipe, type PantryItem, type Recipe } from './pantry.ts';

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export async function listPantry(db: SQLiteDatabase): Promise<PantryItem[]> {
  const rows = await db.getAllAsync<PantryItemRow>('SELECT * FROM pantry_item ORDER BY name;');
  return rows.map(toItem);
}

export type NewPantryItem = Omit<PantryItem, 'id'> & { id?: string };

/**
 * Escribe lo que el dijo que hay. Las columnas que no le tocan a esa forma van a null,
 * que es lo que pide el CHECK de la migracion 049: una fila no puede tener cantidad y
 * estado a la vez.
 */
export async function savePantryItem(
  db: SQLiteDatabase,
  item: NewPantryItem,
  at: Date = new Date(),
): Promise<string> {
  const name = item.name.trim();
  if (name === '') throw new Error('a pantry item needs a name');

  const counted = item.kind === 'counted' || item.kind === 'weighed';
  const id = item.id ?? newId('pantry');
  const unit = counted ? (item.unit ?? 'unidad') : null;

  // Lo contado y lo pesado van en la unidad de su alimento (spec 21.1): cocinar descuenta
  // en la del articulo y pesa la olla en la del alimento, y si no son la misma la olla
  // sale cien veces mal sin que nada lo diga.
  if (counted && item.foodId !== null) {
    const food = await db.getFirstAsync<{ base_unit: string }>(
      'SELECT base_unit FROM nutrition_food WHERE id = ?;',
      [item.foodId],
    );
    if (food !== null && food.base_unit !== unit) {
      throw new Error(
        `${name} está en ${unit} y su alimento va en ${food.base_unit}: ábrelo y pon la cantidad en ${food.base_unit}`,
      );
    }
  }

  await db.runAsync(
    `INSERT INTO pantry_item (id, name, kind, quantity, unit, state, has_it, food_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name,
       kind = excluded.kind,
       quantity = excluded.quantity,
       unit = excluded.unit,
       state = excluded.state,
       has_it = excluded.has_it,
       food_id = excluded.food_id,
       updated_at = excluded.updated_at;`,
    [
      id,
      name,
      item.kind,
      counted ? (item.quantity ?? 0) : null,
      unit,
      item.kind === 'durable' ? (item.state ?? 'hay') : null,
      item.kind === 'spice' ? (item.hasIt ? 1 : 0) : null,
      item.foodId,
      at.toISOString(),
    ],
  );
  return id;
}

/** Lo que paso al quitarlo: borrado, o vaciado porque estas recetas lo usan. */
export type PantryRemoval = { outcome: 'borrado' } | { outcome: 'vaciado'; recipes: string[] };

/**
 * Quita algo de la despensa sin sacarlo de las recetas (decision 2026-10-02).
 *
 * Borrarlo lo borraba tambien de cada receta que lo usaba, y la receta pasaba a decir "se
 * puede" y a cocinar una olla sin el. Si alguna receta lo usa, queda vacio en vez de
 * borrado: en cero, en "no hay" o sin tener, segun como se tenga, y la receta lo marca
 * como faltante por su nombre hasta que lo vuelva a tener.
 */
export async function removePantryItem(db: SQLiteDatabase, id: string): Promise<PantryRemoval> {
  const used = await db.getAllAsync<{ name: string }>(
    `SELECT r.name FROM pantry_recipe_ingredient i
       JOIN pantry_recipe r ON r.id = i.recipe_id
      WHERE i.item_id = ?
   ORDER BY r.name;`,
    [id],
  );
  if (used.length === 0) {
    await db.runAsync('DELETE FROM pantry_item WHERE id = ?;', [id]);
    return { outcome: 'borrado' };
  }
  await db.runAsync(
    `UPDATE pantry_item
        SET quantity = CASE WHEN kind IN ('counted', 'weighed') THEN 0 ELSE quantity END,
            state = CASE WHEN kind = 'durable' THEN 'no hay' ELSE state END,
            has_it = CASE WHEN kind = 'spice' THEN 0 ELSE has_it END,
            updated_at = ?
      WHERE id = ?;`,
    [new Date().toISOString(), id],
  );
  return { outcome: 'vaciado', recipes: used.map((row) => row.name) };
}

export async function listRecipes(db: SQLiteDatabase): Promise<Recipe[]> {
  const [rows, ingredients] = await Promise.all([
    db.getAllAsync<PantryRecipeRow>('SELECT * FROM pantry_recipe ORDER BY name;'),
    db.getAllAsync<PantryRecipeIngredientRow>('SELECT * FROM pantry_recipe_ingredient;'),
  ]);
  return rows.map((row) => toRecipe(row, ingredients));
}

export type NewRecipe = Omit<Recipe, 'id'> & { id?: string };

export async function saveRecipe(
  db: SQLiteDatabase,
  recipe: NewRecipe,
  at: Date = new Date(),
): Promise<string> {
  const name = recipe.name.trim();
  if (name === '') throw new Error('a recipe needs a name');
  if (!Number.isInteger(recipe.portions) || recipe.portions < 1) {
    throw new Error(`${recipe.portions} portions is not a way to divide a pot`);
  }

  const id = recipe.id ?? newId('recipe');
  await db.runAsync(
    `INSERT INTO pantry_recipe (id, name, steps, portions, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name,
       steps = excluded.steps,
       portions = excluded.portions;`,
    [id, name, recipe.steps.trim(), recipe.portions, at.toISOString()],
  );

  // Los ingredientes se reescriben enteros: una receta editada no deja los de antes.
  await db.runAsync('DELETE FROM pantry_recipe_ingredient WHERE recipe_id = ?;', [id]);
  for (const [index, ingredient] of recipe.ingredients.entries()) {
    await db.runAsync(
      `INSERT INTO pantry_recipe_ingredient (recipe_id, item_id, amount, position)
       VALUES (?, ?, ?, ?);`,
      [id, ingredient.itemId, ingredient.amount, index + 1],
    );
  }
  return id;
}

export async function removeRecipe(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM pantry_recipe WHERE id = ?;', [id]);
}

export type Cooked = {
  /** El lote que quedo, o null si no se pudo pesar lo que entro. */
  batchId: string | null;
  /** Lo que impidio el lote, por su nombre. */
  blocked: string[];
  /** Las fichas a las que les falta el peso por unidad: el aviso lleva a cada una. */
  needsWeight: NeedsWeight[];
};

/**
 * Cocinar: descuenta lo que se uso y deja la olla como un lote (spec 21.4).
 *
 * Las dos cosas van juntas o no va ninguna. Descontar la despensa y quedarse sin el lote
 * es lo peor de los dos mundos: ya no tiene los ingredientes y tampoco tiene que comer
 * anotado en ninguna parte.
 */
export async function cookRecipe(
  db: SQLiteDatabase,
  recipeId: string,
  today: IsoDate,
): Promise<Cooked> {
  const [recipes, items, foods] = await Promise.all([
    listRecipes(db),
    listPantry(db),
    db.getAllAsync<NutritionFoodRow>('SELECT * FROM nutrition_food;'),
  ]);

  const recipe = recipes.find((one) => one.id === recipeId);
  if (recipe === undefined) throw new Error(`there is no recipe called ${recipeId}`);

  const outcome = potOf(recipe.ingredients, items, foods);
  const byId = new Map(items.map((item) => [item.id, item]));
  let batchId: string | null = null;

  await inTransaction(db, async () => {
    for (const ingredient of recipe.ingredients) {
      const item = byId.get(ingredient.itemId);
      if (item === undefined) continue;
      if (item.kind !== 'counted' && item.kind !== 'weighed') continue;

      const left = Math.max(0, (item.quantity ?? 0) - (ingredient.amount ?? 0));
      await db.runAsync('UPDATE pantry_item SET quantity = ?, updated_at = ? WHERE id = ?;', [
        item.kind === 'counted' ? Math.round(left) : left,
        new Date().toISOString(),
        item.id,
      ]);
    }

    if (!outcome.ok) return;

    const per = perGram(outcome.pot);
    // Un alimento por olla y no por receta (2026-10-02): las porciones se guardan como
    // gramos de el, asi que reescribirlo en la siguiente coccion cambiaba lo que dicen los
    // dias en que se comio la olla anterior.
    const foodId = newId(`recipe-${recipe.id}`);
    await db.runAsync(
      `INSERT INTO nutrition_food
         (id, name, base_unit, unit_kind, base_unit_g, kcal, protein_g, carbs_g, sugar_g,
          fat_g, fibre_g, sodium_mg, source, is_dairy, from_recipe)
       VALUES (?, ?, 'g', 'mass', 1, ?, ?, ?, ?, ?, ?, ?, 'user_measured', 0, 1);`,
      [
        foodId,
        recipe.name,
        per.kcal,
        per.proteinG,
        per.carbsG,
        per.sugarG,
        per.fatG,
        per.fibreG,
        per.sodiumMg,
      ],
    );

    batchId = await createBatch(db, {
      foodId,
      rawWeightG: outcome.pot.grams,
      portionsCount: recipe.portions,
      cookedDate: today,
      fatDrained: false,
    });
  });

  return {
    batchId,
    blocked: outcome.ok ? [] : outcome.blocked,
    needsWeight: outcome.ok ? [] : outcome.needsWeight,
  };
}
