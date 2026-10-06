import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PantryItem } from '../pantry/pantry.ts';

import { CloudError } from './cloud.ts';
import {
  compareRecipePantry,
  formatRecipe,
  publicRecipeUrl,
  readRecipe,
  researchRecipe,
  suggestRecipe,
  type RecipeSource,
  type SuggestedRecipe,
} from './recipes.ts';

const source: RecipeSource = {
  id: 'source-1',
  title: 'Arroz con verduras',
  url: 'https://www.example.com/arroz',
  content:
    'Ingredientes: arroz y verduras. Preparación: lavar las verduras, cortarlas, cocinar el arroz con agua y mezclar todo hasta que esté listo para servir.',
};
const recipe: SuggestedRecipe = {
  title: 'Arroz con verduras',
  portions: 2,
  sourceId: 'source-1',
  ingredients: [{ name: 'Arroz', amount: 200, unit: 'g', pantryItemId: 'rice' }],
  steps: ['Cocina el arroz en agua.', 'Mezcla y sirve.'],
};
const item = (change: Partial<PantryItem> = {}): PantryItem => ({
  id: 'rice',
  name: 'Arroz',
  kind: 'weighed',
  quantity: 150,
  unit: 'g',
  state: null,
  hasIt: null,
  foodId: null,
  ...change,
});
const credentials = {
  groqApiKey: 'fixture-groq-secret-value',
  tavilyApiKey: 'fixture-tavily-secret-value',
};
const response = (body: unknown) => new Response(JSON.stringify(body));

test('recipe sources accept public HTTPS pages and reject unsafe destinations', () => {
  assert.equal(
    publicRecipeUrl('https://www.example.com/receta#pasos'),
    'https://www.example.com/receta',
  );
  for (const url of [
    'http://example.com/a',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://localhost/x',
    'https://localhost./x',
    'https://127.0.0.1/x',
    'https://2130706433/x',
    'https://0x7f000001/x',
    'https://[::1]/x',
    'https://10.0.0.1/x',
    'https://food.local/x',
    'https://user:password@example.com/x',
    'https://example.com:8443/x',
  ])
    assert.equal(publicRecipeUrl(url), null, url);
});

test('research extracts only returned safe URLs and cites only successfully retrieved recipe pages', async () => {
  const calls: { url: string; body: any }[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    calls.push({ url: String(url), body });
    if (calls.length === 1)
      return response({
        results: [
          { url: 'https://127.0.0.1/recipe', title: 'Unsafe' },
          { url: source.url, title: source.title },
          { url: source.url, title: source.title },
        ],
      });
    assert.deepEqual(body.urls, [source.url]);
    return response({
      results: [
        { url: 'https://invented.example.com/recipe', raw_content: source.content },
        { url: source.url, raw_content: source.content },
      ],
    });
  };
  const result = await researchRecipe('arroz sin leche', credentials.tavilyApiKey, { fetcher });
  assert.deepEqual(result, [source]);
  assert.equal(calls[0].body.search_depth, 'basic');
  assert.equal(calls[0].body.auto_parameters, false);
  assert.equal(calls[1].body.extract_depth, 'basic');
});

test('recipe research stops when pages fail extraction instead of inventing a source', async () => {
  let calls = 0;
  await assert.rejects(
    researchRecipe('arroz', credentials.tavilyApiKey, {
      fetcher: async () => {
        calls++;
        return response(
          calls === 1
            ? { results: [{ url: source.url, title: source.title }] }
            : { failed_results: [{ url: source.url }] },
        );
      },
    }),
    (error: unknown) => error instanceof CloudError && error.code === 'invalid',
  );
  assert.equal(calls, 2);
});

test('recipes reject fabricated sources, links, stock IDs and invalid quantities', () => {
  const stock = [item()];
  for (const value of [
    { ...recipe, sourceId: 'invented' },
    { ...recipe, portions: 0 },
    { ...recipe, ingredients: [] },
    { ...recipe, steps: [] },
    { ...recipe, steps: ['Visita https://fake.example.com'] },
    { ...recipe, ingredients: [{ ...recipe.ingredients[0], pantryItemId: 'invented' }] },
    { ...recipe, ingredients: [{ ...recipe.ingredients[0], amount: -10 }] },
  ])
    assert.throws(() => readRecipe(JSON.stringify(value), [source], stock), CloudError);
  assert.throws(() => readRecipe('not json', [source], stock), CloudError);
  assert.deepEqual(readRecipe(JSON.stringify(recipe), [source], stock), recipe);
});

test('pantry comparison calculates missing quantities and converts compatible units only', () => {
  assert.equal(compareRecipePantry(recipe, [item()])[0].missingAmount, 50);
  assert.equal(
    compareRecipePantry(recipe, [item({ quantity: 0.15, unit: 'kg' })])[0].missingAmount,
    50,
  );
  assert.equal(
    compareRecipePantry(recipe, [item({ quantity: 0.2, unit: 'kg' })])[0].status,
    'available',
  );
  const kilograms = {
    ...recipe,
    ingredients: [{ ...recipe.ingredients[0], amount: 0.2, unit: 'kg' }],
  };
  const summary = formatRecipe(kilograms, [source], [item({ quantity: 0.15, unit: 'kg' })]);
  assert.match(summary, /Arroz: 0.05 kg/);
  assert.match(summary, /Tienes 0.15 kg/);
  assert.equal(
    compareRecipePantry(recipe, [item({ quantity: 200, unit: 'ml' })])[0].status,
    'check',
  );
  assert.equal(compareRecipePantry(recipe, [item({ quantity: null })])[0].status, 'check');
  const duplicates = { ...recipe, ingredients: [recipe.ingredients[0], recipe.ingredients[0]] };
  assert.deepEqual(
    compareRecipePantry(duplicates, [item({ quantity: 250 })]).map((row) => row.missingAmount),
    [null, 150],
  );
});

test('qualitative stock remains qualitative and similar names cannot substitute other ingredients', () => {
  for (const state of ['poco', 'hay'] as const) {
    const found = compareRecipePantry(recipe, [
      item({ kind: 'durable', quantity: null, unit: null, state }),
    ])[0];
    assert.equal(found.status, 'check');
    assert.equal(found.missingAmount, null);
  }
  assert.equal(
    compareRecipePantry(recipe, [item({ kind: 'durable', quantity: null, state: 'no hay' })])[0]
      .missingAmount,
    200,
  );
  const saltRecipe = {
    ...recipe,
    ingredients: [{ name: 'Sal', amount: 2, unit: 'g', pantryItemId: 'rice' }],
  };
  assert.equal(
    compareRecipePantry(saltRecipe, [item({ name: 'Salsa de tomate' })])[0].status,
    'missing',
  );
  const noStock = formatRecipe(
    { ...recipe, ingredients: [{ ...recipe.ingredients[0], pantryItemId: '' }] },
    [source],
    [],
  );
  assert.match(noStock, /Para comprar:\n• Arroz: 200 g/);
});

test('a new researched recipe works without saved recipes and sends no unrelated history or food IDs', async () => {
  const stock = [item({ foodId: 'local-food-reference' })];
  const before = structuredClone(stock);
  const calls: { url: string; body: any }[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    calls.push({ url: String(url), body });
    if (String(url).endsWith('/search'))
      return response({ results: [{ url: source.url, title: source.title }] });
    if (String(url).endsWith('/extract'))
      return response({ results: [{ url: source.url, raw_content: source.content }] });
    const sent = JSON.stringify(body.messages);
    assert.ok(!sent.includes('private-health-history'));
    assert.ok(!sent.includes('local-food-reference'));
    assert.ok(sent.includes('Arroz'));
    return response({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(recipe) } }],
    });
  };
  const result = await suggestRecipe(
    {
      request: 'una receta con arroz',
      pantry: stock,
      history: [{ role: 'user', content: 'private-health-history' }],
    },
    { credentials, fetcher },
  );
  assert.match(result, /2 porciones/);
  assert.match(result, /Para comprar:\n• Arroz: 50 g/);
  assert.match(result, /https:\/\/www.example.com\/arroz/);
  assert.equal(calls.length, 3);
  assert.deepEqual(stock, before);
});

test('missing keys, exhausted search quotas and cancellation do not trigger generation', async () => {
  await assert.rejects(
    suggestRecipe(
      { request: 'receta', pantry: [] },
      {
        credentials: { ...credentials, groqApiKey: '' },
        fetcher: async () => {
          assert.fail('missing key');
        },
      },
    ),
    /Añade las claves/,
  );
  let calls = 0;
  await assert.rejects(
    suggestRecipe(
      { request: 'receta', pantry: [] },
      {
        credentials,
        fetcher: async () => {
          calls++;
          return new Response('', { status: 429 });
        },
      },
    ),
    (error: unknown) => error instanceof CloudError && error.code === 'quota',
  );
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    suggestRecipe(
      { request: 'receta', pantry: [], signal: controller.signal },
      {
        credentials,
        fetcher: async () => {
          assert.fail('cancelled request');
        },
      },
    ),
    (error: unknown) => error instanceof CloudError && error.code === 'cancelled',
  );
});

test('recipe follow-ups retain only recipe context and keep a large pantry and pages bounded', async () => {
  const stock = Array.from({ length: 200 }, (_, index) =>
    item({ id: `item-${index}`, name: `Ingrediente ${index}` }),
  );
  let query = '';
  let sentLength = 0;
  const plainRecipe = { ...recipe, ingredients: [{ ...recipe.ingredients[0], pantryItemId: '' }] };
  const fetcher: typeof fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (String(url).endsWith('/search')) {
      query = body.query;
      return response({ results: [{ url: source.url, title: source.title }] });
    }
    if (String(url).endsWith('/extract'))
      return response({
        results: [
          {
            url: source.url,
            raw_content: 'navegación '.repeat(1_000) + source.content.repeat(300),
          },
        ],
      });
    sentLength = JSON.stringify(body.messages).length;
    const context = JSON.parse(body.messages[1].content);
    assert.match(context.request, /pollo al horno/);
    assert.match(context.request, /sin arroz/);
    assert.ok(context.pantry.length < stock.length);
    assert.ok(
      context.sources[0].content.startsWith('navegación') ||
        context.sources[0].content.includes('Ingredientes'),
    );
    assert.ok(context.sources[0].content.length <= 2_600);
    assert.equal(body.max_completion_tokens, 2_200);
    return response({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plainRecipe) } }],
    });
  };
  await suggestRecipe(
    { request: 'y sin arroz', previousRequest: 'una receta de pollo al horno', pantry: stock },
    { credentials, fetcher },
  );
  assert.match(query, /pollo al horno/);
  assert.match(query, /sin arroz/);
  assert.ok(sentLength < 12_000);
});
