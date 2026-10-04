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
import type { DealsDiscountRow, ListedDeal, NutritionFoodRow } from '../db/types.ts';

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
  deal: ListedDeal,
  discount: DealsDiscountRow | null,
): number | null {
  if (deal.price_cents === null) return null;
  if (discount === null) return deal.price_cents;
  return deal.price_cents * (1 - discount.percent / 100);
}

/**
 * Cuantos gramos de comida compra el precio de la oferta, o null.
 *
 * Primero lo que el recolector leyo del folleto, que es lo que hace que esto funcione
 * fuera de las pocas ofertas que vienen por libra: el peso suele estar en el titulo y
 * no en la unidad. Si no hay peso, la unidad, y si la unidad es 'ea' no se puede decir
 * nada, porque un paquete no dice cuanta comida es.
 */
function gramsOfDeal(deal: ListedDeal): number | null {
  if (deal.grams !== null && deal.grams > 0) return deal.grams;
  if (deal.unit === null) return null;
  const normalised = deal.unit.trim().toLowerCase();
  if (normalised === 'lb' || normalised === 'lbs') return GRAMS_PER_LB;
  if (normalised === 'kg') return GRAMS_PER_KG;
  if (normalised === '100g') return 100;
  return null;
}

/**
 * Cuantas unidades base de esa comida compra el precio: gramos para lo que se pesa,
 * mililitros para lo que se sirve y unidades para lo que se cuenta.
 *
 * Es lo que deja funcionar los huevos y la leche, que son la mitad de lo que compra:
 * dieciocho huevos no pesan nada que el folleto diga, pero son dieciocho huevos, y su
 * ficha ya sabe lo que trae cada uno.
 */
function baseUnitsOfDeal(deal: ListedDeal, food: NutritionFoodRow): number | null {
  if (food.unit_kind === 'count') return deal.pack_count;
  if (food.unit_kind === 'volume') return deal.pack_ml;
  const grams = gramsOfDeal(deal);
  if (grams === null || food.base_unit_g === null || food.base_unit_g <= 0) return null;
  return grams / food.base_unit_g;
}

/**
 * Lo que cuesta un kilo de esa oferta, en centavos. Null cuando no se sabe lo que
 * pesa, que es la mitad de las ofertas: un "2 x $7" sin gramos no dice nada del kilo.
 */
export function dealCentsPerKg(deal: ListedDeal): number | null {
  const grams = gramsOfDeal(deal);
  if (grams === null || grams <= 0 || deal.price_cents === null) return null;
  return Math.round((deal.price_cents / grams) * GRAMS_PER_KG);
}

export type UnitPrice = {
  cents: number;
  /** Como se dice en pantalla: "el kilo", "el litro", "por unidad". */
  per: string;
  /** El tamano del paquete, tal como para ponerlo al lado del nombre. */
  size: string;
};

/**
 * Lo que cuesta la medida con la que se compara: el kilo, el litro o la unidad.
 *
 * Es lo que el folleto nunca pone junto: dice "$4.44" y, en letra chica, "18'S". El
 * precio por huevo no esta en ningun sitio y es el que decide.
 */
export function unitPrice(deal: ListedDeal): UnitPrice | null {
  if (deal.price_cents === null || deal.price_cents <= 0) return null;

  const grams = gramsOfDeal(deal);
  if (grams !== null && grams > 0) {
    return {
      cents: Math.round((deal.price_cents / grams) * GRAMS_PER_KG),
      per: 'el kilo',
      size:
        grams >= 1000
          ? `${(grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 2)} kg`
          : `${Math.round(grams)} g`,
    };
  }
  if (deal.pack_ml !== null && deal.pack_ml > 0) {
    return {
      cents: Math.round((deal.price_cents / deal.pack_ml) * 1000),
      per: 'el litro',
      size:
        deal.pack_ml >= 1000
          ? `${(deal.pack_ml / 1000).toFixed(deal.pack_ml % 1000 === 0 ? 0 : 2)} L`
          : `${deal.pack_ml} ml`,
    };
  }
  if (deal.pack_count !== null && deal.pack_count > 0) {
    return {
      cents: Math.round(deal.price_cents / deal.pack_count),
      per: 'cada uno',
      size: `${deal.pack_count} u.`,
    };
  }
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
  deal: ListedDeal,
  food: NutritionFoodRow,
  discounts: readonly DealsDiscountRow[],
  chain: string | null,
  onDate: IsoDate,
): ProteinValue | null {
  const units = baseUnitsOfDeal(deal, food);
  if (units === null || units <= 0) return null;

  const discount = applicableDiscount(discounts, chain, onDate);
  const cents = finalPriceCents(deal, discount);
  if (cents === null || cents <= 0) return null;

  const dollars = cents / 100;
  return {
    finalPriceCents: cents,
    // protein_g es por unidad base, asi que esto ya esta en gramos de proteina.
    proteinPerDollar: (units * food.protein_g) / dollars,
    discount,
  };
}

export type PriceComparison = {
  dealCentsPerKg: number;
  usualCentsPerKg: number;
  /** Positive when the deal beats what he pays. */
  savingPercent: number;
};

/**
 * What a kilo of this food normally costs him, from the package price on the
 * catalogue row. Null when the row does not carry a price, a package size or a
 * weight, because the whole point of the comparison is that both sides are real.
 */
export function usualCentsPerKg(food: NutritionFoodRow): number | null {
  if (food.price_cad_cents === null || food.package_size === null) return null;
  if (food.base_unit_g === null || food.base_unit_g <= 0) return null;
  const grams = food.package_size * food.base_unit_g;
  if (grams <= 0) return null;
  return (food.price_cad_cents / grams) * GRAMS_PER_KG;
}

/**
 * The deal's price per kilo against his. Spec 16.6 compares final prices, so the
 * discount of the day is applied first. Null when either side cannot be stated in
 * kilos, which is most deals: 'ea' does not say how much food it is.
 */
export function comparedToUsual(
  deal: ListedDeal,
  food: NutritionFoodRow,
  discounts: readonly DealsDiscountRow[],
  chain: string | null,
  onDate: IsoDate,
): PriceComparison | null {
  const units = baseUnitsOfDeal(deal, food);
  const usual = usualCentsPerKg(food);
  if (units === null || units <= 0 || usual === null || usual <= 0) return null;
  if (food.base_unit_g === null || food.base_unit_g <= 0) return null;
  const grams = units * food.base_unit_g;

  const cents = finalPriceCents(deal, applicableDiscount(discounts, chain, onDate));
  if (cents === null || cents <= 0) return null;

  const dealCentsPerKg = (cents / grams) * GRAMS_PER_KG;
  return {
    dealCentsPerKg,
    usualCentsPerKg: usual,
    savingPercent: ((usual - dealCentsPerKg) / usual) * 100,
  };
}
