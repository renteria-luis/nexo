import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SODIUM_FLAG_MG } from '../nutrition/totals.ts';

import { nodes, renderModule, textOf } from './test-render.ts';

test('both food layouts show the same totals, goals first, and the gap warning', () => {
  const totals = {
    kcal: 1500,
    proteinG: 100,
    carbsG: 120,
    fibreG: 5,
    fatG: 50,
    sodiumMg: SODIUM_FLAG_MG + 1,
    sodiumOverLimit: true,
    glycemicLoad: null,
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
      },
      onAdd() {},
      onRemove() {},
      onOpenCatalogue() {},
    });
    const text = textOf(log.render());
    // Calories alone on the first line, then protein and carbs, then fat and sodium.
    const order = ['Calorías', 'Proteína', 'Carbos', 'Grasa', 'Sodio'].map((label) =>
      text.indexOf(label),
    );
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
    assert.ok(order.every((at) => at >= 0));
    for (const label of [
      'Calorías1500',
      'faltan 300 para la banda',
      'Proteína100 g',
      'faltan 35 para el piso',
      'Carbos120 + g',
      'fibra 5 g',
      'Grasa50 g',
      `Sodio${SODIUM_FLAG_MG + 1} mg`,
      `sobre ${SODIUM_FLAG_MG}`,
      'Avena no trae todos los datos',
    ]) {
      assert.ok(text.includes(label), `${record}: ${label}`);
    }
    assert.ok(!text.includes('Arroz'));
    assert.ok(!text.includes('Lácteos'));
    assert.ok(!text.includes('Carga glucémica'));
    assert.ok(text.includes(record ? 'bajo el piso de 58 g' : 'faltan 8 para el piso'));
  }
});

test('meal slots are icons, and only the chosen one writes its name', () => {
  const log = renderModule('src/ui/FoodLog.tsx', {
    './Button.tsx': { Button: 'Button' },
    './Card.tsx': { Card: 'Card' },
    './Chip.tsx': { Chip: 'Chip' },
    './FoodPicker.tsx': { FoodPicker: 'FoodPicker' },
    './InfoBubble.tsx': { ConfirmButton: 'ConfirmButton', InfoDot: 'InfoDot' },
    './IconButton.tsx': { IconButton: 'IconButton' },
    './NumericField.tsx': { NumericField: 'NumericField' },
    './icons.ts': Object.fromEntries(
      [
        'Coffee',
        'Moon',
        'Pencil',
        'Plus',
        'Sun',
        'Sunrise',
        'Sunset',
        'Trash',
        'TriangleAlert',
      ].map((name) => [name, name]),
    ),
  }).mount('FoodLog', {
    foods: [],
    portions: [],
    totals: null,
    proteinBand: null,
    kcalBand: null,
    fatBand: null,
    history: { recent: [], usualBySlot: new Map() },
    onAdd() {},
    onRemove() {},
    onOpenCatalogue() {},
    slot: 'cena',
  });
  const slots = nodes(log.render()).filter(
    (node) => node.type === 'Chip' && node.props.icon !== undefined,
  );
  assert.deepEqual(
    slots.map((chip) => [chip.props.accessibilityLabel, chip.props.label]),
    [
      ['desayuno', ''],
      ['media mañana', ''],
      ['mediodía', ''],
      ['tarde', ''],
      ['cena', 'cena'],
    ],
  );
});
