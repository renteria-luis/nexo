import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';
import { listContainers } from '../nutrition/index.ts';

import { addToDailyLog, readDailyLog } from './daily-log.ts';
import { parseWaterTaps, serializeWaterTaps, undoLastTap } from './water-taps.ts';

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

const DAY = '2026-10-03';

test('los botones de agua son 150, 300 y 710 ml, en ese orden', async () => {
  const containers = await listContainers(fresh());
  assert.deepEqual(
    containers.map((container) => container.volume_ml),
    [150, 300, 710],
  );
});

test('deshacer quita el ultimo toque, y otra vez el de antes, hasta el primero', async () => {
  const db = fresh();
  let taps: number[] = [];
  for (const ml of [710, 150, 300]) {
    taps = [...taps, ml];
    await addToDailyLog(db, DAY, { waterMl: ml });
  }

  const undone: number[] = [];
  for (;;) {
    const step = undoLastTap(taps);
    if (step === null) break;
    taps = step.taps;
    undone.push(step.ml);
    await addToDailyLog(db, DAY, { waterMl: -step.ml });
    if (undone.length === 1) assert.equal((await readDailyLog(db, DAY))?.water_ml, 860);
  }

  assert.deepEqual(undone, [300, 150, 710]);
  assert.equal((await readDailyLog(db, DAY))?.water_ml, 0);
});

test('los toques guardados valen solo para su dia', () => {
  const stored = serializeWaterTaps(DAY, [710, 150]);

  assert.deepEqual(parseWaterTaps(stored, DAY), [710, 150]);
  // Al dia siguiente no hay nada que deshacer: ayer quedo como quedo.
  assert.deepEqual(parseWaterTaps(stored, '2026-10-04'), []);
  assert.deepEqual(parseWaterTaps(undefined, DAY), []);
  assert.deepEqual(parseWaterTaps('{roto', DAY), []);
});
