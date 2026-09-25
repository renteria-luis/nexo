import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { upsertDailyLog } from '../core/daily-log.ts';
import { writeSetting } from '../core/settings.ts';
import { writeTargetSnapshot } from '../core/snapshots.ts';
import { computeTargets, type TargetProfile } from '../core/targets.ts';
import { migrations } from '../db/migrations/index.ts';

import { assembleDay } from './day.ts';

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

const profile: TargetProfile = {
  heightCm: 170,
  birthDate: '1996-08-30',
  activityFactor: 1.58,
  phase: 'recomp',
  sleepMinutes: 420,
  steps: 7000,
};

const TODAY = '2026-09-13';

async function fixture(): Promise<{ db: SQLiteDatabase; raw: DatabaseSync }> {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);

  const db = adapt(raw);
  await writeTargetSnapshot(db, computeTargets(73, profile, '2026-09-01'), '2026-09-01');
  return { db, raw };
}

test('a day with nothing logged has no score at all', async () => {
  const { db } = await fixture();
  const day = await assembleDay(db, TODAY, TODAY);

  assert.equal(day.log, null);
  assert.equal(day.result?.score, null);
  assert.ok(day.targets);
});

test('logging three things is enough for the day to get a score', async () => {
  const { db } = await fixture();
  await upsertDailyLog(db, {
    date: TODAY,
    sleepMinutes: 430,
    sleepSource: 'autosleep',
    waterMl: 2800,
    creatineTaken: true,
  });

  const day = await assembleDay(db, TODAY, TODAY);
  assert.ok(day.result?.score !== null);
  assert.equal(day.result?.criteriaWithData, 3);
});

test('nothing eaten leaves the food criteria without data, not at zero grams', async () => {
  const { db } = await fixture();
  await upsertDailyLog(db, { date: TODAY, waterMl: 2800, steps: 7200, creatineTaken: true });

  const day = await assembleDay(db, TODAY, TODAY);
  assert.equal(day.nutrition, null);

  const protein = day.result?.criteria.find((c) => c.id === 'protein');
  const calories = day.result?.criteria.find((c) => c.id === 'calories');
  assert.equal(protein?.fraction, null);
  assert.equal(calories?.fraction, null);
  // Agua, pasos y creatina, los tres llenos: 8 + 8 + 6 de los cien del dia. Los 78
  // que faltan no son un suspenso, son seis cosas sin anotar.
  assert.equal(day.result?.score, 22);
  assert.equal(day.result?.pointsWithoutData, 78);
});

test('what was eaten reaches the grid through the nutrition module', async () => {
  const { db, raw } = await fixture();
  await upsertDailyLog(db, { date: TODAY, waterMl: 2800, creatineTaken: true });
  raw.exec(`
    INSERT INTO nutrition_food_entry (id, food_id, quantity, unit, timestamp, date, meal_slot)
    VALUES ('e1', 'eggs-large', 6, 'huevo', 1000, '${TODAY}', 'desayuno');
  `);

  const day = await assembleDay(db, TODAY, TODAY);
  assert.equal(day.nutrition?.proteinG, 39);

  const protein = day.result?.criteria.find((c) => c.id === 'protein');
  // 39 g is well under the band, so it scores zero rather than being skipped.
  assert.equal(protein?.fraction, 0);
});

test('a day still open has not failed to train; a day already past has', async () => {
  const { db } = await fixture();
  await upsertDailyLog(db, { date: TODAY, waterMl: 2800, creatineTaken: true, steps: 7000 });

  const stillOpen = await assembleDay(db, TODAY, TODAY);
  assert.equal(stillOpen.trained, null);

  const closed = await assembleDay(db, TODAY, '2026-09-14');
  assert.equal(closed.trained, false);
});

test('a logged session marks the day as trained', async () => {
  const { db, raw } = await fixture();
  raw.exec(
    `INSERT INTO training_session (id, date, time_budget) VALUES ('s1', '${TODAY}', 'completo');`,
  );
  await upsertDailyLog(db, { date: TODAY, waterMl: 3500, creatineTaken: true });

  const day = await assembleDay(db, TODAY, TODAY);
  assert.equal(day.trained, true);
  assert.equal(day.result?.criteria.find((c) => c.id === 'trained')?.fraction, 1);
});

test('re-entry reaches the day through the settings, not through a flag passed by hand', async () => {
  const { db } = await fixture();
  await upsertDailyLog(db, { date: TODAY, waterMl: 2800, creatineTaken: true, steps: 7000 });

  const before = await assembleDay(db, TODAY, TODAY);
  assert.equal(before.reEntryActive, false);

  await writeSetting(db, 're_entry_started_on', '2026-09-05');
  const during = await assembleDay(db, TODAY, TODAY);
  assert.equal(during.reEntryActive, true);
});

test('a day before any snapshot cannot be scored', async () => {
  const { db } = await fixture();
  await upsertDailyLog(db, { date: '2026-08-20', waterMl: 2800, creatineTaken: true, steps: 7000 });

  const day = await assembleDay(db, '2026-08-20', TODAY);
  assert.equal(day.targets, null);
  assert.equal(day.result, null);
});

test('drinks after training cost half again, through the stored flag', async () => {
  const { db } = await fixture();
  const base = { date: TODAY, waterMl: 2800, creatineTaken: true, steps: 7000, alcoholDrinks: 2 };

  await upsertDailyLog(db, base);
  const plain = await assembleDay(db, TODAY, TODAY);

  await upsertDailyLog(db, { date: TODAY, alcoholAfterTraining: true });
  const afterTraining = await assembleDay(db, TODAY, TODAY);

  // Agua, creatina, pasos y alcohol anotados: 8 + 6 + 8 + 10 = 32 puntos en juego.
  // Dos tragos cuestan 2 de los diez del alcohol, asi que el dia queda en 30.
  assert.equal(plain.result?.score, 30);
  // Los mismos dos tragos dentro de las seis horas de una sesion cuestan 3.
  assert.equal(afterTraining.result?.score, 29);
});
