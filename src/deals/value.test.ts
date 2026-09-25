import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DealsDealRow, DealsDiscountRow, NutritionFoodRow } from '../db/types.ts';

import {
  applicableDiscount,
  comparedToUsual,
  finalPriceCents,
  proteinPerDollar,
  rankByProteinPerDollar,
  weekdayOf,
} from './value.ts';

// 2026-09-22 is a Tuesday, which is the only day the Food Basics discount runs.
const TUESDAY = '2026-09-22';
const WEDNESDAY = '2026-09-23';

const FOOD_BASICS: DealsDiscountRow = {
  id: 'foodbasics-student',
  retailer_id: null,
  chain: 'Food Basics',
  percent: 10,
  days_of_week: '2',
  conditions: null,
  active: 1,
};

const METRO: DealsDiscountRow = {
  id: 'metro-student',
  retailer_id: null,
  chain: 'Metro',
  percent: 10,
  days_of_week: '',
  conditions: null,
  active: 1,
};

const DISCOUNTS = [FOOD_BASICS, METRO];

/** Chicken breast: 23 g of protein per 100 g, stored per gram like the catalogue. */
const CHICKEN: NutritionFoodRow = {
  id: 'chicken-breast',
  name: 'Pechuga de pollo',
  keywords: null,
  brand: null,
  store: null,
  base_unit: 'g',
  unit_kind: 'mass',
  base_unit_g: 1,
  kcal: 1.2,
  protein_g: 0.23,
  carbs_g: 0,
  sugar_g: null,
  fat_g: 0.026,
  fibre_g: null,
  sodium_mg: null,
  barcode: null,
  source: 'label',
  price_cad_cents: null,
  package_size: null,
  glycemic_index: null,
  is_dairy: 0,
};

function deal(priceCents: number | null, unit: string | null): DealsDealRow {
  return {
    id: 'd1',
    source_id: 'flipp',
    retailer_id: null,
    title: 'Chicken breast',
    description: null,
    price_cents: priceCents,
    original_price_cents: null,
    savings_pct: null,
    unit,
    quantity_available: null,
    best_before: null,
    valid_from: null,
    valid_to: null,
    category: null,
    image_url: null,
    source_url: null,
    deep_link: null,
    fetched_at: 1_700_000_000_000,
    expires_at: null,
    confidence: 'exact',
    raw_payload: null,
    staple: 0,
  };
}

test('the student discount only counts on the day it runs', () => {
  assert.equal(weekdayOf(TUESDAY), 2);
  assert.equal(applicableDiscount(DISCOUNTS, 'Food Basics', TUESDAY)?.id, 'foodbasics-student');
  assert.equal(applicableDiscount(DISCOUNTS, 'Food Basics', WEDNESDAY), null);

  // Metro's runs every day, which is what makes it look better than it is.
  assert.equal(applicableDiscount(DISCOUNTS, 'Metro', WEDNESDAY)?.id, 'metro-student');

  // A shop with no discount gets null, not a zero percent one.
  assert.equal(applicableDiscount(DISCOUNTS, 'No Frills', TUESDAY), null);
  assert.equal(applicableDiscount(DISCOUNTS, null, TUESDAY), null);
});

test('protein per dollar is the price after the discount, per kilo of food', () => {
  // $8.81/kg, 230 g of protein in that kilo: 26.1 g per dollar before any discount.
  const plain = proteinPerDollar(deal(881, 'kg'), CHICKEN, DISCOUNTS, 'No Frills', TUESDAY);
  assert.ok(plain);
  assert.equal(plain.discount, null);
  assert.ok(Math.abs(plain.proteinPerDollar - (1000 * 0.23) / 8.81) < 1e-9);

  // The same price at Food Basics on a Tuesday: 10% off, so 29 g per dollar.
  const tuesday = proteinPerDollar(deal(881, 'kg'), CHICKEN, DISCOUNTS, 'Food Basics', TUESDAY);
  assert.ok(tuesday);
  assert.equal(tuesday.discount?.id, 'foodbasics-student');
  assert.ok(Math.abs(tuesday.finalPriceCents - 792.9) < 1e-9);
  assert.ok(tuesday.proteinPerDollar > plain.proteinPerDollar);
});

test('a pound is a pound and not a kilo', () => {
  const perPound = proteinPerDollar(deal(634, 'lb'), CHICKEN, DISCOUNTS, null, TUESDAY);
  assert.ok(perPound);
  assert.ok(Math.abs(perPound.proteinPerDollar - (453.59237 * 0.23) / 6.34) < 1e-9);
});

test('what cannot be computed comes back empty instead of guessed', () => {
  // Spec 16.3 rule 5. A price with no unit says nothing about protein per dollar.
  assert.equal(proteinPerDollar(deal(881, null), CHICKEN, DISCOUNTS, null, TUESDAY), null);
  // Sold by the package: the weight is not in the price.
  assert.equal(proteinPerDollar(deal(881, 'ea'), CHICKEN, DISCOUNTS, null, TUESDAY), null);
  // No price at all.
  assert.equal(proteinPerDollar(deal(null, 'kg'), CHICKEN, DISCOUNTS, null, TUESDAY), null);
  // A food with no weight for its base unit, like the Jr. Bacon Cheeseburger.
  const noWeight = { ...CHICKEN, base_unit_g: null };
  assert.equal(proteinPerDollar(deal(881, 'kg'), noWeight, DISCOUNTS, null, TUESDAY), null);
});

test('the cheaper shop wins even when the other one discounts every day', () => {
  // Spec 16.6: Metro is 10% daily but dearer, and the comparison is made on the
  // final price, never on the percentage.
  const foodBasics = proteinPerDollar(deal(881, 'kg'), CHICKEN, DISCOUNTS, 'Food Basics', TUESDAY);
  const metro = proteinPerDollar(deal(1050, 'kg'), CHICKEN, DISCOUNTS, 'Metro', TUESDAY);
  assert.ok(foodBasics && metro);

  const ranked = rankByProteinPerDollar([
    { deal: deal(1050, 'kg'), food: CHICKEN, value: metro },
    { deal: deal(881, 'kg'), food: CHICKEN, value: foodBasics },
  ]);
  assert.equal(Math.round(ranked[0].value.finalPriceCents), 793);
  assert.ok(ranked[0].value.proteinPerDollar > ranked[1].value.proteinPerDollar);
});

test('the discount is applied to the price, not to the protein', () => {
  assert.equal(finalPriceCents(deal(1000, 'kg'), null), 1000);
  assert.equal(finalPriceCents(deal(1000, 'kg'), METRO), 900);
  assert.equal(finalPriceCents(deal(null, 'kg'), METRO), null);
});

test('a deal is measured against what he already pays for that kilo', () => {
  // Kirkland chicken at $15.49 the kilo is the number to beat.
  const chicken = {
    ...CHICKEN,
    protein_g: 28 / 125,
    base_unit_g: 1,
    price_cad_cents: 1549,
    package_size: 1000,
  };

  const cheaper = comparedToUsual(deal(881, 'kg'), chicken, [], null, '2026-09-21');
  assert.ok(cheaper !== null);
  assert.equal(Math.round(cheaper.usualCentsPerKg), 1549);
  assert.equal(Math.round(cheaper.dealCentsPerKg), 881);
  assert.equal(Math.round(cheaper.savingPercent), 43);

  const dearer = comparedToUsual(deal(1999, 'kg'), chicken, [], null, '2026-09-21');
  assert.ok(dearer !== null && dearer.savingPercent < 0);
});

test('without a price on the catalogue row there is nothing to compare against', () => {
  assert.equal(comparedToUsual(deal(881, 'kg'), CHICKEN, [], null, '2026-09-21'), null);
});
