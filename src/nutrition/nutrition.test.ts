import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';
import type { NutritionBatchRow, NutritionFoodRow, UnitKind } from '../db/types.ts';

import { SPOILAGE_WARNING_DAYS, portionMacros, spoilageWarning } from './batch.ts';
import {
  addFoodEntry,
  addFoodFromLabel,
  consumeBatchPortion,
  createBatch,
  deleteFoodEntry,
  getFood,
  listFoods,
  listOpenBatches,
  listPortions,
} from './queries.ts';
import { SODIUM_FLAG_MG, dailyTotals, dairyPortions, type LoggedPortion } from './totals.ts';
import { portionLabel, quickAmounts, unitLabel } from './units.ts';

type SqlValue = string | number | null;

function adapt(db: DatabaseSync): SQLiteDatabase {
  return {
    getAllAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T[]> =>
      db.prepare(source).all(...params) as T[],
    getFirstAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T | null> =>
      (db.prepare(source).get(...params) as T) ?? null,
    runAsync: async (source: string, params: SqlValue[] = []) => {
      db.prepare(source).run(...params);
      return { changes: 0, lastInsertRowId: 0 };
    },
    withTransactionAsync: async (task: () => Promise<void>) => {
      db.exec('BEGIN;');
      try {
        await task();
        db.exec('COMMIT;');
      } catch (error) {
        db.exec('ROLLBACK;');
        throw error;
      }
    },
  } as unknown as SQLiteDatabase;
}

function seeded(): { db: SQLiteDatabase; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  return { db: adapt(raw), raw };
}

function food(overrides: Partial<NutritionFoodRow> = {}): NutritionFoodRow {
  return {
    id: 'chicken',
    name: 'Pechuga de pollo',
    brand: null,
    store: null,
    base_unit: 'g',
    unit_kind: 'mass' as const,
    base_unit_g: 1,
    kcal: 1.65,
    protein_g: 0.31,
    carbs_g: 0,
    sugar_g: 0,
    fat_g: 0.036,
    fibre_g: 0,
    sodium_mg: 0.74,
    barcode: null,
    source: 'user_measured',
    price_cad_cents: null,
    package_size: null,
    glycemic_index: null,
    is_dairy: 0,
    ...overrides,
  };
}

function portion(quantity: number, overrides: Partial<NutritionFoodRow> = {}): LoggedPortion {
  return { entryId: `e-${quantity}`, quantity, mealSlot: 'almuerzo', food: food(overrides) };
}

function batch(overrides: Partial<NutritionBatchRow> = {}): NutritionBatchRow {
  return {
    id: 'b-1',
    food_id: 'chicken',
    raw_weight_g: 1600,
    cooked_weight_g: null,
    portions_count: 8,
    cooked_date: '2026-09-10',
    portions_remaining: 8,
    fat_drained: 0,
    ...overrides,
  };
}

test('a day adds up across portions', () => {
  const totals = dailyTotals([portion(200), portion(150)]);
  assert.ok(Math.abs(totals.proteinG - 0.31 * 350) < 1e-9);
  assert.ok(Math.abs(totals.kcal - 1.65 * 350) < 1e-9);
  // No food carries a glycemic index yet, so that gap is expected; no macro is.
  assert.deepEqual(
    totals.missing.map((gap) => gap.nutrient),
    ['glycemic_index'],
  );
});

test('a nutrient the catalog does not have is reported, never counted as zero', () => {
  // Spec 7.1 leaves the carbohydrate cell blank for oats.
  const totals = dailyTotals([portion(1, { id: 'oats', name: 'Avena', carbs_g: null })]);

  assert.equal(totals.carbsG, 0);
  assert.ok(
    totals.missing.some((gap) => gap.nutrient === 'carbs_g' && gap.foodId === 'oats'),
    'the blank carbohydrate figure should be reported',
  );
});

test('sodium is flagged above the 2300 mg line in spec 3.3', () => {
  // Two Chef Woo cups at 1130 mg each.
  const chefWoo = {
    id: 'chef-woo',
    name: 'Chef Woo',
    sodium_mg: 1130,
    unit_kind: 'count' as const,
  };
  const under = dailyTotals([portion(1, chefWoo)]);
  const over = dailyTotals([portion(2, chefWoo)]);

  assert.equal(under.sodiumOverLimit, false);
  assert.equal(over.sodiumMg, 2260);
  assert.equal(over.sodiumOverLimit, false);

  const withMore = dailyTotals([
    portion(2, chefWoo),
    portion(1, { sodium_mg: 680, unit_kind: 'count' as const }),
  ]);
  assert.ok(withMore.sodiumMg > SODIUM_FLAG_MG);
  assert.equal(withMore.sodiumOverLimit, true);
});

test('glycemic load stays null while no food carries an index', () => {
  const totals = dailyTotals([portion(1)]);
  assert.equal(totals.glycemicLoad, null);
  assert.ok(totals.missing.some((gap) => gap.nutrient === 'glycemic_index'));
});

test('glycemic load uses available carbohydrate, not total', () => {
  const rice = { id: 'rice', name: 'Arroz', carbs_g: 28, fibre_g: 0.4, glycemic_index: 73 };
  const totals = dailyTotals([portion(2, rice)]);

  // 73 * ((28 - 0.4) * 2) / 100
  assert.ok(totals.glycemicLoad !== null);
  assert.ok(Math.abs(totals.glycemicLoad - 40.296) < 1e-9);
});

test('the dairy total counts portions, and removes nothing', () => {
  const milk = { id: 'milk', name: 'Leche', is_dairy: 1 as const };
  assert.equal(dairyPortions([portion(450, milk), portion(200)]), 450);
});

test('protein per portion comes from the raw weight, not from weighing each piece', () => {
  // Spec 7.3: a 1.6 kg pack into 8 containers, 31 g protein per 100 g.
  const macros = portionMacros(batch(), food());
  assert.equal(macros.proteinG, (1600 * 0.31) / 8);
  assert.equal(macros.kcal, (1600 * 1.65) / 8);
  assert.equal(macros.kcalRange, null);
});

test('an uneven split does not change the protein per portion arithmetic', () => {
  const six = portionMacros(batch({ portions_count: 6 }), food());
  const eight = portionMacros(batch({ portions_count: 8 }), food());
  assert.equal(six.proteinG * 6, eight.proteinG * 8);
});

test('a drained batch reports calories as a range and protein exactly', () => {
  const beef = food({ id: 'beef', name: 'Carne molida', kcal: 2.5, protein_g: 0.26, fat_g: 0.17 });
  const macros = portionMacros(batch({ food_id: 'beef', fat_drained: 1 }), beef);

  assert.equal(macros.proteinG, (1600 * 0.26) / 8);
  assert.equal(macros.kcal, null);
  assert.ok(macros.kcalRange);
  // The bottom is what is left with no fat at all, the top is the label.
  assert.equal(macros.kcalRange.to, (1600 * 2.5) / 8);
  assert.equal(macros.kcalRange.from, macros.proteinG * 4);
  assert.ok(macros.kcalRange.from < macros.kcalRange.to);
});

test('a food with no weight per base unit cannot be batched', () => {
  const jbc = food({
    id: 'wendys-jbc',
    base_unit: 'unidad',
    unit_kind: 'count' as const,
    base_unit_g: null,
  });
  assert.throws(
    () => portionMacros(batch({ food_id: 'wendys-jbc' }), jbc),
    /no weight for its base unit/,
  );
});

test('a batch belongs to one food and will not be priced against another', () => {
  assert.throws(() => portionMacros(batch({ food_id: 'beef' }), food()), /is for food beef/);
});

test('spoilage warns once a batch is three days old with portions left', () => {
  const cooked = batch({ cooked_date: '2026-09-10', portions_remaining: 3 });

  assert.equal(spoilageWarning(cooked, '2026-09-12'), null);

  const warning = spoilageWarning(cooked, '2026-09-13');
  assert.deepEqual(warning, {
    batchId: 'b-1',
    portionsRemaining: 3,
    ageDays: SPOILAGE_WARNING_DAYS,
  });

  assert.equal(spoilageWarning({ ...cooked, portions_remaining: 0 }, '2026-09-20'), null);
});

test('portions come back joined to their food, in the order they were eaten', async () => {
  const { db, raw } = seeded();
  raw.exec(`
    INSERT INTO nutrition_food_entry (id, food_id, quantity, unit, timestamp, date, meal_slot)
    VALUES
      ('e2', 'eggs-large', 6, 'huevo', 2000, '2026-09-13', 'desayuno'),
      ('e1', 'milk-1',   450, 'ml',    1000, '2026-09-13', 'desayuno'),
      ('e3', 'chef-woo',   1, 'vaso',  3000, '2026-09-14', 'almuerzo');
  `);

  const portions = await listPortions(db, '2026-09-13');
  assert.deepEqual(
    portions.map((entry) => entry.entryId),
    ['e1', 'e2'],
  );
  assert.equal(portions[0].food.name, 'Leche 1%');

  // Spec 7.2: 450 ml of 1% milk is 16.2 g of protein and six eggs are 39 g.
  const totals = dailyTotals(portions);
  assert.ok(Math.abs(totals.proteinG - (16.2 + 39)) < 1e-9);
});

test('open batches come back oldest first and closed ones do not', async () => {
  const { db, raw } = seeded();
  raw.exec(`
    INSERT INTO nutrition_batch
      (id, food_id, raw_weight_g, portions_count, cooked_date, portions_remaining)
    VALUES
      ('newer', 'chicken-burger', 852, 6, '2026-09-12', 4),
      ('older', 'chicken-burger', 852, 6, '2026-09-09', 2),
      ('gone',  'chicken-burger', 852, 6, '2026-09-01', 0);
  `);

  const open = await listOpenBatches(db);
  assert.deepEqual(
    open.map((entry) => entry.id),
    ['older', 'newer'],
  );
});

test('asking for a food that is not there fails instead of returning nothing', async () => {
  const { db } = seeded();
  assert.equal((await getFood(db, 'milk-1')).name, 'Leche 1%');
  await assert.rejects(() => getFood(db, 'nope'), /no food with id nope/);
});

test('a logged portion lands on the day and comes back with its food', async () => {
  const { db } = seeded();

  await addFoodEntry(db, {
    foodId: 'milk-1',
    quantity: 450,
    unit: 'ml',
    date: '2026-09-13',
    mealSlot: 'desayuno',
  });
  await addFoodEntry(db, {
    foodId: 'eggs-large',
    quantity: 6,
    unit: 'huevo',
    date: '2026-09-13',
    mealSlot: 'desayuno',
  });
  await addFoodEntry(db, {
    foodId: 'chef-woo',
    quantity: 1,
    unit: 'vaso',
    date: '2026-09-14',
    mealSlot: 'tarde',
  });

  const portions = await listPortions(db, '2026-09-13');
  assert.equal(portions.length, 2);
  assert.equal(portions[0].mealSlot, 'desayuno');

  // Spec 7.2: 450 ml of 1% milk plus six eggs is 55.2 g of protein.
  assert.ok(Math.abs(dailyTotals(portions).proteinG - (16.2 + 39)) < 1e-9);
});

test('a portion of nothing is refused', async () => {
  const { db } = seeded();
  await assert.rejects(
    () =>
      addFoodEntry(db, {
        foodId: 'milk-1',
        quantity: 0,
        unit: 'ml',
        date: '2026-09-13',
        mealSlot: 'desayuno',
      }),
    /not something that was eaten/,
  );
});

test('removing an entry takes it back out of the day', async () => {
  const { db } = seeded();
  const id = await addFoodEntry(db, {
    foodId: 'wendys-jbc',
    quantity: 5,
    unit: 'unidad',
    date: '2026-09-13',
    mealSlot: 'cena',
  });

  // Spec 2.2: five Jr. Bacon Cheeseburgers is 1,850 kcal in one sitting.
  assert.equal(dailyTotals(await listPortions(db, '2026-09-13')).kcal, 1850);

  await deleteFoodEntry(db, id);
  assert.equal((await listPortions(db, '2026-09-13')).length, 0);
});

test('every seeded food is stored per a unit he can actually log in', async () => {
  const { db } = seeded();
  const foods = await listFoods(db);

  assert.equal(foods.length, 10);
  for (const food of foods) {
    assert.ok(
      ['g', 'ml', 'huevo', 'unidad', 'vaso'].includes(food.base_unit),
      `${food.id} is stored per "${food.base_unit}", which is a label serving, not a logging unit`,
    );
  }
});

test('one egg is one egg, and five eggs are five', async () => {
  const { db } = seeded();
  const eggs = await getFood(db, 'eggs-large');

  // Spec 7.1 lists two eggs at 160 kcal and 13 g protein.
  assert.equal(eggs.base_unit, 'huevo');
  assert.equal(eggs.unit_kind, 'count');
  assert.equal(eggs.kcal, 80);
  assert.equal(eggs.protein_g, 6.5);

  await addFoodEntry(db, {
    foodId: 'eggs-large',
    quantity: 5,
    unit: 'huevo',
    date: '2026-09-13',
    mealSlot: 'desayuno',
  });

  const totals = dailyTotals(await listPortions(db, '2026-09-13'));
  assert.equal(totals.kcal, 400);
  assert.equal(totals.proteinG, 32.5);
});

test('milk is logged in millilitres, so 300 ml is 300', async () => {
  const { db } = seeded();
  await addFoodEntry(db, {
    foodId: 'milk-1',
    quantity: 300,
    unit: 'ml',
    date: '2026-09-13',
    mealSlot: 'desayuno',
  });

  // Spec 7.1: 250 ml is 100 kcal and 9 g protein.
  const totals = dailyTotals(await listPortions(db, '2026-09-13'));
  assert.ok(Math.abs(totals.kcal - 120) < 1e-9);
  assert.ok(Math.abs(totals.proteinG - 10.8) < 1e-9);
});

test('oats and pasta are logged in grams', async () => {
  const { db } = seeded();
  for (const [foodId, grams] of [
    ['oats-quaker', 80],
    ['catelli-pasta', 85],
  ] as const) {
    await addFoodEntry(db, {
      foodId,
      quantity: grams,
      unit: 'g',
      date: '2026-09-13',
      mealSlot: 'mediodía',
    });
  }

  // 80 g of oats is 300 kcal, 85 g of pasta is the 250 kcal serving in spec 7.1.
  const totals = dailyTotals(await listPortions(db, '2026-09-13'));
  assert.ok(Math.abs(totals.kcal - 550) < 1e-9);
  assert.ok(Math.abs(totals.proteinG - (10 + 17)) < 1e-9);
});

test('his breakfast comes out at the figures spec 7.2 states for protein', async () => {
  const { db } = seeded();
  for (const [foodId, quantity, unit] of [
    ['milk-1', 450, 'ml'],
    ['oats-quaker', 80, 'g'],
    ['eggs-large', 6, 'huevo'],
  ] as const) {
    await addFoodEntry(db, { foodId, quantity, unit, date: '2026-09-13', mealSlot: 'desayuno' });
  }

  const totals = dailyTotals(await listPortions(db, '2026-09-13'));
  // Spec 7.2 says about 65 g of protein, and that part checks out.
  assert.ok(Math.abs(totals.proteinG - 65.2) < 1e-9);
  // It also says about 710 kcal, which his own figures in spec 7.1 do not support:
  // 180 + 300 + 480. The catalog is user_measured and wins.
  assert.ok(Math.abs(totals.kcal - 960) < 1e-9);
});

test('a counted food reads as a count and a weighed one as a weight', () => {
  const eggs = food({ name: 'Huevo grande', base_unit: 'huevo', unit_kind: 'count' as const });
  const oats = food({ name: 'Avena', base_unit: 'g', unit_kind: 'mass' as const });

  assert.equal(unitLabel(eggs, 1), 'huevo');
  assert.equal(unitLabel(eggs, 6), 'huevos');
  assert.equal(unitLabel(oats, 80), 'g');
  assert.equal(portionLabel(eggs, 6), '6 × Huevo grande');
  assert.equal(portionLabel(oats, 80), '80 g · Avena');
});

test('a food from an older schema fails with something readable, not a crash', () => {
  for (const kind of ['count', 'mass', 'volume'] as const) {
    assert.ok(quickAmounts(kind).length > 0);
  }

  // What a row written before unit_kind existed looks like coming back.
  assert.throws(
    () => quickAmounts(undefined as unknown as UnitKind),
    /La base de datos es más vieja que la app/,
  );
});

function remaining(raw: DatabaseSync, batchId: string): number {
  return (
    raw
      .prepare('SELECT portions_remaining AS n FROM nutrition_batch WHERE id = ?;')
      .get(batchId) as {
      n: number;
    }
  ).n;
}

async function chickenBreast(db: SQLiteDatabase): Promise<string> {
  return addFoodFromLabel(db, {
    name: 'Pechuga de pollo',
    store: 'Food Basics',
    servingG: 100,
    kcal: 165,
    proteinG: 31,
    fatG: 3.6,
    carbsG: 0,
  });
}

test('a food from a package label is stored per gram and marked as label', async () => {
  const { db } = seeded();
  const food = await getFood(db, await chickenBreast(db));

  assert.equal(food.base_unit, 'g');
  assert.equal(food.unit_kind, 'mass');
  assert.equal(food.source, 'label');
  assert.ok(Math.abs(food.kcal - 1.65) < 1e-9);
  assert.ok(Math.abs(food.protein_g - 0.31) < 1e-9);
});

test('a label without carbohydrate keeps it blank instead of zero', async () => {
  const { db } = seeded();
  const id = await addFoodFromLabel(db, {
    name: 'Carne molida magra',
    servingG: 113,
    kcal: 240,
    proteinG: 22,
    fatG: 17,
    carbsG: null,
  });
  assert.equal((await getFood(db, id)).carbs_g, null);
});

test('a nonsense label is refused', async () => {
  const { db } = seeded();
  const base = { name: 'x', servingG: 100, kcal: 100, proteinG: 10, fatG: 1, carbsG: 0 };
  await assert.rejects(() => addFoodFromLabel(db, { ...base, name: '  ' }), /needs a name/);
  await assert.rejects(() => addFoodFromLabel(db, { ...base, servingG: 0 }), /not a serving/);
  await assert.rejects(() => addFoodFromLabel(db, { ...base, proteinG: -1 }), /not a figure/);
});

test('one tap eats one portion: its share of the raw weight, and one less left', async () => {
  const { db, raw } = seeded();
  const food = await chickenBreast(db);
  // Spec 7.3: the whole 1.6 kg pack, divided by eye into 8 containers.
  const batch = await createBatch(db, {
    foodId: food,
    rawWeightG: 1600,
    portionsCount: 8,
    cookedDate: '2026-09-13',
    fatDrained: false,
  });

  await consumeBatchPortion(db, batch, '2026-09-14', 'mediodía');

  const portions = await listPortions(db, '2026-09-14');
  assert.equal(portions.length, 1);
  assert.equal(portions[0].quantity, 200);
  // 1600 g × 0.31 g/g ÷ 8 portions
  assert.ok(Math.abs(dailyTotals(portions).proteinG - 62) < 1e-9);
  assert.equal(remaining(raw, batch), 7);
});

test('an empty batch refuses another portion instead of going negative', async () => {
  const { db, raw } = seeded();
  const batch = await createBatch(db, {
    foodId: await chickenBreast(db),
    rawWeightG: 600,
    portionsCount: 1,
    cookedDate: '2026-09-13',
    fatDrained: false,
  });

  await consumeBatchPortion(db, batch, '2026-09-14', 'cena');
  await assert.rejects(
    () => consumeBatchPortion(db, batch, '2026-09-14', 'cena'),
    /no portions left/,
  );
  assert.equal(remaining(raw, batch), 0);
  assert.equal((await listPortions(db, '2026-09-14')).length, 1);
});

test('removing a portion eaten from a batch hands it back', async () => {
  const { db, raw } = seeded();
  const batch = await createBatch(db, {
    foodId: await chickenBreast(db),
    rawWeightG: 1600,
    portionsCount: 8,
    cookedDate: '2026-09-13',
    fatDrained: false,
  });

  const entry = await consumeBatchPortion(db, batch, '2026-09-14', 'mediodía');
  assert.equal(remaining(raw, batch), 7);

  await deleteFoodEntry(db, entry);
  assert.equal(remaining(raw, batch), 8);
  assert.equal((await listPortions(db, '2026-09-14')).length, 0);
});

test('a food with no weight per unit cannot become a batch', async () => {
  const { db } = seeded();
  const base = { rawWeightG: 500, portionsCount: 4, cookedDate: '2026-09-13', fatDrained: false };
  await assert.rejects(
    () => createBatch(db, { ...base, foodId: 'wendys-jbc' }),
    /cannot be batched/,
  );
  await assert.rejects(
    () => createBatch(db, { ...base, foodId: 'oats-quaker', portionsCount: 0 }),
    /not a way to divide/,
  );
});

test('dairy is counted and shown, never subtracted', async () => {
  const { db } = seeded();
  await addFoodEntry(db, {
    date: '2026-09-15',
    foodId: 'milk-1',
    quantity: 450,
    unit: 'ml',
    mealSlot: 'desayuno',
  });
  await addFoodEntry(db, {
    date: '2026-09-15',
    foodId: 'eggs-large',
    quantity: 6,
    unit: 'huevo',
    mealSlot: 'desayuno',
  });

  const totals = dailyTotals(await listPortions(db, '2026-09-15'));

  assert.equal(totals.dairy.portions, 1);
  assert.equal(totals.dairy.millilitresG, 450);
  // The eggs are still in the day's protein, they are simply not dairy.
  assert.ok(totals.proteinG > totals.dairy.proteinG);
});
