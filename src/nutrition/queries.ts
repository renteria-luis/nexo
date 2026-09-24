import type { SQLiteDatabase } from 'expo-sqlite';

import type { DateRange, IsoDate } from '../core/dates.ts';
import type { NutritionBatchRow, NutritionContainerRow, NutritionFoodRow } from '../db/types.ts';

import type { LoggedPortion } from './totals.ts';
import { MEAL_SLOTS } from './units.ts';

/**
 * Del desayuno a la cena y no en el orden en que lo escribio: si anota la cena a
 * mediodia y el desayuno despues, el dia se lee al reves de como paso.
 */
function byMealTime(a: LoggedPortion, b: LoggedPortion): number {
  const rank = (slot: string) => {
    const index = MEAL_SLOTS.indexOf(slot);
    // Lo que no es una comida del dia va al final, no al principio.
    return index === -1 ? MEAL_SLOTS.length : index;
  };
  return rank(a.mealSlot) - rank(b.mealSlot);
}

type PortionRow = NutritionFoodRow & {
  entry_id: string;
  entry_quantity: number;
  entry_meal_slot: string;
};

/** Everything eaten on a local calendar day, joined to the food it came from. */
export async function listPortions(db: SQLiteDatabase, date: IsoDate): Promise<LoggedPortion[]> {
  const rows = await db.getAllAsync<PortionRow>(
    `SELECT e.id AS entry_id, e.quantity AS entry_quantity, e.meal_slot AS entry_meal_slot, f.*
       FROM nutrition_food_entry e
       JOIN nutrition_food f ON f.id = e.food_id
      WHERE e.date = ?
   ORDER BY e.timestamp;`,
    [date],
  );

  return rows
    .map(({ entry_id, entry_quantity, entry_meal_slot, ...food }) => ({
      entryId: entry_id,
      quantity: entry_quantity,
      mealSlot: entry_meal_slot,
      food: food as NutritionFoodRow,
    }))
    .sort(byMealTime);
}

/**
 * Lo mismo pero para un rango, en una sola consulta. La pantalla de registros mira
 * noventa dias de golpe y una consulta por dia son noventa idas a la base.
 */
export async function listPortionsBetween(
  db: SQLiteDatabase,
  range: DateRange,
): Promise<Map<IsoDate, LoggedPortion[]>> {
  const rows = await db.getAllAsync<PortionRow & { entry_date: IsoDate }>(
    `SELECT e.id AS entry_id, e.quantity AS entry_quantity, e.meal_slot AS entry_meal_slot,
            e.date AS entry_date, f.*
       FROM nutrition_food_entry e
       JOIN nutrition_food f ON f.id = e.food_id
      WHERE e.date BETWEEN ? AND ?
   ORDER BY e.date, e.timestamp;`,
    [range.from, range.to],
  );

  const byDate = new Map<IsoDate, LoggedPortion[]>();
  for (const { entry_id, entry_quantity, entry_meal_slot, entry_date, ...food } of rows) {
    const portion = {
      entryId: entry_id,
      quantity: entry_quantity,
      mealSlot: entry_meal_slot,
      food: food as NutritionFoodRow,
    };
    const existing = byDate.get(entry_date);
    if (existing) existing.push(portion);
    else byDate.set(entry_date, [portion]);
  }
  for (const portions of byDate.values()) portions.sort(byMealTime);
  return byDate;
}

/** Batches with portions left, oldest first, which is the order they spoil in. */
export async function listOpenBatches(db: SQLiteDatabase): Promise<NutritionBatchRow[]> {
  return db.getAllAsync<NutritionBatchRow>(
    `SELECT * FROM nutrition_batch
      WHERE portions_remaining > 0
   ORDER BY cooked_date;`,
  );
}

export async function getFood(db: SQLiteDatabase, foodId: string): Promise<NutritionFoodRow> {
  const food = await db.getFirstAsync<NutritionFoodRow>(
    'SELECT * FROM nutrition_food WHERE id = ?;',
    [foodId],
  );
  if (!food) throw new Error(`no food with id ${foodId}`);
  return food;
}

/** Spec 1.7: one tap is one container, and the 710 ml bottle is most of them. */
export async function listContainers(db: SQLiteDatabase): Promise<NutritionContainerRow[]> {
  return db.getAllAsync<NutritionContainerRow>(
    'SELECT * FROM nutrition_container ORDER BY volume_ml DESC;',
  );
}

export async function listFoods(db: SQLiteDatabase): Promise<NutritionFoodRow[]> {
  return db.getAllAsync<NutritionFoodRow>('SELECT * FROM nutrition_food ORDER BY name;');
}

export type NewFoodEntry = {
  foodId: string;
  /** How many base_units of the food. */
  quantity: number;
  unit: string;
  date: IsoDate;
  mealSlot: string;
  /** Set when the portion came out of a cooked batch (spec 7.3). */
  batchId?: string | null;
};

export async function addFoodEntry(db: SQLiteDatabase, entry: NewFoodEntry): Promise<string> {
  if (!(entry.quantity > 0)) {
    throw new Error(`a portion of ${entry.quantity} is not something that was eaten`);
  }

  const timestamp = Date.now();
  const id = `entry-${timestamp}-${Math.floor(Math.random() * 1e6)}`;

  await db.runAsync(
    `INSERT INTO nutrition_food_entry
       (id, food_id, quantity, unit, timestamp, date, meal_slot, batch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      entry.foodId,
      entry.quantity,
      entry.unit,
      timestamp,
      entry.date,
      entry.mealSlot,
      entry.batchId ?? null,
    ],
  );

  return id;
}

/**
 * Removing a portion that came out of a batch hands the portion back, so a mistaken
 * tap does not quietly shrink the batch. Capped at the batch size.
 */
export async function deleteFoodEntry(db: SQLiteDatabase, entryId: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    const entry = await db.getFirstAsync<{ batch_id: string | null }>(
      'SELECT batch_id FROM nutrition_food_entry WHERE id = ?;',
      [entryId],
    );
    await db.runAsync('DELETE FROM nutrition_food_entry WHERE id = ?;', [entryId]);
    if (entry?.batch_id) {
      await db.runAsync(
        `UPDATE nutrition_batch SET portions_remaining = portions_remaining + 1
          WHERE id = ? AND portions_remaining < portions_count;`,
        [entry.batch_id],
      );
    }
  });
}

export type LabelFood = {
  name: string;
  store?: string | null;
  /** The weight the label's figures are quoted for, usually 100 g. */
  servingG: number;
  kcal: number;
  proteinG: number;
  fatG: number;
  /** Null when the label he is reading does not give it. */
  carbsG: number | null;
};

/**
 * Spec 7.3 runs on label protein per gram, and the foods it is about (chicken breast,
 * ground beef, rice) are not in the owner-verified catalogue. This stores a food as
 * the package states it, per gram, marked source = 'label' so it never passes for a
 * measured value.
 */
export async function addFoodFromLabel(db: SQLiteDatabase, food: LabelFood): Promise<string> {
  const name = food.name.trim();
  if (name === '') throw new Error('a food needs a name');
  if (!(food.servingG > 0))
    throw new Error(`a label serving of ${food.servingG} g is not a serving`);
  for (const [label, value] of [
    ['kcal', food.kcal],
    ['protein', food.proteinG],
    ['fat', food.fatG],
  ] as const) {
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`${label} of ${value} is not a figure`);
  }
  if (food.carbsG !== null && (!Number.isFinite(food.carbsG) || food.carbsG < 0)) {
    throw new Error(`carbohydrate of ${food.carbsG} is not a figure`);
  }

  const id = `food-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const per = food.servingG;

  await db.runAsync(
    `INSERT INTO nutrition_food
       (id, name, brand, store, base_unit, unit_kind, base_unit_g, kcal, protein_g, carbs_g,
        sugar_g, fat_g, fibre_g, sodium_mg, source, price_cad_cents, package_size,
        glycemic_index, is_dairy)
     VALUES (?, ?, NULL, ?, 'g', 'mass', 1, ?, ?, ?, NULL, ?, NULL, NULL, 'label',
             NULL, NULL, NULL, 0);`,
    [
      id,
      name,
      food.store ?? null,
      food.kcal / per,
      food.proteinG / per,
      food.carbsG === null ? null : food.carbsG / per,
      food.fatG / per,
    ],
  );

  return id;
}

export type NewBatch = {
  foodId: string;
  rawWeightG: number;
  portionsCount: number;
  cookedDate: IsoDate;
  fatDrained: boolean;
};

/** Spec 7.3: one weighing per batch. Refuses a food the per-gram arithmetic cannot run on. */
export async function createBatch(db: SQLiteDatabase, batch: NewBatch): Promise<string> {
  if (!(batch.rawWeightG > 0)) throw new Error(`a batch of ${batch.rawWeightG} g weighs nothing`);
  if (!Number.isInteger(batch.portionsCount) || batch.portionsCount < 1) {
    throw new Error(`${batch.portionsCount} portions is not a way to divide a batch`);
  }

  const food = await getFood(db, batch.foodId);
  if (food.base_unit_g === null) {
    throw new Error(`${food.name} has no weight per unit, so it cannot be batched`);
  }

  const id = `batch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await db.runAsync(
    `INSERT INTO nutrition_batch
       (id, food_id, raw_weight_g, portions_count, cooked_date, portions_remaining, fat_drained)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      batch.foodId,
      batch.rawWeightG,
      batch.portionsCount,
      batch.cookedDate,
      batch.portionsCount,
      batch.fatDrained ? 1 : 0,
    ],
  );
  return id;
}

/**
 * One tap is one portion (spec 7.3). The entry is logged as a portion's share of the
 * raw weight, which is exactly the quantity the protein-per-portion arithmetic uses,
 * and the remaining count drops in the same transaction. An empty batch refuses
 * instead of going negative.
 */
export async function consumeBatchPortion(
  db: SQLiteDatabase,
  batchId: string,
  date: IsoDate,
  mealSlot: string,
): Promise<string> {
  let entryId = '';
  await db.withTransactionAsync(async () => {
    const batch = await db.getFirstAsync<NutritionBatchRow>(
      'SELECT * FROM nutrition_batch WHERE id = ?;',
      [batchId],
    );
    if (!batch) throw new Error(`no batch with id ${batchId}`);
    if (batch.portions_remaining <= 0) throw new Error(`batch ${batchId} has no portions left`);

    const food = await getFood(db, batch.food_id);
    if (food.base_unit_g === null) {
      throw new Error(`${food.name} has no weight per unit, so a portion cannot be sized`);
    }

    entryId = await addFoodEntry(db, {
      foodId: food.id,
      quantity: batch.raw_weight_g / food.base_unit_g / batch.portions_count,
      unit: food.base_unit,
      date,
      mealSlot,
      batchId,
    });
    await db.runAsync(
      'UPDATE nutrition_batch SET portions_remaining = portions_remaining - 1 WHERE id = ?;',
      [batchId],
    );
  });
  return entryId;
}
