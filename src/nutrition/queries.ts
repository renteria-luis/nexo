import type { SQLiteDatabase } from 'expo-sqlite';

import type { IsoDate } from '../core/dates.ts';
import type { NutritionBatchRow, NutritionContainerRow, NutritionFoodRow } from '../db/types.ts';

import type { LoggedPortion } from './totals.ts';

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

  return rows.map(({ entry_id, entry_quantity, entry_meal_slot, ...food }) => ({
    entryId: entry_id,
    quantity: entry_quantity,
    mealSlot: entry_meal_slot,
    food: food as NutritionFoodRow,
  }));
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

export async function deleteFoodEntry(db: SQLiteDatabase, entryId: string): Promise<void> {
  await db.runAsync('DELETE FROM nutrition_food_entry WHERE id = ?;', [entryId]);
}
