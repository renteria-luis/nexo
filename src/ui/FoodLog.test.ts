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
      'faltan 300 para 1800',
      'Proteína100 g',
      'faltan 35 para 135 g',
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
    assert.ok(text.includes(record ? 'bajo el mínimo de 58 g' : 'faltan 8 para 58 g'));
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

test('a first portion is never guessed in grams, only counted in units', () => {
  const food = (id: string, unit: string, kind: string) =>
    ({
      id,
      name: id,
      base_unit: unit,
      unit_kind: kind,
      base_unit_g: 1,
      quick_amounts: null,
    }) as any;
  const rice = food('arroz', 'g', 'mass');
  const egg = food('huevo', 'huevo', 'count');
  const chicken = food('pollo', 'g', 'mass');
  const log = renderModule('src/ui/FoodLog.tsx', {
    './Button.tsx': { Button: 'Button' },
    './Card.tsx': { Card: 'Card' },
    './Chip.tsx': { Chip: 'Chip' },
    './FoodPicker.tsx': { FoodPicker: 'FoodPicker' },
    './InfoBubble.tsx': { ConfirmButton: 'ConfirmButton', InfoDot: 'InfoDot' },
    './IconButton.tsx': { IconButton: 'IconButton' },
    './NumericField.tsx': { NumericField: 'NumericField' },
    './icons.ts': new Proxy({}, { get: (_, name) => name }),
  }).mount('FoodLog', {
    foods: [rice, egg, chicken],
    portions: [],
    totals: null,
    proteinBand: null,
    kcalBand: null,
    fatBand: null,
    history: { recent: [], usualBySlot: new Map(), lastQuantity: new Map([['pollo', 200]]) },
    onAdd() {},
    onRemove() {},
    onOpenCatalogue() {},
    slot: 'cena',
  });
  const pick = (chosen: unknown) => {
    const picker = nodes(log.render()).find((node) => node.type === 'FoodPicker')!;
    picker.props.onSelect(chosen);
    const tree = nodes(log.render());
    return {
      amount: tree.find((node) => node.type === 'NumericField')!.props.value,
      add: tree.find((node) => node.type === 'Button' && node.props.label === 'Agregar')!.props
        .disabled,
    };
  };

  assert.deepEqual(pick(rice), { amount: '', add: true });
  assert.deepEqual(pick(egg), { amount: '1', add: false });
  assert.deepEqual(pick(chicken), { amount: '200', add: false });
});

test('an added food says so where it was added, and Deshacer takes that entry back out', async () => {
  const chicken = {
    id: 'pollo',
    name: 'Pechuga de pollo',
    base_unit: 'g',
    unit_kind: 'mass',
    base_unit_g: 1,
    quick_amounts: null,
  } as any;
  const egg = { ...chicken, id: 'huevo', name: 'Huevo', base_unit: 'huevo', unit_kind: 'count' };
  const removed: string[] = [];
  const log = renderModule('src/ui/FoodLog.tsx', {
    './Button.tsx': { Button: 'Button' },
    './Card.tsx': { Card: 'Card' },
    './Chip.tsx': { Chip: 'Chip' },
    './FoodPicker.tsx': { FoodPicker: 'FoodPicker' },
    './InfoBubble.tsx': { ConfirmButton: 'ConfirmButton', InfoDot: 'InfoDot' },
    './IconButton.tsx': { IconButton: 'IconButton' },
    './NumericField.tsx': { NumericField: 'NumericField' },
    './icons.ts': new Proxy({}, { get: (_, name) => name }),
  }).mount('FoodLog', {
    foods: [chicken, egg],
    portions: [],
    totals: null,
    proteinBand: null,
    kcalBand: null,
    fatBand: null,
    history: { recent: [], usualBySlot: new Map(), lastQuantity: new Map([['pollo', 200]]) },
    onAdd: async () => 'entry-1',
    onRemove: (entryId: string) => removed.push(entryId),
    onOpenCatalogue() {},
    slot: 'cena',
  });
  const tree = async () => nodes(await log.settle());
  const button = async (label: string) =>
    (await tree()).find((node) => node.type === 'Button' && node.props.label === label);
  const pick = async (food: unknown) =>
    (await tree()).find((node) => node.type === 'FoodPicker')!.props.onSelect(food);

  await pick(chicken);
  (await button('Agregar'))!.props.onPress();
  assert.ok(textOf(await log.settle()).includes('Anotado: 200 g · Pechuga de pollo, cena'));
  (await button('Deshacer'))!.props.onPress();
  assert.deepEqual(removed, ['entry-1']);
  assert.ok(!textOf(await log.settle()).includes('Anotado'));

  // Picking the next food lets the last one go.
  await pick(chicken);
  (await button('Agregar'))!.props.onPress();
  await pick(egg);
  assert.ok(!textOf(await log.settle()).includes('Anotado'));
});
