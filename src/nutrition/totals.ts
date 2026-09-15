// Daily nutrition totals, spec 7 and 3.3.
//
// The catalog has real gaps: spec 7.1 leaves the carbohydrate cell blank for oats
// and the Jr. Bacon Cheeseburger, and no seeded food has a glycemic index yet.
// Spec 16.3 rule 5 forbids filling a gap in, so a missing figure is reported
// alongside the total rather than counted as zero. A total with gaps is a floor,
// not a fact, and the screen has to be able to say so.

import type { NutritionFoodRow } from '../db/types.ts';

export type LoggedPortion = {
  entryId: string;
  /** How many base_units of the food were eaten. */
  quantity: number;
  mealSlot: string;
  food: NutritionFoodRow;
};

export type MissingFigure = {
  nutrient: string;
  foodId: string;
  foodName: string;
};

export type NutritionTotals = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  sugarG: number;
  fatG: number;
  fibreG: number;
  sodiumMg: number;
  /** Spec 7.5. Null until at least one eaten food carries a glycemic index. */
  glycemicLoad: number | null;
  /**
   * Spec 7.5: dairy is shown and never subtracted. His breakfast is 65 g of protein
   * and milk is a third of it, so the number is here to be looked at, not acted on.
   * Millilitres only counts the dairy he measures in millilitres.
   */
  dairy: { portions: number; millilitresG: number; proteinG: number };
  /** Spec 7.1 and 3.3: flagged, not scored. */
  sodiumOverLimit: boolean;
  /** Every nutrient the catalog could not supply for something eaten today. */
  missing: MissingFigure[];
};

/** Spec 3.3, displayed with a flag rather than scored. */
export const SODIUM_FLAG_MG = 2300;

function add(
  portion: LoggedPortion,
  nutrient: keyof NutritionFoodRow,
  label: string,
  missing: MissingFigure[],
): number {
  const perUnit = portion.food[nutrient];
  if (perUnit === null || perUnit === undefined) {
    missing.push({ nutrient: label, foodId: portion.food.id, foodName: portion.food.name });
    return 0;
  }
  return (perUnit as number) * portion.quantity;
}

/**
 * Spec 7.5. Glycemic load is the index applied to the available carbohydrate, which
 * is total carbohydrate less fibre. Foods without an index contribute nothing and
 * are reported as missing, so a low number never gets mistaken for a low-GL day.
 */
function glycemicLoadOf(portion: LoggedPortion, missing: MissingFigure[]): number | null {
  const { glycemic_index: index, carbs_g: carbs, fibre_g: fibre, id, name } = portion.food;

  if (index === null) {
    missing.push({ nutrient: 'glycemic_index', foodId: id, foodName: name });
    return null;
  }
  if (carbs === null) return null;

  const available = Math.max(0, carbs - (fibre ?? 0)) * portion.quantity;
  return (index * available) / 100;
}

export function dailyTotals(portions: readonly LoggedPortion[]): NutritionTotals {
  // A gap is a fact about a food, not about a serving, so eating the same food
  // twice reports it once.
  const gaps: MissingFigure[] = [];

  let glycemicLoad: number | null = null;
  for (const portion of portions) {
    const load = glycemicLoadOf(portion, gaps);
    if (load !== null) glycemicLoad = (glycemicLoad ?? 0) + load;
  }

  const sum = (nutrient: keyof NutritionFoodRow, label: string) =>
    portions.reduce((total, portion) => total + add(portion, nutrient, label, gaps), 0);

  const sodiumMg = sum('sodium_mg', 'sodium_mg');

  const dairyPortions = portions.filter((portion) => portion.food.is_dairy === 1);
  const dairy = {
    portions: dairyPortions.length,
    millilitresG: dairyPortions
      .filter((portion) => portion.food.base_unit === 'ml')
      .reduce((total, portion) => total + portion.quantity, 0),
    proteinG: dairyPortions.reduce(
      (total, portion) => total + portion.food.protein_g * portion.quantity,
      0,
    ),
  };

  return {
    kcal: sum('kcal', 'kcal'),
    proteinG: sum('protein_g', 'protein_g'),
    carbsG: sum('carbs_g', 'carbs_g'),
    sugarG: sum('sugar_g', 'sugar_g'),
    fatG: sum('fat_g', 'fat_g'),
    fibreG: sum('fibre_g', 'fibre_g'),
    sodiumMg,
    glycemicLoad,
    dairy,
    sodiumOverLimit: sodiumMg > SODIUM_FLAG_MG,
    missing: dedupe(gaps),
  };
}

function dedupe(figures: readonly MissingFigure[]): MissingFigure[] {
  const seen = new Set<string>();
  return figures.filter((figure) => {
    const key = `${figure.nutrient}:${figure.foodId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Spec 7.5 point 2: a daily dairy total, shown but never used to remove anything. */
export function dairyPortions(portions: readonly LoggedPortion[]): number {
  return portions
    .filter((portion) => portion.food.is_dairy === 1)
    .reduce((total, portion) => total + portion.quantity, 0);
}
