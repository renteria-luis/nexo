import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';

import { addReading, endExperiment, listExperiments, startExperiment } from './experiments.ts';

type SqlValue = string | number | null;

function fresh(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  return {
    getAllAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T[]> =>
      raw.prepare(source).all(...params) as T[],
    getFirstAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T | null> =>
      (raw.prepare(source).get(...params) as T) ?? null,
    runAsync: async (source: string, params: SqlValue[] = []) => {
      raw.prepare(source).run(...params);
      return { changes: 0, lastInsertRowId: 0 };
    },
  } as unknown as SQLiteDatabase;
}

const DAIRY = {
  name: 'Fuera la leche 1%',
  hypothesis: 'La leche empeora mi piel',
  variableChanged: 'Leche 1% cambiada por bebida sin lacteos',
  startDate: '2026-09-01',
  outcomeMetric: 'Piel de 0 a 5, una vez por semana',
};

test('an experiment needs a hypothesis and one variable', async () => {
  const db = fresh();
  await assert.rejects(() => startExperiment(db, { ...DAIRY, hypothesis: '  ' }), /hypothesis/);
  await assert.rejects(() => startExperiment(db, { ...DAIRY, variableChanged: '' }), /variable/);
});

test('weekly readings pile up and the last one of a day wins', async () => {
  const db = fresh();
  const id = await startExperiment(db, DAIRY);

  await addReading(db, id, '2026-09-01', 2);
  await addReading(db, id, '2026-09-08', 3);
  await addReading(db, id, '2026-09-08', 4, 'me confundi');

  const [running] = await listExperiments(db, '2026-09-15');
  assert.equal(running.readings.length, 2);
  assert.equal(running.readings[1].value, 4);
  assert.equal(running.readings[1].note, 'me confundi');
  assert.equal(running.weeksRunning, 2);
  // Two readings is not two halves.
  assert.equal(running.halves, null);
});

test('with enough readings it compares the first half against the second', async () => {
  const db = fresh();
  const id = await startExperiment(db, DAIRY);
  const values: [string, number][] = [
    ['2026-09-01', 2],
    ['2026-09-08', 2],
    ['2026-09-15', 4],
    ['2026-09-22', 4],
  ];
  for (const [date, value] of values) await addReading(db, id, date, value);

  const [experiment] = await listExperiments(db, '2026-09-29');
  assert.deepEqual(experiment.halves, { first: 2, second: 4 });
});

test('an experiment cannot end before it started', async () => {
  const db = fresh();
  const id = await startExperiment(db, DAIRY);
  await assert.rejects(() => endExperiment(db, id, '2026-08-01'), /before it started/);

  await endExperiment(db, id, '2026-10-27');
  const [done] = await listExperiments(db, '2026-12-01');
  assert.equal(done.experiment.end_date, '2026-10-27');
  // It stopped counting weeks when it ended, not today.
  assert.equal(done.weeksRunning, 8);
});
