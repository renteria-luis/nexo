// Lo que sale de la olla, en numeros. Spec 21.4.
//
// Cocinar una receta es un lote (spec 7.3): se pesa una vez lo que entro, se reparte por
// ojo en N recipientes y cada porcion vale lo mismo. Aqui se calcula lo que entro, que
// es la suma de sus ingredientes con las cifras que el mismo verifico en el catalogo.
//
// Lo duradero y las especias no entran en la cuenta porque no se miden (spec 21.1): el
// aceite de la sarten no esta en estas calorias y la pantalla lo dice. Un numero que
// dice de donde sale vale mas que uno completo que se invento la mitad.

import type { NutritionFoodRow } from '../db/types.ts';

import type { Ingredient, PantryItem } from './pantry.ts';

export type Pot = {
  /** Lo que pesa lo que entro, que es lo que el lote reparte. */
  grams: number;
  kcal: number;
  proteinG: number;
  carbsG: number | null;
  sugarG: number | null;
  fatG: number;
  fibreG: number | null;
  sodiumMg: number | null;
};

export type PotOutcome =
  | { ok: true; pot: Pot }
  /** Los que no se pueden pesar, por su nombre: sin ficha o sin peso por unidad. */
  | { ok: false; blocked: string[] };

function add(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}

export function potOf(
  ingredients: readonly Ingredient[],
  items: readonly PantryItem[],
  foods: readonly NutritionFoodRow[],
): PotOutcome {
  const byItem = new Map(items.map((item) => [item.id, item]));
  const byFood = new Map(foods.map((food) => [food.id, food]));

  const pot: Pot = {
    grams: 0,
    kcal: 0,
    proteinG: 0,
    carbsG: 0,
    sugarG: 0,
    fatG: 0,
    fibreG: 0,
    sodiumMg: 0,
  };
  const blocked: string[] = [];

  for (const ingredient of ingredients) {
    const item = byItem.get(ingredient.itemId);
    if (item === undefined) continue;
    // Lo que no se mide no suma: no se sabe cuanto se uso.
    if (item.kind === 'durable' || item.kind === 'spice') continue;

    const amount = ingredient.amount ?? 0;
    if (amount <= 0) continue;

    const food = item.foodId === null ? undefined : byFood.get(item.foodId);
    if (food === undefined || food.base_unit_g === null) {
      blocked.push(`${item.name}, sin ficha con peso`);
      continue;
    }
    // La receta y la despensa cuentan en la unidad del articulo y la olla en la del
    // alimento: con unidades distintas, tres piezas de pollo pesaban 3 g.
    if (item.unit !== food.base_unit) {
      blocked.push(`${item.name}, que está en ${item.unit} y su ficha en ${food.base_unit}`);
      continue;
    }

    pot.grams += amount * food.base_unit_g;
    pot.kcal += amount * food.kcal;
    pot.proteinG += amount * food.protein_g;
    pot.fatG += amount * food.fat_g;
    pot.carbsG = add(pot.carbsG, food.carbs_g === null ? null : amount * food.carbs_g);
    pot.sugarG = add(pot.sugarG, food.sugar_g === null ? null : amount * food.sugar_g);
    pot.fibreG = add(pot.fibreG, food.fibre_g === null ? null : amount * food.fibre_g);
    pot.sodiumMg = add(pot.sodiumMg, food.sodium_mg === null ? null : amount * food.sodium_mg);
  }

  if (blocked.length > 0) return { ok: false, blocked };
  if (!(pot.grams > 0)) return { ok: false, blocked: ['nada que pesar'] };
  return { ok: true, pot };
}

/** Lo mismo por gramo, que es como se guarda un alimento del catalogo. */
export function perGram(pot: Pot): Omit<Pot, 'grams'> {
  const share = (value: number | null) => (value === null ? null : value / pot.grams);
  return {
    kcal: pot.kcal / pot.grams,
    proteinG: pot.proteinG / pot.grams,
    carbsG: share(pot.carbsG),
    sugarG: share(pot.sugarG),
    fatG: pot.fatG / pot.grams,
    fibreG: share(pot.fibreG),
    sodiumMg: share(pot.sodiumMg),
  };
}
