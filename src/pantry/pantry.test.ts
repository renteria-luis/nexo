import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';
import { dailyTotals } from '../nutrition/totals.ts';
import {
  addFood,
  consumeBatchPortion,
  getFood,
  listFoods,
  listOpenBatches,
  listPortions,
  updateFood,
} from '../nutrition/queries.ts';

import { potOf } from './cook.ts';
import { cookableNow, missingFor, type PantryItem, type Recipe } from './pantry.ts';
import {
  cookRecipe,
  listPantry,
  listRecipes,
  removePantryItem,
  savePantryItem,
  saveRecipe,
} from './queries.ts';

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
      base_unit: 'g',
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
  assert.deepEqual(outcome.ok ? [] : outcome.blocked, ['pollo, sin ficha con peso']);
});

test('piezas de un alimento que se anota en gramos no pesan la olla: lo dice en vez de dar 3 g', () => {
  const pechuga = { id: 'chicken', base_unit: 'g', base_unit_g: 1, kcal: 1.2, protein_g: 0.224 };
  const stock = [
    item({
      id: 'pollo',
      name: 'Pechugas',
      kind: 'counted',
      quantity: 6,
      unit: 'pieza',
      foodId: 'chicken',
    }),
  ];
  const outcome = potOf([{ itemId: 'pollo', amount: 3 }], stock, [pechuga] as never);
  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.ok ? [] : outcome.blocked, [
    'Pechugas, que está en pieza y su ficha en g',
  ]);
});

test('lo contado o pesado con alimento no se guarda en otra unidad que la del alimento', async () => {
  const db = fresh();
  await assert.rejects(
    savePantryItem(db, {
      name: 'Pechugas',
      kind: 'counted',
      quantity: 6,
      unit: 'pieza',
      state: null,
      hasIt: null,
      foodId: 'chicken-breast-kirkland',
    }),
    /Pechugas está en pieza y su alimento va en g/,
  );
  assert.deepEqual(await listPantry(db), []);

  // En la unidad del alimento si entra, y sin alimento cualquier unidad vale.
  await savePantryItem(db, {
    name: 'Pechugas',
    kind: 'weighed',
    quantity: 1600,
    unit: 'g',
    state: null,
    hasIt: null,
    foodId: 'chicken-breast-kirkland',
  });
  await savePantryItem(db, {
    name: 'Latas',
    kind: 'counted',
    quantity: 4,
    unit: 'lata',
    state: null,
    hasIt: null,
    foodId: null,
  });
  assert.equal((await listPantry(db)).length, 2);
});

test('cocinar descuenta lo que se midio y deja la olla como lote', async () => {
  const db = fresh();
  const pollo = await savePantryItem(db, {
    name: 'Hamburguesas',
    kind: 'counted',
    quantity: 8,
    unit: 'unidad',
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
  assert.equal(after.find((one) => one.id === pollo)?.quantity, 5);
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
    name: 'Hamburguesas',
    kind: 'counted',
    quantity: 8,
    unit: 'unidad',
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

test('volver a cocinar con otras cantidades no cambia la olla anterior ni sus dias', async () => {
  const db = fresh();
  const hamburguesas = await savePantryItem(db, {
    name: 'Hamburguesas',
    kind: 'counted',
    quantity: 10,
    unit: 'unidad',
    state: null,
    hasIt: null,
    foodId: 'chicken-burger',
  });
  const avena = await savePantryItem(db, {
    name: 'Avena',
    kind: 'weighed',
    quantity: 1000,
    unit: 'g',
    state: null,
    hasIt: null,
    foodId: 'oats-quaker',
  });
  const recipe = await saveRecipe(db, {
    name: 'Hamburguesas con avena',
    steps: '',
    portions: 4,
    ingredients: [
      { itemId: hamburguesas, amount: 3 },
      { itemId: avena, amount: 100 },
    ],
  });

  const first = await cookRecipe(db, recipe, '2026-09-21');
  const [eaten] = await listOpenBatches(db);
  await consumeBatchPortion(db, first.batchId!, '2026-09-21', 'mediodía');
  const before = dailyTotals(await listPortions(db, '2026-09-21'));

  await saveRecipe(db, {
    id: recipe,
    name: 'Hamburguesas con avena',
    steps: '',
    portions: 4,
    ingredients: [
      { itemId: hamburguesas, amount: 1 },
      { itemId: avena, amount: 300 },
    ],
  });
  const second = await cookRecipe(db, recipe, '2026-09-28');

  const open = await listOpenBatches(db);
  const firstPot = open.find((entry) => entry.batch.id === first.batchId)!;
  const secondPot = open.find((entry) => entry.batch.id === second.batchId)!;
  assert.notEqual(firstPot.food.id, secondPot.food.id);
  assert.equal(firstPot.food.protein_g, eaten.food.protein_g);
  assert.notEqual(secondPot.food.protein_g, eaten.food.protein_g);
  assert.deepEqual(dailyTotals(await listPortions(db, '2026-09-21')), before);
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

test('quitar de la despensa algo que usa una receta la deja diciendo que falta', async () => {
  const db = fresh();
  const pollo = await savePantryItem(db, {
    name: 'Hamburguesas',
    kind: 'counted',
    quantity: 8,
    unit: 'unidad',
    state: null,
    hasIt: null,
    foodId: 'chicken-burger',
  });
  const aceite = await savePantryItem(db, {
    name: 'Aceite',
    kind: 'durable',
    quantity: null,
    unit: null,
    state: 'hay',
    hasIt: null,
    foodId: null,
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
  await saveRecipe(db, {
    name: 'Hamburguesas al sarten',
    steps: '',
    portions: 4,
    ingredients: [
      { itemId: pollo, amount: 4 },
      { itemId: aceite, amount: null },
    ],
  });

  assert.deepEqual(await removePantryItem(db, pollo), {
    outcome: 'vaciado',
    recipes: ['Hamburguesas al sarten'],
  });
  assert.equal((await removePantryItem(db, aceite)).outcome, 'vaciado');
  // Lo que ninguna receta usa si se borra.
  assert.deepEqual(await removePantryItem(db, sal), { outcome: 'borrado' });

  const [recipe] = await listRecipes(db);
  const [cookable] = cookableNow([recipe], await listPantry(db));
  // Antes la receta perdia el ingrediente y pasaba a decir "se puede".
  assert.equal(recipe.ingredients.length, 2);
  assert.deepEqual(
    cookable.short.map((missing) => missing.name),
    ['Hamburguesas', 'Aceite'],
  );
  assert.deepEqual((await listPantry(db)).map((item) => item.name).sort(), [
    'Aceite',
    'Hamburguesas',
  ]);
});

test('la olla sin lote dice que ficha necesita peso, y con el peso puesto ya deja el lote', async () => {
  const db = fresh();
  // Tortillas creadas en la app: contadas, sin lo que pesa una.
  const tortillas = await addFood(db, {
    name: 'Tortillas',
    amount: 1,
    unit: 'unidad',
    kind: 'count',
    kcal: 90,
    proteinG: 2.5,
    fatG: 2,
    carbsG: 15,
  });
  const item = await savePantryItem(db, {
    name: 'Tortillas',
    kind: 'counted',
    quantity: 10,
    unit: 'unidad',
    state: null,
    hasIt: null,
    foodId: tortillas,
  });
  const recipe = await saveRecipe(db, {
    name: 'Quesadillas',
    steps: '',
    portions: 2,
    ingredients: [{ itemId: item, amount: 2 }],
  });

  const first = await cookRecipe(db, recipe, '2026-10-01');
  assert.equal(first.batchId, null);
  assert.deepEqual(first.needsWeight, [{ foodId: tortillas, name: 'Tortillas' }]);

  // La ficha ahora acepta lo que pesa una unidad, que es a donde lleva el aviso.
  const food = await getFood(db, tortillas);
  await updateFood(db, tortillas, {
    name: food.name,
    kcal: food.kcal,
    proteinG: food.protein_g,
    fatG: food.fat_g,
    carbsG: food.carbs_g,
    sugarG: food.sugar_g,
    sodiumMg: food.sodium_mg,
    gramsPerUnit: 40,
    keywords: null,
    quickAmounts: null,
  });

  const second = await cookRecipe(db, recipe, '2026-10-02');
  assert.ok(second.batchId !== null);
  assert.deepEqual(second.needsWeight, []);
});
