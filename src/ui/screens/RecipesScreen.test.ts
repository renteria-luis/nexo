import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proteinAgainstBand } from '../../core/targets.ts';
import { nodes, renderModule, textOf } from '../test-render.ts';

test('recipes explain projected protein and name missing ingredients once, even when expanded', async () => {
  const recipe = {
    id: 'oats',
    name: 'Avena',
    steps: '',
    portions: 2,
    ingredients: [
      { itemId: 'whey', amount: 1 },
      { itemId: 'milk', amount: 300 },
    ],
  };
  const pantry = [
    { id: 'whey', name: 'Whey', kind: 'counted', quantity: 0, unit: 'unidad' },
    { id: 'milk', name: 'Leche', kind: 'weighed', quantity: 0, unit: 'ml' },
  ];
  const app = {
    state: {
      phase: 'ready',
      loaded: { today: { nutrition: { proteinG: 34 }, targets: { weightBasisKg: 73 } } },
    },
    loadPantry: async () => pantry,
    loadRecipes: async () => [recipe],
    loadRecipePortions: async () =>
      new Map([['oats', { ok: true, portion: { proteinG: 17.4, kcal: 125 } }]]),
  };
  const screen = renderModule('src/ui/screens/RecipesScreen.tsx', {
    '@react-navigation/native': { useNavigation: () => ({ navigate() {} }) },
    '../../shell/AppData.tsx': { useAppData: () => app },
    '../Button.tsx': { Button: 'Button' },
    '../IconButton.tsx': { IconButton: 'IconButton' },
    '../Card.tsx': { Card: 'Card' },
    '../RecipeForm.tsx': { RecipeForm: 'RecipeForm' },
    '../InfoBubble.tsx': {
      ConfirmButton: 'ConfirmButton',
      InfoDot: 'InfoDot',
      InfoText: 'InfoText',
    },
    '../icons.ts': {},
    './Screen.tsx': { Screen: 'Screen' },
  }).mount('RecipesScreen', {});
  let tree = await screen.settle();
  assert.match(textOf(tree), /17.4 g de proteína y 125 kcal cada una/);
  assert.match(textOf(tree), /Faltan Whey, Leche/);
  nodes(tree)
    .find((node) => node.props.accessibilityLabel === 'Avena')!
    .props.onPress();
  tree = await screen.settle();
  const text = textOf(tree);
  assert.equal((text.match(/Faltan Whey, Leche/g) ?? []).length, 1);
  assert.doesNotMatch(text, /faltan 2|· falta/);
  assert.match(text, /Con una porción: 51 g de proteína hoy; faltarían 80 para 131 g/);
  assert.equal(proteinAgainstBand(34, { from: 131, to: 160 }), 'faltan 97 para 131 g');
  assert.equal(nodes(tree).find((node) => node.props.label === 'Cocinar')!.props.disabled, true);
});
