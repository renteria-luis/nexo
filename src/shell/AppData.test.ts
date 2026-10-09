import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { migrations } from '../db/migrations/index.ts';
import { todayIso } from '../core/dates.ts';
import { nodes, renderModule } from '../ui/test-render.ts';

function providerFixture({ initialUrl = null }: { initialUrl?: string | null } = {}) {
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
  let appStateListener: (state: string) => void = () => {};
  let linkListener: (event: { url: string }) => void = () => {};
  const requests: { settle: boolean; reread: unknown }[] = [];
  const screen = renderModule('src/shell/AppData.tsx', {
    'react-native': {
      AppState: {
        currentState: 'active',
        addEventListener: (_event: string, listener: (state: string) => void) => {
          appStateListener = listener;
          return { remove() {} };
        },
      },
      Linking: {
        getInitialURL: async () => initialUrl,
        addEventListener: (_event: string, listener: (event: { url: string }) => void) => {
          linkListener = listener;
          return { remove() {} };
        },
      },
    },
    '../db/index.ts': { openDatabase: async () => db },
    './backup-file.ts': {},
    './location.ts': {},
    './notifications.ts': { listenToNudges: () => () => {}, syncNudges() {}, flushNudges() {} },
    './deals.ts': { dealsDue: () => false },
    './load.ts': {
      REREAD_NOTHING: { deals: false, foods: false },
      REREAD_ALL: { deals: true, foods: true },
      load: async (_db: unknown, _exercise: unknown, settle: boolean, reread: unknown) => {
        loads += 1;
        requests.push({ settle, reread });
        const session =
          raw.prepare('SELECT * FROM training_session ORDER BY start_time DESC LIMIT 1;').get() ??
          null;
        return {
          today: { date: todayIso(), session },
          settings: new Map(
            raw
              .prepare('SELECT key,value FROM core_setting')
              .all()
              .map((row) => [row.key, row.value]),
          ),
          dealSources: [],
        };
      },
      withFresh: (_current: unknown, fresh: unknown) => fresh,
    },
  }).mount('AppDataProvider');
  const actions = async () => {
    const tree = await screen.settle();
    return nodes(tree).find((node) => node.type === 'Provider')!.props.value;
  };
  return {
    raw,
    db,
    screen,
    actions,
    loads: () => loads,
    requests,
    appState: (state: string) => appStateListener(state),
    openLink: (url: string) => linkListener({ url }),
  };
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
  const sessionId = app.state.loaded.today.session.id;
  const edit = await app.loadTrainingPlan(sessionId, 'pull');
  await assert.rejects(app.saveTrainingPlan(edit), /plan failure/);
  await screen.settle();
  assert.equal((await actions()).state.loaded.today.session.routine_id, 'push');
  assert.equal(raw.prepare('SELECT routine_id FROM training_session;').get()!.routine_id, 'push');
  raw.exec('DROP TRIGGER reject_plan;');
  await app.saveTrainingPlan(edit);
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

test('custom scale saving survives rereading and failures preserve the last saved palette', async () => {
  const { raw, actions, loads } = providerFixture();
  const app = await actions();
  const baseline = loads();
  const scale = { palette: 'blue', lowMax: 20, mediumMax: 60, topMin: 90 };
  await app.saveScoreScale(scale);
  assert.equal(loads(), baseline, 'presentation changes do not reload or rescore days');
  assert.deepEqual(JSON.parse((await actions()).state.loaded.settings.get('score_scale')), scale);
  assert.deepEqual(
    JSON.parse(
      String(raw.prepare("SELECT value FROM core_setting WHERE key = 'score_scale'").get()!.value),
    ),
    scale,
  );
  await app.refreshData();
  assert.deepEqual(JSON.parse((await actions()).state.loaded.settings.get('score_scale')), scale);
  raw.exec(
    "CREATE TRIGGER reject_color BEFORE INSERT ON core_setting WHEN NEW.key = 'score_scale' BEGIN SELECT RAISE(ABORT, 'storage failure'); END;",
  );
  await assert.rejects(app.saveScoreScale({ ...scale, palette: 'pink' }), /storage failure/);
  assert.deepEqual(JSON.parse((await actions()).state.loaded.settings.get('score_scale')), scale);
  await assert.rejects(app.saveScoreScale({ ...scale, lowMax: 80 }), /orden/);
});

test('manual refresh shares one read, skips settled history and keeps provider actions stable', async () => {
  const { actions, loads, requests } = providerFixture();
  const app = await actions();
  const baseline = loads();
  const first = app.refreshData();
  assert.equal(first, app.refreshData());
  await first;
  const fresh = await actions();
  assert.equal(loads(), baseline + 1);
  assert.equal(requests.at(-1)!.settle, false);
  assert.deepEqual(requests.at(-1)!.reread, { settle: false, foods: true, deals: true });
  assert.equal(fresh.refreshData, app.refreshData);
  assert.equal(fresh.loadScoreDays, app.loadScoreDays);
  assert.equal(fresh.dataRevision, app.dataRevision + 1);
});

test('an active midnight updates an empty day; background time waits until resume', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(2026, 9, 8, 23, 59, 59) });
  const { actions, appState, loads } = providerFixture();
  assert.equal((await actions()).state.loaded.today.date, '2026-10-08');
  t.mock.timers.tick(1000);
  assert.equal((await actions()).state.loaded.today.date, '2026-10-09');
  const baseline = loads();
  appState('background');
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  assert.equal(loads(), baseline);
  appState('active');
  assert.equal((await actions()).state.loaded.today.date, '2026-10-10');
});

/** Lo que hace un enlace pasa por varias lecturas y escrituras: se espera a que se vea. */
async function until(actions: () => Promise<any>, seen: (app: any) => boolean) {
  for (let i = 0; i < 30; i++) {
    const app = await actions();
    if (seen(app)) return app;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('the provider never got there');
}

test('a Shortcut link that opens the app is saved and reported once, with one light reload', async () => {
  const { raw, actions, requests } = providerFixture({
    initialUrl: 'nexo://salud?sueno=7.5&pasos=8123',
  });
  const app = await until(actions, (current) => current.healthArrival !== null);
  assert.deepEqual(
    app.healthArrival.results.map((result: { outcome: string }) => result.outcome),
    ['saved', 'saved'],
  );
  assert.equal(app.healthArrival.problem, null);
  const day = raw.prepare('SELECT * FROM core_daily_log WHERE date = ?;').get(todayIso())!;
  assert.equal(day.sleep_minutes, 450);
  assert.equal(day.sleep_source, 'autosleep');
  assert.equal(day.steps, 8123);
  assert.equal(requests.at(-1)?.settle, false);
  app.dismissHealthArrival();
  assert.equal((await actions()).healthArrival, null);
});

test('a link over a value typed by hand waits for his answer, either way', async () => {
  const { raw, actions, openLink } = providerFixture();
  raw
    .prepare('INSERT INTO core_daily_log (date, steps, rest_day, has_data) VALUES (?, 5000, 0, 1);')
    .run(todayIso());
  await actions();
  openLink('nexo://salud?pasos=9000');
  let app = await until(actions, (current) => current.healthArrival !== null);
  assert.deepEqual(
    app.healthArrival.results.map((result: { outcome: string; current: number }) => [
      result.outcome,
      result.current,
    ]),
    [['conflict', 5000]],
  );
  await app.answerHealthConflict('steps', false);
  app = await until(actions, (current) => current.healthArrival.results[0].outcome === 'kept');
  const steps = () =>
    raw.prepare('SELECT steps FROM core_daily_log WHERE date = ?;').get(todayIso())!.steps;
  assert.equal(steps(), 5000);

  openLink('nexo://salud?pasos=9000');
  app = await until(actions, (current) => current.healthArrival.results[0].outcome === 'conflict');
  const second = app.healthArrival.id;
  await app.answerHealthConflict('steps', true);
  app = await until(actions, (current) => current.healthArrival.results[0].outcome === 'saved');
  assert.equal(app.healthArrival.id, second);
  assert.equal(steps(), 9000);
});

test('other links are ignored and malformed ones are reported without writing', async () => {
  const { raw, actions, openLink } = providerFixture();
  await actions();
  openLink('https://example.com/');
  assert.equal((await actions()).healthArrival, null);
  openLink('nexo://salud?pasos=muchos');
  const app = await until(actions, (current) => current.healthArrival !== null);
  assert.match(app.healthArrival.problem, /no son un número/);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM core_health_import;').get()!.n, 0);
});
