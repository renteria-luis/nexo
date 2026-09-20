// Spec 16.6, the calculation that justifies building this module at all.
//
// Flipp can tell him a chicken breast is $6.34 a pound. It cannot tell him that is
// 41 grams of protein per dollar, because Flipp does not know his macros. This file
// is the join, and it is the only reason a deals aggregator beats just opening Flipp.
//
// Two rules from spec 16.6 are encoded here rather than left to the screen:
// comparisons are made on final prices and never on discount percentages, and a
// figure that cannot be computed comes back null instead of guessed (spec 16.3
// rule 5).

import type { IsoDate } from '../core/dates.ts';
import type { DealsDealRow, DealsDiscountRow, NutritionFoodRow } from '../db/types.ts';

const GRAMS_PER_LB = 453.59237;
const GRAMS_PER_KG = 1000;

/** ISO weekday, 1 Monday to 7 Sunday, from a local YYYY-MM-DD. */
export function weekdayOf(date: IsoDate): number {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  return weekday === 0 ? 7 : weekday;
}

/**
 * The discount that applies to a chain on a given day. Null when none does, which
 * is not the same as a zero percent discount and is why this is not a number.
 */
export function applicableDiscount(
  discounts: readonly DealsDiscountRow[],
  chain: string | null,
  onDate: IsoDate,
): DealsDiscountRow | null {
  if (chain === null) return null;
  const weekday = String(weekdayOf(onDate));

  const candidates = discounts.filter(
    (discount) =>
      discount.active === 1 &&
      discount.chain === chain &&
      (discount.days_of_week === '' || discount.days_of_week.split(',').includes(weekday)),
  );

  // Spec 16.6: the biggest percentage, but the comparison between retailers still
  // happens on the final price further down.
  return candidates.reduce<DealsDiscountRow | null>(
    (best, discount) => (best === null || discount.percent > best.percent ? discount : best),
    null,
  );
}

export function finalPriceCents(
  deal: DealsDealRow,
  discount: DealsDiscountRow | null,
): number | null {
  if (deal.price_cents === null) return null;
  if (discount === null) return deal.price_cents;
  return deal.price_cents * (1 - discount.percent / 100);
}

/** How many grams of the food one unit of the deal's price buys, or null. */
function gramsPerUnit(unit: string | null): number | null {
  if (unit === null) return null;
  const normalised = unit.trim().toLowerCase();
  if (normalised === 'lb' || normalised === 'lbs') return GRAMS_PER_LB;
  if (normalised === 'kg') return GRAMS_PER_KG;
  if (normalised === '100g') return 100;
  // 'ea', 'each', a package: the weight is not in the price, so nothing can be said.
  return null;
}

export type ProteinValue = {
  finalPriceCents: number;
  proteinPerDollar: number;
  discount: DealsDiscountRow | null;
};

/**
 * Grams of protein per dollar, after the discount that applies that day.
 *
 * Null whenever any input is missing: a price the source did not give, a unit it did
 * not state, or a food with no weight for its base unit. Spec 16.3 rule 5 is explicit
 * that a gap is shown as a gap, and a wrong protein per dollar is worse than none
 * because it is exactly the number he would decide on.
 */
export function proteinPerDollar(
  deal: DealsDealRow,
  food: NutritionFoodRow,
  discounts: readonly DealsDiscountRow[],
  chain: string | null,
  onDate: IsoDate,
): ProteinValue | null {
  const grams = gramsPerUnit(deal.unit);
  if (grams === null) return null;
  if (food.base_unit_g === null || food.base_unit_g <= 0) return null;

  const discount = applicableDiscount(discounts, chain, onDate);
  const cents = finalPriceCents(deal, discount);
  if (cents === null || cents <= 0) return null;

  const proteinPerGram = food.protein_g / food.base_unit_g;
  const dollars = cents / 100;
  return {
    finalPriceCents: cents,
    proteinPerDollar: (grams * proteinPerGram) / dollars,
    discount,
  };
}

export type RankedDeal = {
  deal: DealsDealRow;
  food: NutritionFoodRow;
  value: ProteinValue;
};

/**
 * Best protein per dollar first. Spec 16.6 again: a 10% discount on a dearer shelf
 * price loses to a cheaper shop with no discount, and this is where that is settled.
 */
export function rankByProteinPerDollar(candidates: readonly RankedDeal[]): RankedDeal[] {
  return [...candidates].sort((a, b) => b.value.proteinPerDollar - a.value.proteinPerDollar);
}
