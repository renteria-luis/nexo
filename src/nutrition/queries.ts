import type { SQLiteDatabase } from 'expo-sqlite';

import type { DateRange, IsoDate } from '../core/dates.ts';
import type {
  NutritionBatchRow,
  NutritionContainerRow,
  NutritionFoodRow,
  UnitKind,
} from '../db/types.ts';

import type { LoggedPortion } from './totals.ts';
import { MEAL_SLOTS, parseQuickAmounts } from './units.ts';

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

export async function listFoods(
  db: SQLiteDatabase,
  { archived = false }: { archived?: boolean } = {},
): Promise<NutritionFoodRow[]> {
  return db.getAllAsync<NutritionFoodRow>(
    'SELECT * FROM nutrition_food WHERE archived = ? ORDER BY name;',
    [archived ? 1 : 0],
  );
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

export type NewFood = {
  name: string;
  store?: string | null;
  /** Lo que describe la etiqueta: 100 gramos, 1 unidad, 250 ml. */
  amount: number;
  /** La unidad en la que va a anotarlo despues: 'g', 'ml', 'unidad', 'huevo'. */
  unit: string;
  kind: UnitKind;
  /** Lo que pesa una unidad contable, cuando la etiqueta lo dice. Null si no. */
  gramsPerUnit?: number | null;
  kcal: number;
  proteinG: number;
  fatG: number;
  /** Null cuando la etiqueta no lo trae: spec 16.3 regla 5 prohibe inventarlo. */
  carbsG: number | null;
  sugarG?: number | null;
  sodiumMg?: number | null;
  /** Como lo va a buscar: "egg, costco", separadas por coma. */
  keywords?: string | null;
  /** Las cantidades de boton, separadas por coma. Vacio deja las de siempre. */
  quickAmounts?: string | null;
};

/** Sin espacios de mas y sin comas vacias, que es lo que se teclea de verdad. */
function cleanKeywords(keywords: string | null | undefined): string | null {
  if (keywords === null || keywords === undefined) return null;
  const parts = keywords
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '');
  return parts.length === 0 ? null : parts.join(', ');
}

/** Se guardan ya limpias y en orden, que es como se van a pintar. */
function cleanQuickAmounts(amounts: string | null | undefined): string | null {
  const parsed = parseQuickAmounts(amounts ?? null);
  return parsed.length === 0 ? null : parsed.join(', ');
}

function labelFigure(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} of ${value} is not a figure`);
}

function optionalFigure(label: string, value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  labelFigure(label, value);
  return value;
}

/**
 * Un alimento como lo dice su envase, marcado source = 'label' para que nunca pase
 * por un valor medido por el (spec 7.1).
 *
 * Los macros se guardan por unidad base, que es la unidad en la que va a anotarlo:
 * un wrap de Starbucks se anota por unidad y el arroz por gramo, y la etiqueta de
 * cada uno habla de una cantidad distinta. Por eso divide entre `amount`.
 */
export async function addFood(db: SQLiteDatabase, food: NewFood): Promise<string> {
  const name = food.name.trim();
  if (name === '') throw new Error('a food needs a name');
  if (!(food.amount > 0)) throw new Error(`a label amount of ${food.amount} is not an amount`);
  if (food.unit.trim() === '') throw new Error('a food needs the unit he logs it in');

  labelFigure('kcal', food.kcal);
  labelFigure('protein', food.proteinG);
  labelFigure('fat', food.fatG);
  const carbsG = optionalFigure('carbohydrate', food.carbsG);
  const sugarG = optionalFigure('sugar', food.sugarG);
  const sodiumMg = optionalFigure('sodium', food.sodiumMg);

  const id = `food-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const per = food.amount;
  // Un gramo pesa un gramo; una unidad pesa lo que diga la etiqueta, o nada.
  const baseUnitG =
    food.kind === 'mass' ? 1 : food.kind === 'count' ? (food.gramsPerUnit ?? null) : null;

  await db.runAsync(
    `INSERT INTO nutrition_food
       (id, name, brand, store, base_unit, unit_kind, base_unit_g, kcal, protein_g, carbs_g,
        sugar_g, fat_g, fibre_g, sodium_mg, source, price_cad_cents, package_size,
        glycemic_index, is_dairy, keywords, quick_amounts)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'label',
             NULL, NULL, NULL, 0, ?, ?);`,
    [
      id,
      name,
      food.store ?? null,
      food.unit.trim(),
      food.kind,
      baseUnitG,
      food.kcal / per,
      food.proteinG / per,
      carbsG === null ? null : carbsG / per,
      sugarG === null ? null : sugarG / per,
      food.fatG / per,
      sodiumMg === null ? null : sodiumMg / per,
      cleanKeywords(food.keywords),
      cleanQuickAmounts(food.quickAmounts),
    ],
  );

  return id;
}

/**
 * Spec 7.3 runs on label protein per gram, and the foods it is about (chicken breast,
 * ground beef, rice) are not in the owner-verified catalogue. La tanda siempre habla
 * de gramos, asi que esto es addFood con la unidad ya resuelta.
 */
export async function addFoodFromLabel(db: SQLiteDatabase, food: LabelFood): Promise<string> {
  if (!(food.servingG > 0))
    throw new Error(`a label serving of ${food.servingG} g is not a serving`);

  return addFood(db, {
    name: food.name,
    store: food.store,
    amount: food.servingG,
    unit: 'g',
    kind: 'mass',
    kcal: food.kcal,
    proteinG: food.proteinG,
    fatG: food.fatG,
    carbsG: food.carbsG,
  });
}

export type FoodEdit = {
  name: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  keywords: string | null;
  quickAmounts: string | null;
};

/** Lo que describen los macros de un alimento: una unidad, o cien gramos o mililitros. */
export function referenceAmount(food: NutritionFoodRow): number {
  return food.unit_kind === 'count' ? 1 : 100;
}

/**
 * Corrige lo que dice un alimento.
 *
 * La unidad no se toca: los macros se guardan por unidad base y todo lo que ya comio
 * esta anotado en esa unidad, asi que cambiarla reescribiria en silencio cada porcion
 * del pasado. Lo demas si, y como los totales se calculan leyendo esta fila, el
 * cambio alcanza a todos los dias de golpe. Las notas guardadas de esos dias son lo
 * unico que hay que rehacer aparte.
 */
export async function updateFood(db: SQLiteDatabase, id: string, food: FoodEdit): Promise<void> {
  const current = await getFood(db, id);
  if (!current) throw new Error(`there is no food called ${id}`);

  const name = food.name.trim();
  if (name === '') throw new Error('a food needs a name');
  labelFigure('kcal', food.kcal);
  labelFigure('protein', food.proteinG);
  labelFigure('fat', food.fatG);
  const carbsG = optionalFigure('carbohydrate', food.carbsG);
  const sugarG = optionalFigure('sugar', food.sugarG);
  const sodiumMg = optionalFigure('sodium', food.sodiumMg);

  const per = referenceAmount(current);

  await db.runAsync(
    `UPDATE nutrition_food
        SET name = ?, kcal = ?, protein_g = ?, carbs_g = ?, sugar_g = ?, fat_g = ?,
            sodium_mg = ?, keywords = ?, quick_amounts = ?
      WHERE id = ?;`,
    [
      name,
      food.kcal / per,
      food.proteinG / per,
      carbsG === null ? null : carbsG / per,
      sugarG === null ? null : sugarG / per,
      food.fatG / per,
      sodiumMg === null ? null : sodiumMg / per,
      cleanKeywords(food.keywords),
      cleanQuickAmounts(food.quickAmounts),
      id,
    ],
  );
}

export type FoodRemoval = 'borrado' | 'archivado';

/**
 * Saca un alimento de las listas.
 *
 * Si nunca lo comio se borra de verdad: es un error de tecleo y no hay nada que
 * proteger. Si tiene porciones o tandas anotadas se archiva, porque borrarlo
 * reescribiria lo que dicen esos dias, y un dia que ya paso no se toca. Archivado
 * desaparece de donde elige y de donde corrige, y se puede recuperar.
 */
export async function removeFood(db: SQLiteDatabase, id: string): Promise<FoodRemoval> {
  const used = await db.getFirstAsync<{ count: number }>(
    `SELECT (SELECT count(*) FROM nutrition_food_entry WHERE food_id = ?)
          + (SELECT count(*) FROM nutrition_batch WHERE food_id = ?) AS count;`,
    [id, id],
  );

  if ((used?.count ?? 0) > 0) {
    await db.runAsync('UPDATE nutrition_food SET archived = 1 WHERE id = ?;', [id]);
    return 'archivado';
  }

  await db.runAsync('DELETE FROM nutrition_food WHERE id = ?;', [id]);
  return 'borrado';
}

export async function restoreFood(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('UPDATE nutrition_food SET archived = 0 WHERE id = ?;', [id]);
}

/** Los dias en los que comio ese alimento, que son los que hay que volver a puntuar. */
export async function datesWithFood(db: SQLiteDatabase, foodId: string): Promise<IsoDate[]> {
  const rows = await db.getAllAsync<{ date: IsoDate }>(
    'SELECT DISTINCT date FROM nutrition_food_entry WHERE food_id = ? ORDER BY date;',
    [foodId],
  );
  return rows.map((row) => row.date);
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
