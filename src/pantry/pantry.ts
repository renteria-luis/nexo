// Lo que hay en la nevera, y lo que se puede cocinar con ello. Spec 21.
//
// Aqui no se adivina nada: la despensa dice lo ultimo que el escribio, y comerse una
// porcion no descuenta nada por su cuenta. Cocina de paquetes que la app no vio, y una
// existencia que se descuenta sola acaba en ficcion en una semana (spec 21.5).

import { plain, type PantryCommand } from '../core/commands.ts';
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

/** Singular y plural son la misma cosa: "huevo" y "huevos", "lata" y "latas". */
function stem(text: string): string[] {
  return plain(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 ? word.replace(/(es|s)$/, '') : word));
}

/**
 * El articulo que nombra, o por que no se sabe cual. Primero el nombre tal cual; si no,
 * los que empiezan con lo que dijo ("leche" es "Leche 1%"). Si son varios, no se elige
 * uno a ojo: se dicen todos.
 */
export function findPantryItem(items: readonly PantryItem[], name: string): PantryItem | string {
  const said = stem(name);
  const same = items.filter((item) => stem(item.name).join(' ') === said.join(' '));
  const found =
    same.length > 0
      ? same
      : items.filter((item) => {
          const words = stem(item.name);
          return said.every((word, index) => words[index]?.startsWith(word));
        });
  if (found.length === 1) return found[0];
  if (found.length === 0) {
    return `No tengo "${name}" en la despensa. Agrégalo primero en Despensa, con su forma de contarse.`;
  }
  return `"${name}" puede ser ${found.map((item) => item.name).join(', ')}. Dime cuál.`;
}

/** Lo que hay de un articulo, dicho como lo diria el. */
export function stockOf(item: PantryItem): string {
  if (item.kind === 'durable') return item.state ?? 'hay';
  if (item.kind === 'spice') return item.hasIt ? 'hay' : 'no hay';
  const quantity = item.quantity ?? 0;
  return item.kind === 'weighed' ? `${quantity} ${item.unit ?? ''}`.trim() : String(quantity);
}

/** La cantidad dicha en la unidad del articulo, o por que no se puede convertir. */
function inItemUnit(item: PantryItem, command: PantryCommand): number | string {
  const amount = command.amount ?? 0;
  if (command.unit === null) return amount;
  if (item.kind === 'counted')
    return `${item.name} se cuenta por ${item.unit ?? 'unidad'}, sin ${command.unit}.`;
  const base = command.unit === 'kg' || command.unit === 'g' ? 'g' : 'ml';
  if (item.unit !== base) return `${item.name} va en ${item.unit}, no en ${command.unit}.`;
  return command.unit === 'kg' || command.unit === 'l' ? amount * 1000 : amount;
}

export type PantryChange = { item: PantryItem; reply: string };

/**
 * Lo que queda del articulo despues de lo que dijo (spec 21.5), o por que no le cabe. Lo
 * contado y lo pesado llevan cantidad; lo duradero solo hay, poco o no hay; una especia se
 * tiene o no (spec 21.1). Nada se adivina: un comando que no le cabe no cambia nada.
 */
export function changePantryItem(item: PantryItem, command: PantryCommand): PantryChange | string {
  const { action } = command;
  if (item.kind === 'durable' || item.kind === 'spice') {
    if (action === 'set') {
      return `${item.name} no se cuenta: di "queda poco ${command.item}", "se acabo ${command.item}" o "hay ${command.item}".`;
    }
    if (item.kind === 'spice' && action === 'low') {
      return `${item.name} se tiene o no: "hay ${command.item}" o "se acabo ${command.item}".`;
    }
    const next: PantryItem =
      item.kind === 'durable'
        ? { ...item, state: action === 'out' ? 'no hay' : action === 'low' ? 'poco' : 'hay' }
        : { ...item, hasIt: action !== 'out' };
    const unmeasured = command.amount !== null ? ' No se mide, así que no guardé la cantidad.' : '';
    return { item: next, reply: `${item.name}: ${stockOf(next)}.${unmeasured}` };
  }

  if (action === 'low' || action === 'have') {
    return `Cuánto queda de ${item.name}: "quedan 6 ${command.item}".`;
  }
  if (action === 'out') {
    const next = { ...item, quantity: 0 };
    return { item: next, reply: `${item.name}: se acabó, en ${stockOf(next)}.` };
  }
  if (command.amount === null) return `Cuánto compraste: "compre 12 ${command.item}".`;
  const amount = inItemUnit(item, command);
  if (typeof amount === 'string') return amount;
  if (item.kind === 'counted' && !Number.isInteger(amount)) {
    return `${item.name} se cuenta entero: ${amount} no es una cantidad.`;
  }
  const quantity = action === 'add' ? (item.quantity ?? 0) + amount : amount;
  const next = { ...item, quantity };
  const unit = item.kind === 'weighed' ? ` ${item.unit ?? ''}` : '';
  return {
    item: next,
    reply:
      action === 'add'
        ? `${item.name}: +${amount}${unit}, ahora ${stockOf(next)}.`
        : `${item.name}: ahora ${stockOf(next)}.`,
  };
}
