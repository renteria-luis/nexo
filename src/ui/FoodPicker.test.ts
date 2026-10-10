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
