import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';
import { listFoods, listOpenBatches } from '../nutrition/queries.ts';

import { potOf } from './cook.ts';
import { cookableNow, missingFor, type PantryItem, type Recipe } from './pantry.ts';
import { cookRecipe, listPantry, listRecipes, savePantryItem, saveRecipe } from './queries.ts';

type SqlValue = string | number | null;

function fresh(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  return {
    getAllAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T[]> =>
      raw.prepare(source).all(...params) as T[],
    getFirstAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T | null> =>
      (raw.prepare(source).get(...params) as T) ?? null,
    runAsync: async (source: string, params: SqlValue[] = []) => {
      raw.prepare(source).run(...params);
      return { changes: 0, lastInsertRowId: 0 };
    },
    withTransactionAsync: async (task: () => Promise<void>) => {
      await task();
    },
  } as unknown as SQLiteDatabase;
}

function item(overrides: Partial<PantryItem> & { id: string; kind: PantryItem['kind'] }) {
  return {
    name: overrides.id,
    quantity: null,
    unit: null,
    state: null,
    hasIt: null,
    foodId: null,
    ...overrides,
  } satisfies PantryItem;
}

const RECIPE: Recipe = {
  id: 'r1',
  name: 'Pollo con arroz',
  steps: '',
  portions: 4,
  ingredients: [
    { itemId: 'pollo', amount: 600 },
    { itemId: 'aceite', amount: null },
    { itemId: 'sal', amount: null },
  ],
};

test('tener algo significa una cosa distinta en cada forma', () => {
  const enough = [
    item({ id: 'pollo', kind: 'weighed', quantity: 800, unit: 'g' }),
    item({ id: 'aceite', kind: 'durable', state: 'hay' }),
    item({ id: 'sal', kind: 'spice', hasIt: true }),
  ];
  assert.deepEqual(missingFor(RECIPE, enough), []);

  const short = [
    item({ id: 'pollo', kind: 'weighed', quantity: 300, unit: 'g' }),
    item({ id: 'aceite', kind: 'durable', state: 'no hay' }),
    item({ id: 'sal', kind: 'spice', hasIt: false }),
  ];
  assert.deepEqual(
    missingFor(RECIPE, short).map((one) => one.itemId),
    ['pollo', 'aceite', 'sal'],
  );
});

test('"poco" avisa pero no impide cocinar', () => {
  const stock = [
    item({ id: 'pollo', kind: 'weighed', quantity: 800, unit: 'g' }),
    item({ id: 'aceite', kind: 'durable', state: 'poco' }),
    item({ id: 'sal', kind: 'spice', hasIt: true }),
  ];
  const [only] = cookableNow([RECIPE], stock);
  assert.equal(only.missing.length, 1);
  assert.equal(only.short.length, 0);
});

test('primero lo que se puede hacer ya', () => {
  const stock = [
    item({ id: 'pollo', kind: 'weighed', quantity: 800, unit: 'g' }),
    item({ id: 'aceite', kind: 'durable', state: 'hay' }),
    item({ id: 'sal', kind: 'spice', hasIt: true }),
    item({ id: 'pasta', kind: 'weighed', quantity: 0, unit: 'g' }),
  ];
  const other: Recipe = {
    ...RECIPE,
    id: 'r2',
    name: 'Alfredo',
    ingredients: [{ itemId: 'pasta', amount: 200 }],
  };
  assert.deepEqual(
    cookableNow([other, RECIPE], stock).map((one) => one.recipe.id),
    ['r1', 'r2'],
  );
});

test('la olla pesa lo que entro, y lo que no se mide no suma', () => {
  const foods = [
    {
      id: 'chicken',
      base_unit_g: 1,
      kcal: 1.65,
      protein_g: 0.31,
      carbs_g: 0,
      sugar_g: null,
      fat_g: 0.036,
      fibre_g: null,
      sodium_mg: null,
    },
  ];
  const stock = [
    item({ id: 'pollo', kind: 'weighed', quantity: 800, unit: 'g', foodId: 'chicken' }),
    item({ id: 'aceite', kind: 'durable', state: 'hay' }),
    item({ id: 'sal', kind: 'spice', hasIt: true }),
  ];

  const outcome = potOf(RECIPE.ingredients, stock, foods as never);
  assert.ok(outcome.ok);
  assert.equal(outcome.pot.grams, 600);
  assert.equal(Math.round(outcome.pot.proteinG), 186);
  // El azucar de un ingrediente sin dato deja la olla sin dato, no en cero.
  assert.equal(outcome.pot.sugarG, null);
});

test('un ingrediente sin ficha no se puede pesar y lo dice', () => {
  const stock = [item({ id: 'pollo', kind: 'weighed', quantity: 800, unit: 'g' })];
  const outcome = potOf([{ itemId: 'pollo', amount: 600 }], stock, []);
  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.ok ? [] : outcome.blocked, ['pollo']);
});

test('cocinar descuenta lo que se midio y deja la olla como lote', async () => {
  const db = fresh();
  const pollo = await savePantryItem(db, {
    name: 'Pechuga',
    kind: 'weighed',
    quantity: 800,
    unit: 'g',
    state: null,
    hasIt: null,
    foodId: 'chicken-burger',
  });
  const sal = await savePantryItem(db, {
    name: 'Sal',
    kind: 'spice',
    quantity: null,
    unit: null,
    state: null,
    hasIt: true,
    foodId: null,
  });
  const recipe = await saveRecipe(db, {
    name: 'Pollo con arroz',
    steps: 'Cocinar todo',
    portions: 4,
    ingredients: [
      { itemId: pollo, amount: 3 },
      { itemId: sal, amount: null },
    ],
  });

  const cooked = await cookRecipe(db, recipe, '2026-09-30');
  assert.ok(cooked.batchId !== null);
  assert.deepEqual(cooked.blocked, []);

  const after = await listPantry(db);
  assert.equal(after.find((one) => one.id === pollo)?.quantity, 797);
  // Las especias no se mueven: no se midieron.
  assert.equal(after.find((one) => one.id === sal)?.hasIt, true);

  const batch = await db.getFirstAsync<{ portions_count: number; raw_weight_g: number }>(
    'SELECT * FROM nutrition_batch WHERE id = ?;',
    [cooked.batchId!],
  );
  assert.equal(batch?.portions_count, 4);
  // Tres hamburguesas de 142 g.
  assert.equal(Math.round(batch?.raw_weight_g ?? 0), 426);
});

test('la olla cocinada sale entre las tandas abiertas, con su alimento', async () => {
  const db = fresh();
  const pollo = await savePantryItem(db, {
    name: 'Pechuga',
    kind: 'weighed',
    quantity: 800,
    unit: 'g',
    state: null,
    hasIt: null,
    foodId: 'chicken-burger',
  });
  const recipe = await saveRecipe(db, {
    name: 'Pollo con arroz',
    steps: '',
    portions: 4,
    ingredients: [{ itemId: pollo, amount: 3 }],
  });

  const cooked = await cookRecipe(db, recipe, '2026-09-30');

  // El alimento de la olla no sale en el buscador, a proposito, y la tanda igual lo encuentra.
  assert.equal(
    (await listFoods(db)).some((food) => food.from_recipe === 1),
    false,
  );
  const open = await listOpenBatches(db);
  assert.deepEqual(
    open.map((entry) => entry.batch.id),
    [cooked.batchId],
  );
  assert.equal(open[0].food.name, 'Pollo con arroz');
  assert.equal(open[0].food.from_recipe, 1);
});

test('una receta editada no deja los ingredientes de antes', async () => {
  const db = fresh();
  const uno = await savePantryItem(db, {
    name: 'Uno',
    kind: 'counted',
    quantity: 5,
    unit: 'unidad',
    state: null,
    hasIt: null,
    foodId: null,
  });
  const dos = await savePantryItem(db, {
    name: 'Dos',
    kind: 'counted',
    quantity: 5,
    unit: 'unidad',
    state: null,
    hasIt: null,
    foodId: null,
  });
  const id = await saveRecipe(db, {
    name: 'Algo',
    steps: '',
    portions: 2,
    ingredients: [{ itemId: uno, amount: 1 }],
  });
  await saveRecipe(db, {
    id,
    name: 'Algo',
    steps: '',
    portions: 2,
    ingredients: [{ itemId: dos, amount: 2 }],
  });

  const [only] = await listRecipes(db);
  assert.deepEqual(only.ingredients, [{ itemId: dos, amount: 2 }]);
});
