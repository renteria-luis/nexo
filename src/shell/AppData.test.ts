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
        const session =
          raw.prepare('SELECT * FROM training_session ORDER BY start_time DESC LIMIT 1;').get() ??
          null;
        return { today: { date: todayIso(), session }, settings: new Map(), dealSources: [] };
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

test('starting from the provider shares one pending write and permits retry after failure', async () => {
  const { raw, actions } = providerFixture();
  const app = await actions();
  const plan = await app.loadPlan('push', 'completo', 'fanshawe');
  raw.exec(
    "CREATE TRIGGER reject_plan BEFORE INSERT ON training_session_plan BEGIN SELECT RAISE(ABORT, 'storage failure'); END;",
  );
  const first = app.beginSession('push', 'completo', plan.exercises, 'alone', 'fanshawe');
  const second = app.beginSession('push', 'completo', plan.exercises, 'alone', 'fanshawe');
  assert.equal(first, second);
  await assert.rejects(first, /storage failure/);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM training_session;').get()!.n, 0);
  raw.exec('DROP TRIGGER reject_plan;');
  await app.beginSession('push', 'completo', plan.exercises, 'alone', 'fanshawe');
  await app.beginSession('push', 'completo', plan.exercises, 'alone', 'fanshawe');
  assert.equal(raw.prepare('SELECT count(*) AS n FROM training_session;').get()!.n, 1);
});

test('routine, finish and reopen failures reach the caller without painting a false result', async () => {
  const { raw, actions, screen } = providerFixture();
  let app = await actions();
  const plan = await app.loadPlan('push', 'completo', 'fanshawe');
  await app.beginSession('push', 'completo', plan.exercises, 'alone', 'fanshawe');
  app = await actions();
  raw.exec(
    "CREATE TRIGGER reject_plan BEFORE INSERT ON training_session_plan BEGIN SELECT RAISE(ABORT, 'plan failure'); END;",
  );
  await assert.rejects(app.switchRoutine('pull'), /plan failure/);
  await screen.settle();
  assert.equal((await actions()).state.loaded.today.session.routine_id, 'push');
  assert.equal(raw.prepare('SELECT routine_id FROM training_session;').get()!.routine_id, 'push');
  raw.exec('DROP TRIGGER reject_plan;');
  await app.switchRoutine('pull');
  app = await actions();
  assert.equal(app.state.loaded.today.session.routine_id, 'pull');
  raw.exec(
    "CREATE TRIGGER reject_close BEFORE UPDATE OF end_time ON training_session BEGIN SELECT RAISE(ABORT, 'close failure'); END;",
  );
  await assert.rejects(app.endSession(), /close failure/);
  assert.equal(raw.prepare('SELECT end_time FROM training_session;').get()!.end_time, null);
  raw.exec('DROP TRIGGER reject_close;');
  await app.endSession();
  app = await actions();
  const finished = app.state.loaded.today.session.end_time;
  assert.ok(finished);
  raw.exec(
    "CREATE TRIGGER reject_reopen BEFORE UPDATE OF end_time ON training_session BEGIN SELECT RAISE(ABORT, 'reopen failure'); END;",
  );
  await assert.rejects(app.reopenSession(), /reopen failure/);
  assert.equal(raw.prepare('SELECT end_time FROM training_session;').get()!.end_time, finished);
  raw.exec('DROP TRIGGER reject_reopen;');
  await app.reopenSession();
  assert.equal(raw.prepare('SELECT end_time FROM training_session;').get()!.end_time, null);
});
