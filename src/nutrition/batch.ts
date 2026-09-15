// Spec 7.3, the batch pattern. Cook the whole pack, divide it by eye, record the
// raw weight and how many containers it went into. Across the week the total is
// exactly right and the per-portion variance stops mattering, which is what makes
// one weighing per batch enough and none per meal.

import { daysBetween, type IsoDate } from '../core/dates.ts';
import type { NutritionBatchRow, NutritionFoodRow } from '../db/types.ts';

export type PortionMacros = {
  proteinG: number;
  /** Exact when nothing was drained. */
  kcal: number | null;
  /**
   * Spec 7.3: draining removes fat, so the label calories no longer apply. The
   * bounds are real rather than guessed: the top is the label, the bottom is what
   * is left if every gram of fat drained away.
   */
  kcalRange: { from: number; to: number } | null;
  fatDrained: boolean;
};

function perGram(food: NutritionFoodRow, nutrient: 'protein_g' | 'kcal' | 'carbs_g' | 'fat_g') {
  if (food.base_unit_g === null) {
    throw new Error(
      `food ${food.id} has no weight for its base unit, so per gram figures cannot be derived`,
    );
  }
  const value = food[nutrient];
  if (value === null) return null;
  return value / food.base_unit_g;
}

/**
 * Spec 7.3. Protein is the number that survives draining and inconsistent grading,
 * so it is the one the app tracks and the one that is always exact.
 */
export function portionMacros(batch: NutritionBatchRow, food: NutritionFoodRow): PortionMacros {
  if (food.id !== batch.food_id) {
    throw new Error(`batch ${batch.id} is for food ${batch.food_id}, not ${food.id}`);
  }

  const proteinPerG = perGram(food, 'protein_g');
  if (proteinPerG === null) throw new Error(`food ${food.id} has no protein figure`);

  const proteinG = (batch.raw_weight_g * proteinPerG) / batch.portions_count;

  const kcalPerG = perGram(food, 'kcal');
  const carbsPerG = perGram(food, 'carbs_g');
  const fatPerG = perGram(food, 'fat_g');

  if (kcalPerG === null) {
    return { proteinG, kcal: null, kcalRange: null, fatDrained: batch.fat_drained === 1 };
  }

  const labelKcal = (batch.raw_weight_g * kcalPerG) / batch.portions_count;

  if (batch.fat_drained === 0) {
    return { proteinG, kcal: labelKcal, kcalRange: null, fatDrained: false };
  }

  const fatlessKcal =
    carbsPerG === null || fatPerG === null
      ? null
      : proteinG * 4 + ((batch.raw_weight_g * carbsPerG) / batch.portions_count) * 4;

  return {
    proteinG,
    kcal: null,
    kcalRange: fatlessKcal === null ? null : { from: fatlessKcal, to: labelKcal },
    fatDrained: true,
  };
}

/** Spec 7.3: a batch starts warning once it is this old and still has portions left. */
export const SPOILAGE_WARNING_DAYS = 3;

export type SpoilageWarning = {
  batchId: string;
  portionsRemaining: number;
  ageDays: number;
};

export function spoilageWarning(batch: NutritionBatchRow, onDate: IsoDate): SpoilageWarning | null {
  if (batch.portions_remaining <= 0) return null;

  const ageDays = daysBetween(batch.cooked_date, onDate);
  if (ageDays < SPOILAGE_WARNING_DAYS) return null;

  return { batchId: batch.id, portionsRemaining: batch.portions_remaining, ageDays };
}
