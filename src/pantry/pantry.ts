// Lo que hay en la nevera, y lo que se puede cocinar con ello. Spec 21.
//
// Aqui no se adivina nada: la despensa dice lo ultimo que el escribio, y comerse una
// porcion no descuenta nada por su cuenta. Cocina de paquetes que la app no vio, y una
// existencia que se descuenta sola acaba en ficcion en una semana (spec 21.5).

import type {
  PantryItemRow,
  PantryRecipeIngredientRow,
  PantryRecipeRow,
  PantryState,
} from '../db/types.ts';

export type PantryItem = {
  id: string;
  name: string;
  kind: PantryItemRow['kind'];
  /** Lo contado y lo pesado. */
  quantity: number | null;
  unit: string | null;
  /** Lo duradero. */
  state: PantryState | null;
  /** Las especias. */
  hasIt: boolean | null;
  foodId: string | null;
};

export type Ingredient = {
  itemId: string;
  /** Cuanto se gasta. Null en lo duradero y en las especias, que no se miden. */
  amount: number | null;
};

export type Recipe = {
  id: string;
  name: string;
  steps: string;
  portions: number;
  ingredients: Ingredient[];
};

export function toItem(row: PantryItemRow): PantryItem {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    quantity: row.quantity,
    unit: row.unit,
    state: row.state,
    hasIt: row.has_it === null ? null : row.has_it === 1,
    foodId: row.food_id,
  };
}

export function toRecipe(row: PantryRecipeRow, ingredients: PantryRecipeIngredientRow[]): Recipe {
  return {
    id: row.id,
    name: row.name,
    steps: row.steps,
    portions: row.portions,
    ingredients: ingredients
      .filter((one) => one.recipe_id === row.id)
      .sort((a, b) => a.position - b.position)
      .map((one) => ({ itemId: one.item_id, amount: one.amount })),
  };
}

/** Lo que falta de una receta, dicho por su nombre. Vacio es que se puede hacer ya. */
export type Missing = { itemId: string; name: string; why: 'falta' | 'poco' | 'no está' };

/**
 * Que falta para cocinarla, con lo que hay ahora mismo.
 *
 * La regla es distinta por forma de tener la cosa, porque tenerla significa otra cosa en
 * cada una (spec 21.3): lo contado y lo pesado alcanzan si la existencia cubre la
 * cantidad; lo duradero alcanza salvo que este en "no hay"; una especia se tiene o no.
 * "Poco" no lo bloquea: es un aviso, no un no.
 */
export function missingFor(recipe: Recipe, stock: readonly PantryItem[]): Missing[] {
  const byId = new Map(stock.map((item) => [item.id, item]));
  const missing: Missing[] = [];

  for (const ingredient of recipe.ingredients) {
    const item = byId.get(ingredient.itemId);
    if (item === undefined) {
      missing.push({ itemId: ingredient.itemId, name: 'algo que ya no está', why: 'no está' });
      continue;
    }

    if (item.kind === 'counted' || item.kind === 'weighed') {
      const have = item.quantity ?? 0;
      const need = ingredient.amount ?? 0;
      if (have < need) missing.push({ itemId: item.id, name: item.name, why: 'falta' });
      continue;
    }

    if (item.kind === 'durable') {
      if (item.state === 'no hay') missing.push({ itemId: item.id, name: item.name, why: 'falta' });
      else if (item.state === 'poco')
        missing.push({ itemId: item.id, name: item.name, why: 'poco' });
      continue;
    }

    if (item.hasIt !== true) missing.push({ itemId: item.id, name: item.name, why: 'falta' });
  }

  return missing;
}

export type Cookable = {
  recipe: Recipe;
  missing: Missing[];
  /** Lo que de verdad impide cocinarla: "poco" avisa, no bloquea. */
  short: Missing[];
};

/**
 * El recetario ordenado como se mira: primero lo que se puede hacer ya, luego lo que
 * esta a un ingrediente, y lo demas al final. Dentro de cada grupo, por nombre.
 */
export function cookableNow(recipes: readonly Recipe[], stock: readonly PantryItem[]): Cookable[] {
  return recipes
    .map((recipe) => {
      const missing = missingFor(recipe, stock);
      return { recipe, missing, short: missing.filter((one) => one.why !== 'poco') };
    })
    .sort((a, b) => {
      if (a.short.length !== b.short.length) return a.short.length - b.short.length;
      return a.recipe.name.localeCompare(b.recipe.name);
    });
}
