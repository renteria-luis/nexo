// Que alimento sale primero cuando va a anotar algo.
//
// Anotar falla por friccion, no por olvido: lo que decide que siga anotando es que
// la comida de siempre este arriba y con su cantidad puesta. El orden sale de lo que
// ya anoto y no de una lista fija, asi que se acomoda solo segun vaya cambiando lo
// que come.
//
// El "a esta hora" se cuenta por espacio de comida y no por la hora del reloj: el
// espacio ya viene anotado en cada entrada, mientras que sacar la hora de un sello de
// tiempo dentro de SQLite pediria una zona horaria que la base no guarda.

import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays, type IsoDate } from '../core/dates.ts';

export type FoodEntryTrace = {
  foodId: string;
  mealSlot: string;
  quantity: number;
  unit: string;
  date: IsoDate;
  timestamp: number;
};

export type LastMeal = {
  date: IsoDate;
  entries: { foodId: string; quantity: number; unit: string }[];
};

export type FoodHistory = {
  /** Los mas anotados en cada espacio de comida, del que mas al que menos. */
  usualBySlot: Map<string, string[]>;
  /** Lo ultimo que anoto, sin repetir alimento. */
  recent: string[];
  /** Cuanto puso la ultima vez, para no volver a teclearlo. */
  lastQuantity: Map<string, number>;
  /** La ultima vez que lleno cada espacio de comida, para repetirla entera. */
  lastMealBySlot: Map<string, LastMeal>;
};

/** Tres meses: suficiente para que una comida de temporada no mande para siempre. */
export const PICKER_HISTORY_DAYS = 90;

export function summarizeFoodHistory(
  entries: readonly FoodEntryTrace[],
  /** Desde este dia en adelante no cuenta para repetir: hoy no se repite a si mismo. */
  before?: IsoDate,
): FoodHistory {
  const counts = new Map<string, Map<string, number>>();
  const lastSeen = new Map<string, number>();
  const lastQuantity = new Map<string, number>();
  const lastMealBySlot = new Map<string, LastMeal>();

  for (const entry of entries) {
    if (before === undefined || entry.date < before) {
      const meal = lastMealBySlot.get(entry.mealSlot);
      if (meal === undefined || entry.date > meal.date) {
        lastMealBySlot.set(entry.mealSlot, { date: entry.date, entries: [] });
      }
    }

    const bySlot = counts.get(entry.mealSlot) ?? new Map<string, number>();
    bySlot.set(entry.foodId, (bySlot.get(entry.foodId) ?? 0) + 1);
    counts.set(entry.mealSlot, bySlot);

    const seen = lastSeen.get(entry.foodId);
    if (seen === undefined || entry.timestamp > seen) {
      lastSeen.set(entry.foodId, entry.timestamp);
      lastQuantity.set(entry.foodId, entry.quantity);
    }
  }

  const newest = (foodId: string) => lastSeen.get(foodId) ?? 0;

  const usualBySlot = new Map<string, string[]>();
  for (const [slot, bySlot] of counts) {
    const ordered = [...bySlot.entries()]
      // Empatados en veces, manda el mas reciente: es el que sigue comiendo.
      .sort((a, b) => b[1] - a[1] || newest(b[0]) - newest(a[0]))
      .map(([foodId]) => foodId);
    usualBySlot.set(slot, ordered);
  }

  // Las porciones de esa ultima comida, ya sabiendo de que dia es cada espacio.
  for (const entry of entries) {
    const meal = lastMealBySlot.get(entry.mealSlot);
    if (meal === undefined || entry.date !== meal.date) continue;
    meal.entries.push({ foodId: entry.foodId, quantity: entry.quantity, unit: entry.unit });
  }

  const recent = [...lastSeen.keys()].sort((a, b) => newest(b) - newest(a));

  return { usualBySlot, recent, lastQuantity, lastMealBySlot };
}

export async function loadFoodHistory(
  db: SQLiteDatabase,
  today: IsoDate,
  days = PICKER_HISTORY_DAYS,
): Promise<FoodHistory> {
  const rows = await db.getAllAsync<FoodEntryTrace>(
    `SELECT food_id AS foodId, meal_slot AS mealSlot, quantity, unit, date, timestamp
       FROM nutrition_food_entry
      WHERE date BETWEEN ? AND ?
   ORDER BY timestamp;`,
    [addDays(today, -(days - 1)), today],
  );
  return summarizeFoodHistory(rows, today);
}

const ACCENTS: Record<string, string> = {
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  ü: 'u',
  ñ: 'n',
};

/**
 * Buscar sin que las tildes estorben: escribe "platano" y sale "plátano".
 *
 * A mano y no con `normalize`, que el motor de JavaScript del telefono no garantiza.
 */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[áéíóúüñ]/g, (letter) => ACCENTS[letter] ?? letter)
    .trim();
}

export function matchesSearch(haystack: readonly (string | null)[], search: string): boolean {
  const needle = fold(search);
  if (needle === '') return true;
  return needle
    .split(/\s+/)
    .every((word) => haystack.some((part) => part !== null && fold(part).includes(word)));
}
