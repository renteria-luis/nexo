import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DealsSourceRow, ListedDeal, NutritionFoodRow } from '../db/types.ts';
import type { WatchedDeal } from '../deals/index.ts';

import { renderModule, textOf } from './test-render.ts';

const CHICKEN = {
  id: 'chicken-breast',
  name: 'Pechuga de pollo',
  base_unit: 'g',
  unit_kind: 'mass',
  base_unit_g: 1,
  protein_g: 0.224,
  price_cad_cents: 1549,
  package_size: 1000,
} as NutritionFoodRow;

function watched(id: string, title: string, priceCents: number): WatchedDeal {
  const deal = {
    id,
    title,
    description: null,
    price_cents: priceCents,
    unit: 'kg',
    grams: null,
    pack_ml: null,
    pack_count: null,
    valid_to: '2026-10-28',
    staple: 0,
  } as unknown as ListedDeal;
  return {
    word: 'chicken',
    item: {
      deal,
      source: { id: 'flipp' } as DealsSourceRow,
      retailer: null,
      food: CHICKEN,
      candidate: CHICKEN,
      confirmed: null,
      stale: false,
    },
  };
}

test('a deal too cheap to be real goes last in the alert and says why', () => {
  const alert = renderModule('src/ui/DealAlert.tsx', {
    './Button.tsx': { Button: 'Button' },
    './IconButton.tsx': { IconButton: 'IconButton' },
    './icons.ts': { X: 'X' },
  }).mount('DealAlert', {
    // The misread first, as the watchlist hands it over.
    found: [watched('misread', 'BREADED CUTLETS', 45), watched('sale', 'CHICKEN THIGHS', 881)],
    silent: [],
    discounts: [],
    today: '2026-10-23',
    onOpenAll() {},
    onClose() {},
  });
  const text = textOf(alert.render());

  assert.ok(text.indexOf('CHICKEN THIGHS') < text.indexOf('BREADED CUTLETS'));
  assert.match(text, /¿97% bajo lo tuyo\? Revisa el tamaño/);
  assert.doesNotMatch(text, /2026-10-28/);
  assert.match(text, /hasta mié, 28-oct/);
});
