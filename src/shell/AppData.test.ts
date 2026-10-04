import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { migrations } from '../db/migrations/index.ts';
import { todayIso } from '../core/dates.ts';
import { nodes, renderModule } from '../ui/test-render.ts';

function providerFixture() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  migrations.forEach((migration) => raw.exec(migration.sql));
  const db = {
    getAllAsync: async (sql: string, params: any[] = []) => raw.prepare(sql).all(...params),
    getFirstAsync: async (sql: string, params: any[] = []) =>
      raw.prepare(sql).get(...params) ?? null,
    runAsync: async (sql: string, params: any[] = []) => raw.prepare(sql).run(...params),
    withTransactionAsync: async (work: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await work();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
  let loads = 0;
  const screen = renderModule('src/shell/AppData.tsx', {
    '../db/index.ts': { openDatabase: async () => db },
    './backup-file.ts': {},
    './location.ts': {},
    './notifications.ts': { listenToNudges: () => () => {}, syncNudges() {} },
    './deals.ts': { dealsDue: () => false },
    './load.ts': {
      REREAD_NOTHING: { deals: false, foods: false },
      load: async () => {
        loads += 1;
        return { today: { date: todayIso() }, settings: new Map(), dealSources: [] };
      },
      withFresh: (_current: unknown, fresh: unknown) => fresh,
    },
  }).mount('AppDataProvider');
  const actions = async () => {
    const tree = await screen.settle();
    return nodes(tree).find((node) => node.type === 'Provider')!.props.value;
  };
  return { raw, db, screen, actions, loads: () => loads };
}

test('pantry and recipe actions await their writes without reloading unrelated data', async () => {
  const { raw, screen, actions, loads } = providerFixture();
  const app = await actions();
  const baseline = loads();
  await app.savePantryItem({
    id: 'test-rice',
    name: 'Rice',
    kind: 'weighed',
    quantity: 500,
    unit: 'g',
    foodId: null,
  });
  await app.saveRecipe({
    id: 'test-recipe',
    name: 'Rice pot',
    portions: 2,
    steps: '',
    ingredients: [{ itemId: 'test-rice', amount: 100 }],
  });
  await screen.settle();
  assert.equal(loads(), baseline);
  assert.equal(
    raw.prepare('SELECT name FROM pantry_recipe WHERE id = ?').get('test-recipe')?.name,
    'Rice pot',
  );
  await app.removeRecipe('test-recipe');
  const removal = await app.removePantryItem('test-rice');
  assert.ok(removal);
  await screen.settle();
  assert.equal(loads(), baseline);
  await assert.rejects(
    app.saveRecipe({ id: 'bad', name: 'Bad', portions: 0, steps: '', ingredients: [] }),
  );
});

test('cooking still reloads the new batch into the app', async () => {
  const { raw, screen, actions, loads } = providerFixture();
  const app = await actions();
  await app.savePantryItem({
    id: 'chicken',
    name: 'Chicken',
    kind: 'weighed',
    quantity: 500,
    unit: 'g',
    foodId: 'chicken-breast-kirkland',
  });
  await app.saveRecipe({
    id: 'pot',
    name: 'Chicken pot',
    portions: 2,
    steps: '',
    ingredients: [{ itemId: 'chicken', amount: 200 }],
  });
  const baseline = loads();
  const cooked = await app.cookRecipe('pot');
  assert.ok(cooked.batchId);
  await screen.settle();
  assert.equal(loads(), baseline + 1);
  assert.ok(raw.prepare('SELECT id FROM nutrition_batch WHERE id = ?').get(cooked.batchId));
});

test('experiment actions save readings and finish without global reloads', async () => {
  const { raw, screen, actions, loads } = providerFixture();
  const app = await actions();
  const baseline = loads();
  await app.beginExperiment({
    name: 'Sleep',
    hypothesis: 'More sleep helps',
    variableChanged: 'Bedtime',
    outcomeMetric: 'Morning 1 to 10',
    startDate: todayIso(),
  });
  const id = raw.prepare('SELECT id FROM core_experiment').get()!.id;
  await app.logExperimentReading(id, todayIso(), 8);
  await app.finishExperiment(id, todayIso());
  await screen.settle();
  assert.equal(loads(), baseline);
  assert.equal(raw.prepare('SELECT value FROM core_experiment_reading').get()!.value, 8);
  assert.equal(raw.prepare('SELECT end_date FROM core_experiment').get()!.end_date, todayIso());
});
