// How a food's unit behaves when he enters and reads an amount. Nutrition domain,
// not layout, which is why it lives here and can be tested.

import type { NutritionFoodRow, UnitKind } from '../db/types.ts';

export function roundAmount(value: number): string {
  return value % 1 === 0 ? String(value) : value.toFixed(1);
}

/**
 * Amounts he reaches for most often, so a portion is one tap and not arithmetic.
 *
 * A switch rather than a lookup table: a food whose unit_kind is missing can only
 * come from a database older than this code, and that has to say so instead of
 * crashing on an undefined list.
 */
export function quickAmounts(kind: UnitKind): number[] {
  switch (kind) {
    case 'count':
      return [1, 2, 3, 4, 5, 6];
    case 'mass':
      return [20, 40, 80, 100, 150, 200];
    case 'volume':
      return [200, 250, 300, 450, 500, 710];
    default:
      throw new Error(
        `el alimento no dice si se mide en peso, volumen o unidades (unit_kind = ${String(kind)}). ` +
          'La base de datos es más vieja que la app: bórrala desde Ajustes.',
      );
  }
}

export function unitLabel(food: NutritionFoodRow, quantity: number): string {
  if (food.unit_kind !== 'count') return food.base_unit;
  return quantity === 1 ? food.base_unit : `${food.base_unit}s`;
}

/**
 * A counted food already says what it is in its name, so "6 × Huevo grande" rather
 * than "6 huevos de Huevo grande". A weight or a volume needs its unit spelled out.
 */
export function portionLabel(food: NutritionFoodRow, quantity: number): string {
  if (food.unit_kind === 'count') return `${roundAmount(quantity)} × ${food.name}`;
  return `${roundAmount(quantity)} ${food.base_unit} · ${food.name}`;
}

/** Spec 1.4: the five moments he actually eats at. */
export const MEAL_SLOTS = ['desayuno', 'media mañana', 'mediodía', 'tarde', 'cena'];

/**
 * Spec 1.4. El espacio de comida en el que cae una hora, para abrir el registro en
 * el que esta en vez del primero de la lista. Sus horas son 08:00, 10:40, 11:50,
 * 14:40 y 19:30, asi que los cortes van a mitad de camino entre una y la siguiente.
 */
export function mealSlotAtHour(hour: number, minute = 0): string {
  const time = hour + minute / 60;
  if (time < 9.3) return MEAL_SLOTS[0];
  if (time < 11.25) return MEAL_SLOTS[1];
  if (time < 13.25) return MEAL_SLOTS[2];
  if (time < 17) return MEAL_SLOTS[3];
  return MEAL_SLOTS[4];
}
