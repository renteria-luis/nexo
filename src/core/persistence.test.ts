import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';
import {
  consecutiveMissedBefore,
  listSessionDates,
  sessionsInTrailingWeek,
  trainedOn,
} from '../training/history.ts';

import {
  listDailyLogs,
  readDailyLog,
  sleepMinutesFrom,
  storeScore,
  toDisciplineDay,
  toWeighIns,
  upsertDailyLog,
} from './daily-log.ts';
import { scoreDay } from './discipline.ts';
import {
  latestTargetChange,
  setInitialTargets,
  recalculateTargets,
  targetsInForceOn,
  writeTargetSnapshot,
} from './snapshots.ts';
import { computeTargets, type TargetProfile } from './targets.ts';

type SqlValue = string | number | null;

function adapt(db: DatabaseSync): SQLiteDatabase {
  return {
    getAllAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T[]> =>
      db.prepare(source).all(...params) as T[],
    getFirstAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T | null> =>
      (db.prepare(source).get(...params) as T) ?? null,
    runAsync: async (source: string, params: SqlValue[] = []) => {
      db.prepare(source).run(...params);
      return { changes: 0, lastInsertRowId: 0 };
    },
  } as unknown as SQLiteDatabase;
}

function fresh(): { db: SQLiteDatabase; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  return { db: adapt(raw), raw };
}

const profile: TargetProfile = {
  heightCm: 170,
  birthDate: '1996-08-30',
  activityFactor: 1.55,
  phase: 'recomp',
  sleepMinutes: 420,
  steps: 7000,
};

test('a day is judged against the snapshot in force then, not the one in force now', async () => {
  const { db } = fresh();

  await writeTargetSnapshot(db, computeTargets(78, profile, '2026-06-01'), '2026-06-01');
  await writeTargetSnapshot(db, computeTargets(73, profile, '2026-09-01'), '2026-09-01');

  const inJune = await targetsInForceOn(db, '2026-06-15');
  const inSeptember = await targetsInForceOn(db, '2026-09-15');

  assert.equal(inJune?.weightBasisKg, 78);
  assert.equal(inSeptember?.weightBasisKg, 73);
  assert.ok(inJune !== null && inSeptember !== null && inJune.kcal > inSeptember.kcal);
});

test('a day before the first snapshot has no targets rather than the wrong ones', async () => {
  const { db } = fresh();
  await writeTargetSnapshot(db, computeTargets(73, profile, '2026-09-01'), '2026-09-01');
  assert.equal(await targetsInForceOn(db, '2026-08-31'), null);
});

test('a snapshot on a day that already has one replaces it', async () => {
  const { db, raw } = fresh();
  await writeTargetSnapshot(db, computeTargets(73, profile, '2026-09-01'), '2026-09-01');
  await writeTargetSnapshot(db, computeTargets(75, profile, '2026-09-01'), '2026-09-01');

  const count = raw.prepare('SELECT COUNT(*) AS n FROM core_target_snapshot;').get() as {
    n: number;
  };
  assert.equal(count.n, 1);
  assert.equal((await targetsInForceOn(db, '2026-09-01'))?.weightBasisKg, 75);
});

test('recalculation happens only when the rolling average has moved a kilo', async () => {
  const { db } = fresh();
  const steady = [
    { date: '2026-09-10', weightKg: 73 },
    { date: '2026-09-11', weightKg: 73 },
    { date: '2026-09-12', weightKg: 73 },
    { date: '2026-09-13', weightKg: 73 },
  ];

  const first = await recalculateTargets(db, steady, profile, '2026-09-13');
  assert.ok(first);
  assert.equal(first.from, null);
  assert.equal(first.to.weightBasisKg, 73);

  // Same weight a day later: nothing written, nothing to announce.
  assert.equal(await recalculateTargets(db, steady, profile, '2026-09-14'), null);

  const heavier = steady.map((entry) => ({ ...entry, weightKg: 74.5 }));
  const second = await recalculateTargets(db, heavier, profile, '2026-09-14');
  assert.ok(second);
  assert.equal(second.from?.weightBasisKg, 73);
  assert.equal(second.to.weightBasisKg, 74.5);
});

test('too few weigh-ins means no recalculation at all', async () => {
  const { db } = fresh();
  const sparse = [
    { date: '2026-09-12', weightKg: 73 },
    { date: '2026-09-13', weightKg: 80 },
  ];
  assert.equal(await recalculateTargets(db, sparse, profile, '2026-09-13'), null);
});

test('logging one thing in the morning does not wipe what was logged earlier', async () => {
  const { db } = fresh();

  await upsertDailyLog(db, {
    date: '2026-09-13',
    weightKg: 73.4,
    sleepMinutes: 430,
    sleepSource: 'autosleep',
  });
  await upsertDailyLog(db, { date: '2026-09-13', waterMl: 2130 });
  await upsertDailyLog(db, { date: '2026-09-13', creatineTaken: true });

  const log = await readDailyLog(db, '2026-09-13');
  assert.equal(log?.weight_kg, 73.4);
  assert.equal(log?.sleep_minutes, 430);
  assert.equal(log?.water_ml, 2130);
  assert.equal(log?.creatine_taken, 1);
  assert.equal(log?.has_data, 1);
});

test('a day with nothing measured is marked as having no data', async () => {
  const { db } = fresh();
  await upsertDailyLog(db, { date: '2026-09-13' });
  assert.equal((await readDailyLog(db, '2026-09-13'))?.has_data, 0);

  await upsertDailyLog(db, { date: '2026-09-13', steps: 6200 });
  assert.equal((await readDailyLog(db, '2026-09-13'))?.has_data, 1);
});

test('scores are stored rounded beside the day they belong to', async () => {
  const { db } = fresh();
  await upsertDailyLog(db, { date: '2026-09-13', steps: 7200 });
  await storeScore(db, '2026-09-13', 87.6);
  assert.equal((await readDailyLog(db, '2026-09-13'))?.score, 88);

  await storeScore(db, '2026-09-13', null);
  assert.equal((await readDailyLog(db, '2026-09-13'))?.score, null);
});

test('the stored log feeds the grid and the rolling weight average', async () => {
  const { db } = fresh();
  for (const [date, weight] of [
    ['2026-09-10', 73.2],
    ['2026-09-11', 73.6],
    ['2026-09-12', 72.8],
    ['2026-09-13', 73.4],
  ] as const) {
    await upsertDailyLog(db, {
      date,
      weightKg: weight,
      sleepMinutes: 430,
      sleepSource: 'autosleep',
      waterMl: 3500,
      steps: 7400,
      creatineTaken: true,
      alcoholDrinks: 0,
    });
  }

  const logs = await listDailyLogs(db, { from: '2026-09-07', to: '2026-09-13' });
  assert.equal(logs.length, 4);
  assert.equal(toWeighIns(logs).length, 4);

  const targets = computeTargets(73.25, profile, '2026-09-13');
  const day = toDisciplineDay(logs[3], {
    trained: true,
    proteinG: 148,
    kcal: targets.kcal,
    isTrainingDay: true,
  });

  const result = scoreDay(day, targets, {
    sessionsLastSevenDays: 5,
    consecutiveMissed: 0,
    isScheduledRestDay: false,
    reEntryActive: false,
  });
  assert.equal(result.score, 100);
});

test('session history answers what the miss penalty needs', async () => {
  const { db, raw } = fresh();
  raw.exec(`
    INSERT INTO training_session (id, date, time_budget) VALUES
      ('a', '2026-09-07', 'completo'),
      ('b', '2026-09-08', 'completo'),
      ('c', '2026-09-09', 'completo');
  `);

  const dates = await listSessionDates(db, { from: '2026-08-01', to: '2026-09-13' });
  assert.deepEqual(dates, ['2026-09-07', '2026-09-08', '2026-09-09']);

  assert.equal(trainedOn(dates, '2026-09-08'), true);
  assert.equal(trainedOn(dates, '2026-09-10'), false);

  assert.equal(sessionsInTrailingWeek(dates, '2026-09-09'), 3);
  assert.equal(sessionsInTrailingWeek(dates, '2026-09-13'), 3);
  assert.equal(sessionsInTrailingWeek(dates, '2026-09-16'), 0);
});

test('the run of misses counts scheduled days and stops at the last session', () => {
  const dates = ['2026-09-07', '2026-09-08', '2026-09-09'];

  // The 10th, 11th and 12th all sat below five sessions in the trailing week.
  assert.equal(consecutiveMissedBefore(dates, '2026-09-13'), 3);
  assert.equal(consecutiveMissedBefore(dates, '2026-09-10'), 0);
});

test('a week already at five sessions leaves the following day optional', () => {
  const fullWeek = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
  // The 12th had five sessions behind it, so skipping it was not a miss and the
  // run stays at zero. Falling behind is what creates a scheduled day, not the
  // calendar.
  assert.equal(consecutiveMissedBefore(fullWeek, '2026-09-13'), 0);

  // Two more quiet days and the week drops below five, so the days start counting.
  assert.equal(consecutiveMissedBefore(fullWeek, '2026-09-16'), 2);
});

test('the first snapshot is not a change worth announcing', async () => {
  const { db } = fresh();
  await writeTargetSnapshot(db, computeTargets(73, profile, '2026-09-01'), '2026-09-01');
  assert.equal(await latestTargetChange(db), null);
});

test('the newest two snapshots are the change spec 3.6 shows', async () => {
  const { db } = fresh();
  await writeTargetSnapshot(db, computeTargets(73, profile, '2026-09-01'), '2026-09-01');
  await writeTargetSnapshot(db, computeTargets(74.5, profile, '2026-09-20'), '2026-09-20');

  const change = await latestTargetChange(db);
  assert.ok(change);
  assert.equal(change.from?.weightBasisKg, 73);
  assert.equal(change.to.weightBasisKg, 74.5);
  assert.equal(change.effectiveFrom, '2026-09-20');
});

test('a recalculated change is still there on the next load', async () => {
  const { db } = fresh();
  await writeTargetSnapshot(db, computeTargets(73, profile, '2026-09-01'), '2026-09-01');
  const heavier = ['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'].map((date) => ({
    date,
    weightKg: 74.5,
  }));

  assert.ok(await recalculateTargets(db, heavier, profile, '2026-09-20'));
  // Every write refreshes the app; the second pass writes nothing and returns null,
  // which is exactly why the card cannot depend on that return value.
  assert.equal(await recalculateTargets(db, heavier, profile, '2026-09-20'), null);
  assert.equal((await latestTargetChange(db))?.to.weightBasisKg, 74.5);
});

test('sleep is written the way he says it, in hours or in minutes', () => {
  assert.equal(sleepMinutesFrom('7.5', ''), 450);
  assert.equal(sleepMinutesFrom('', '130'), 130);
  assert.equal(sleepMinutesFrom('7', '30'), 450);
  assert.equal(sleepMinutesFrom('7,5', ''), 450);
});

test('an empty or impossible sleep entry writes nothing rather than a zero', () => {
  assert.equal(sleepMinutesFrom('', ''), null);
  assert.equal(sleepMinutesFrom('0', '0'), null);
  assert.equal(sleepMinutesFrom('-8', ''), null);
  assert.equal(sleepMinutesFrom('anoche', ''), null);
});

test('a day marked as rest is a day with data, not an empty one', async () => {
  const { db, raw } = fresh();
  await upsertDailyLog(db, { date: '2026-09-22', restDay: true });

  const row = raw
    .prepare('SELECT rest_day, has_data FROM core_daily_log WHERE date = ?;')
    .get('2026-09-22') as { rest_day: number; has_data: number };

  assert.equal(row.rest_day, 1);
  assert.equal(row.has_data, 1);
});

test('logging water later does not undo the rest day', async () => {
  const { db, raw } = fresh();
  await upsertDailyLog(db, { date: '2026-09-22', restDay: true });
  await upsertDailyLog(db, { date: '2026-09-22', waterMl: 710 });

  const row = raw
    .prepare('SELECT rest_day, water_ml FROM core_daily_log WHERE date = ?;')
    .get('2026-09-22') as { rest_day: number; water_ml: number };

  assert.equal(row.rest_day, 1);
  assert.equal(row.water_ml, 710);
});

test('lo anotado antes de llenar el perfil tambien se puede puntuar', async () => {
  const { db } = fresh();

  // Estuvo anotando cuatro dias antes de llenar el perfil.
  await upsertDailyLog(db, { date: '2026-09-20', waterMl: 2000 });
  await upsertDailyLog(db, { date: '2026-09-24', waterMl: 2000 });

  await setInitialTargets(db, 73, profile, '2026-09-24');

  // La primera foto arranca el dia del primer registro, no el dia que la creo.
  const before = await targetsInForceOn(db, '2026-09-20');
  assert.equal(before?.weightBasisKg, 73);
  assert.equal(await targetsInForceOn(db, '2026-09-19'), null);
});
