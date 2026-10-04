import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SODIUM_FLAG_MG } from '../nutrition/totals.ts';

import { renderModule, textOf } from './test-render.ts';

test('both food layouts show the same nutrient totals and gap warning', () => {
  const totals = {
    kcal: 1500,
    proteinG: 100,
    carbsG: 120,
    fibreG: 5,
    fatG: 50,
    sodiumMg: SODIUM_FLAG_MG + 1,
    sodiumOverLimit: true,
    glycemicLoad: null,
    dairy: { portions: 1, millilitresG: 250, proteinG: 8 },
    missing: [
      { nutrient: 'carbs_g', foodName: 'Avena', foodId: 'oats' },
      { nutrient: 'glycemic_index', foodName: 'Arroz', foodId: 'rice' },
    ],
  };
  for (const record of [false, true]) {
    const log = renderModule('src/ui/FoodLog.tsx', {
      './Button.tsx': { Button: 'Button' },
      './Card.tsx': { Card: 'Card' },
      './Chip.tsx': { Chip: 'Chip' },
      './FoodPicker.tsx': { FoodPicker: 'FoodPicker' },
      './InfoBubble.tsx': { ConfirmButton: 'ConfirmButton', InfoDot: 'InfoDot' },
      './IconButton.tsx': { IconButton: 'IconButton' },
      './NumericField.tsx': { NumericField: 'NumericField' },
      './Star.tsx': { Star: 'Star' },
      './icons.ts': { TriangleAlert: 'TriangleAlert' },
    }).mount('FoodLog', {
      foods: [],
      portions: [],
      totals,
      record,
      proteinBand: { from: 135, to: 160 },
      kcalBand: { from: 1800, to: 2200 },
      fatBand: { from: 58, to: 75, hardFloor: 58 },
      history: {
        recent: [],
        usualBySlot: new Map(),
        lastMealBySlot: new Map(),
        todayBySlot: new Map(),
      },
      onAdd() {},
      onRemove() {},
      onOpenCatalogue() {},
    });
    const text = textOf(log.render());
    for (const label of [
      'Carbos120 + g',
      'fibra 5 g',
      'Grasa50 g',
      `Sodio${SODIUM_FLAG_MG + 1} mg`,
      `sobre ${SODIUM_FLAG_MG}`,
      'Lácteos250 ml',
      '8 g de proteína',
      'Avena no trae todos los datos',
      'meta 135 o más',
    ]) {
      assert.ok(text.includes(label), `${record}: ${label}`);
    }
    assert.ok(!text.includes('Arroz'));
    assert.ok(!text.includes('Carga glucémica'));
    assert.ok(text.includes(record ? 'bajo el piso de 58 g' : 'faltan 8 para el piso'));
  }
});
