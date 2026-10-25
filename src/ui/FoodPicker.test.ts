import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nodes, renderModule, textOf } from './test-render.ts';

test('the picker suggests at most two usual foods and three recent ones', async () => {
  const foods = Array.from({ length: 10 }, (_, index) => ({
    id: `f${index}`,
    name: `Comida ${index}`,
    base_unit: 'g',
    kcal: 1,
    protein_g: 0,
    fat_g: 0,
    carbs_g: 0,
    brand: null,
    store: null,
    keywords: null,
  }));
  const tree = await renderModule('src/ui/FoodPicker.tsx', {
    './Button.tsx': { Button: 'Button' },
    './IconButton.tsx': { IconButton: 'IconButton' },
    './SearchField.tsx': { SearchField: 'SearchField' },
    './icons.ts': { ChevronDown: 'ChevronDown', ChevronUp: 'ChevronUp', Pencil: 'Pencil' },
  })
    .mount('FoodPicker', {
      foods,
      history: {
        usualBySlot: new Map([['desayuno', ['f0', 'f1', 'f2', 'f3']]]),
        recent: ['f0', 'f4', 'f5', 'f6', 'f7', 'f8'],
        lastQuantity: new Map(),
      },
      slot: 'desayuno',
      selectedId: null,
      onSelect() {},
      onOpenCatalogue() {},
    })
    .settle();
  const text = textOf(tree);
  for (const shown of ['Comida 0', 'Comida 1', 'Comida 4', 'Comida 5', 'Comida 6']) {
    assert.ok(text.includes(shown), shown);
  }
  for (const hidden of ['Comida 2', 'Comida 3', 'Comida 7']) {
    assert.ok(!text.includes(hidden), hidden);
  }
  assert.ok(nodes(tree).some((node) => node.props.label === 'Ver los otros 5'));
});

test('the chosen food says what the typed portion brings, not what 100 g brings', async () => {
  const chicken = {
    id: 'chicken',
    name: 'Pechuga de pollo',
    base_unit: 'g',
    unit_kind: 'mass',
    kcal: 1.2,
    protein_g: 0.224,
    fat_g: 0,
    carbs_g: 0,
    brand: null,
    store: null,
    keywords: null,
  };
  const picker = (quantity: number) =>
    renderModule('src/ui/FoodPicker.tsx', {
      './Button.tsx': { Button: 'Button' },
      './IconButton.tsx': { IconButton: 'IconButton' },
      './SearchField.tsx': { SearchField: 'SearchField' },
      './icons.ts': { ChevronDown: 'ChevronDown', ChevronUp: 'ChevronUp', Pencil: 'Pencil' },
    })
      .mount('FoodPicker', {
        foods: [chicken],
        history: { usualBySlot: new Map(), recent: [], lastQuantity: new Map() },
        slot: 'cena',
        selectedId: 'chicken',
        quantity,
        onSelect() {},
        onOpenCatalogue() {},
      })
      .settle();
  assert.ok(textOf(await picker(200)).includes('200 g · 240 kcal · 44.8 g P'));
  assert.ok(textOf(await picker(Number(''))).includes('100 g · 120 kcal · 22.4 g P'));
});

test('a search offers to create what was typed, unless a food already has that name', async () => {
  const food = (id: string, name: string) => ({
    id,
    name,
    base_unit: 'g',
    unit_kind: 'mass',
    kcal: 1,
    protein_g: 0,
    fat_g: 0,
    carbs_g: 0,
    brand: null,
    store: null,
    keywords: null,
  });
  const asked: string[] = [];
  const screen = renderModule('src/ui/FoodPicker.tsx', {
    './Button.tsx': { Button: 'Button' },
    './IconButton.tsx': { IconButton: 'IconButton' },
    './SearchField.tsx': { SearchField: 'SearchField' },
    './icons.ts': new Proxy({}, { get: (_, name) => name }),
  }).mount('FoodPicker', {
    foods: [food('bar', 'Barrita'), food('rice', 'Arroz')],
    history: { usualBySlot: new Map(), recent: [], lastQuantity: new Map() },
    slot: 'cena',
    selectedId: null,
    onSelect() {},
    onOpenCatalogue() {},
    onNewFood: (name: string) => asked.push(name),
  });
  const search = async (text: string) => {
    nodes(await screen.settle())
      .find((node) => node.type === 'SearchField')!
      .props.onChange(text);
    return nodes(await screen.settle()).find((node) =>
      /^Alimento nuevo/.test(node.props.label ?? ''),
    );
  };

  const kefir = await search('kefir');
  assert.equal(kefir?.props.label, 'Alimento nuevo: Kefir');
  kefir!.props.onPress();
  assert.deepEqual(asked, ['Kefir']);
  // A partial match still offers it, after the matches; an exact one does not.
  assert.equal((await search('barr'))?.props.label, 'Alimento nuevo: Barr');
  assert.equal(await search('barrita'), undefined);
});

test('with nothing logged yet, the catalogue is listed without a button to show it', async () => {
  const tree = await renderModule('src/ui/FoodPicker.tsx', {
    './Button.tsx': { Button: 'Button' },
    './IconButton.tsx': { IconButton: 'IconButton' },
    './SearchField.tsx': { SearchField: 'SearchField' },
    './icons.ts': new Proxy({}, { get: (_, name) => name }),
  })
    .mount('FoodPicker', {
      foods: [
        {
          id: 'rice',
          name: 'Arroz',
          base_unit: 'g',
          kcal: 3.65,
          protein_g: 0.07,
          fat_g: 0,
          carbs_g: 0.8,
          brand: null,
          store: null,
          keywords: null,
        },
      ],
      history: { usualBySlot: new Map(), recent: [], lastQuantity: new Map() },
      slot: 'cena',
      selectedId: null,
      onSelect() {},
      onOpenCatalogue() {},
    })
    .settle();
  assert.ok(textOf(tree).includes('Arroz'));
  assert.ok(!nodes(tree).some((node) => /^Ver los otros/.test(node.props.label ?? '')));
});
