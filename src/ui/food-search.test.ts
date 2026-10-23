import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nodes, renderModule, textOf } from './test-render.ts';

const controls = {
  './Button.tsx': { Button: 'Button' },
  './Card.tsx': { Card: 'Card' },
  './Chip.tsx': { Chip: 'Chip' },
  './NumericField.tsx': { NumericField: 'NumericField' },
  './TextField.tsx': { TextField: 'TextField' },
  './SearchField.tsx': { SearchField: 'SearchField' },
  './InfoBubble.tsx': { ConfirmButton: 'ConfirmButton', InfoDot: 'InfoDot' },
  './IconButton.tsx': { IconButton: 'IconButton' },
  './icons.ts': {},
};

test('pantry food search finds keywords, accents, brands, stores and separated words', () => {
  const foods = [
    { id: 'egg', name: 'Huevo blanco', keywords: 'egg eggs', brand: 'Kirkland', store: 'Costco' },
    { id: 'banana', name: 'Plátano', keywords: '', brand: null, store: null },
    {
      id: 'chicken',
      name: 'Pechuga de pollo',
      keywords: 'chicken breast',
      brand: null,
      store: null,
    },
  ];
  const form = renderModule('src/ui/PantryForm.tsx', {
    ...controls,
    '../shell/AppData.tsx': {
      useAppData: () => ({ state: { phase: 'ready', loaded: { foods } } }),
    },
  }).mount('PantryForm', { item: null, onSave() {}, onCancel() {} });
  for (const [query, name] of [
    ['egg', 'Huevo blanco'],
    ['kirkland costco', 'Huevo blanco'],
    ['platano', 'Plátano'],
    ['pollo pechuga', 'Pechuga de pollo'],
    ['chicken', 'Pechuga de pollo'],
  ]) {
    nodes(form.render())
      .find((node) => node.type === 'SearchField')!
      .props.onChange(query);
    const found = nodes(form.render()).filter(
      (node) => node.props.accessibilityLabel === `Es ${name}`,
    );
    assert.equal(found.length, 1, query);
  }
});

test('recipe search folds accents, matches separated words and excludes chosen ingredients', () => {
  const pantry = [
    { id: 'one', name: 'Plátano maduro', kind: 'weighed' },
    { id: 'two', name: 'Pechuga de pollo', kind: 'weighed' },
  ];
  const form = renderModule('src/ui/RecipeForm.tsx', controls).mount('RecipeForm', {
    recipe: null,
    pantry,
    foods: [],
    onSave() {},
    onCancel() {},
  });
  const search = (query: string) => {
    nodes(form.render())
      .find((node) => node.type === 'SearchField')!
      .props.onChange(query);
    return nodes(form.render()).filter((node) => node.type === 'Chip');
  };
  assert.equal(search('').length, 0);
  assert.equal(search('maduro platano')[0]?.props.label, 'Plátano maduro');
  const chicken = search('pollo pechuga')[0];
  assert.equal(chicken?.props.label, 'Pechuga de pollo');
  chicken.props.onPress();
  assert.equal(search('pollo').length, 0);
});

test('a recipe takes a food that is not in the pantry and stocks it at zero on save', () => {
  const pantry = [{ id: 'two', name: 'Pechuga de pollo', kind: 'weighed', foodId: 'chicken' }];
  const foods = [
    { id: 'rice', name: 'Arroz blanco', keywords: 'rice', unit_kind: 'mass', base_unit: 'g' },
    { id: 'chicken', name: 'Pechuga de pollo', keywords: '', unit_kind: 'mass', base_unit: 'g' },
  ].map((food) => ({ ...food, brand: null, store: null }));
  const saved: unknown[][] = [];
  const form = renderModule('src/ui/RecipeForm.tsx', controls).mount('RecipeForm', {
    recipe: null,
    pantry,
    foods,
    onSave: (...args: unknown[]) => saved.push(args),
    onCancel() {},
  });
  const search = (query: string) => {
    nodes(form.render())
      .find((node) => node.type === 'SearchField')!
      .props.onChange(query);
    return nodes(form.render()).filter((node) => node.type === 'Chip');
  };

  assert.deepEqual(
    search('pollo').map((chip) => chip.props.label),
    ['Pechuga de pollo'],
    'a food already in the pantry is offered once, from the pantry',
  );
  assert.equal(search('lentejas').length, 0);
  assert.ok(
    textOf(form.render()).includes('Nada con «lentejas» en la despensa ni en tus alimentos.'),
  );

  const rice = search('arroz')[0];
  assert.equal(rice?.props.label, 'Arroz blanco');
  rice.props.onPress();
  assert.equal(search('arroz').length, 0, 'once in the recipe it is not offered again');
  assert.ok(textOf(form.render()).includes('Arroz blanco'));

  nodes(form.render())
    .find((node) => node.props.accessibilityLabel === 'Nombre de la receta')!
    .props.onChange('Arroz con pollo');
  nodes(form.render())
    .find((node) => node.props.accessibilityLabel === 'Guardar la receta')!
    .props.onPress();
  const [recipe, stocked] = saved[0] as [
    { ingredients: { itemId: string }[] },
    { id: string; kind: string; quantity: number; unit: string; foodId: string }[],
  ];
  assert.equal(stocked.length, 1);
  assert.deepEqual(
    { kind: stocked[0].kind, quantity: stocked[0].quantity, unit: stocked[0].unit },
    { kind: 'weighed', quantity: 0, unit: 'g' },
  );
  assert.equal(stocked[0].foodId, 'rice');
  assert.deepEqual(
    recipe.ingredients.map((one) => one.itemId),
    [stocked[0].id],
  );
});

test('food picker shows macros per count or per hundred grams and millilitres', () => {
  const foods = [
    { id: 'egg', name: 'Huevo', unit_kind: 'count', base_unit: 'huevo', kcal: 70, protein_g: 6 },
    { id: 'meat', name: 'Pollo', unit_kind: 'weigh', base_unit: 'g', kcal: 1.2, protein_g: 0.23 },
    { id: 'milk', name: 'Leche', unit_kind: 'volume', base_unit: 'ml', kcal: 0.5, protein_g: 0.03 },
  ];
  const picker = renderModule('src/ui/FoodPicker.tsx', controls).mount('FoodPicker', {
    foods,
    history: { usualBySlot: new Map(), recent: foods.map((food) => food.id) },
    slot: 'Desayuno',
    selectedId: null,
    onSelect() {},
    onOpenCatalogue() {},
  });
  const text = textOf(picker.render());
  assert.ok(text.includes('huevo · 70 kcal · 6 g P'));
  assert.ok(text.includes('100 g · 120 kcal · 23 g P'));
  assert.ok(text.includes('100 ml · 50 kcal · 3 g P'));
});
