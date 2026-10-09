import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nodes, renderModule, textOf } from './test-render.ts';

const RICE = { id: 'rice', name: 'Arroz', base_unit_g: 1 };

function panel(onLoadLast: (foodId: string) => Promise<unknown>, batches: unknown[] = []) {
  return renderModule('src/ui/BatchPanel.tsx', {
    './Button.tsx': { Button: 'Button' },
    './Card.tsx': { Card: 'Card' },
    './Chip.tsx': { Chip: 'Chip' },
    './InfoBubble.tsx': { ConfirmAction: 'ConfirmAction' },
    './NumericField.tsx': { NumericField: 'NumericField' },
    './TextField.tsx': { TextField: 'TextField' },
    './Toggle.tsx': { Toggle: 'Toggle' },
    './icons.ts': Object.fromEntries(
      ['Plus', 'Trash', 'TriangleAlert', 'Utensils'].map((name) => [name, name]),
    ),
  }).mount('BatchPanel', {
    batches,
    foods: [RICE],
    onStart: async () => {},
    onEat: async () => {},
    onThrowAway() {},
    slot: 'cena',
    onLoadLast,
  });
}

const press = (tree: unknown, label: string) =>
  nodes(tree)
    .find((node) => (node.props.accessibilityLabel ?? node.props.label) === label)!
    .props.onPress();

const field = (tree: unknown, label: string) =>
  nodes(tree).find((node) => node.props.accessibilityLabel === label)!.props;

test('a food batched before proposes its last weight and portions, without overwriting', async () => {
  const view = panel(async (foodId) =>
    foodId === 'rice' ? { rawWeightG: 300, portionsCount: 4 } : null,
  );
  let tree = await view.settle();
  press(tree, 'Nueva tanda');
  tree = await view.settle();
  press(tree, 'Del catálogo');
  tree = await view.settle();
  field(tree, 'Porciones').onChange('5');
  tree = await view.settle();
  press(tree, 'Arroz');
  tree = await view.settle();
  assert.equal(field(tree, 'Peso crudo total (g)').value, '300');
  assert.equal(field(tree, 'Porciones').value, '5');
  assert.ok(textOf(tree).includes('Como la última vez: 300 g en 4 porciones.'));
});

test('a portion says its calories are approximate, and protein is the exact figure', async () => {
  const batch = {
    batch: { id: 'b1', portions_remaining: 3, portions_count: 4 },
    food: { name: 'Arroz' },
    macros: { proteinG: 5.2, kcal: 260.4, kcalRange: null, fatDrained: false },
    spoilage: null,
  };
  const tree = await panel(async () => null, [batch]).settle();
  assert.ok(textOf(tree).includes('5.2 g de proteína por porción · unas 260 kcal'), textOf(tree));
});
