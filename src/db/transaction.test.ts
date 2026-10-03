import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { consumeBatchPortion, createBatch, deleteFoodEntry } from '../nutrition/queries.ts';

import { migrations } from './migrations/index.ts';

type SqlValue = string | number | null;

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Como expo-sqlite en el telefono: una sola conexion, cada llamada cede el turno antes de
 * correr, y una transaccion es BEGIN, la tarea y COMMIT, con ROLLBACK si algo falla. Asi
 * dos escrituras lanzadas casi a la vez se intercalan como alli.
 */
function likeExpo(raw: DatabaseSync): SQLiteDatabase {
  const exec = async (source: string) => {
    await tick();
    raw.exec(source);
  };
  return {
    getAllAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T[]> => {
      await tick();
      return raw.prepare(source).all(...params) as T[];
    },
    getFirstAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T | null> => {
      await tick();
      return (raw.prepare(source).get(...params) as T) ?? null;
    },
    runAsync: async (source: string, params: SqlValue[] = []) => {
      await tick();
      const result = raw.prepare(source).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    execAsync: exec,
    withTransactionAsync: async (task: () => Promise<void>) => {
      try {
        await exec('BEGIN;');
        await task();
        await exec('COMMIT;');
      } catch (error) {
        await exec('ROLLBACK;');
        throw error;
      }
    },
  } as unknown as SQLiteDatabase;
}

async function batchOfEight(): Promise<{ db: SQLiteDatabase; raw: DatabaseSync; batchId: string }> {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  const db = likeExpo(raw);
  const batchId = await createBatch(db, {
    foodId: 'chicken-breast-kirkland',
    rawWeightG: 1600,
    portionsCount: 8,
    cookedDate: '2026-10-03',
    fatDrained: false,
  });
  return { db, raw, batchId };
}

function state(raw: DatabaseSync, batchId: string) {
  const entries = raw
    .prepare('SELECT count(*) AS n FROM nutrition_food_entry WHERE batch_id = ?;')
    .get(batchId) as { n: number };
  const batch = raw
    .prepare('SELECT portions_remaining AS left FROM nutrition_batch WHERE id = ?;')
    .get(batchId) as { left: number };
  return { entries: entries.n, left: batch.left };
}

test('dos porciones pedidas casi a la vez entran las dos, empiece cuando empiece la segunda', async () => {
  for (let offset = 0; offset <= 12; offset += 1) {
    const { db, raw, batchId } = await batchOfEight();

    const first = consumeBatchPortion(db, batchId, '2026-10-03', 'mediodía');
    for (let turn = 0; turn < offset; turn += 1) await tick();
    const second = consumeBatchPortion(db, batchId, '2026-10-03', 'mediodía');
    const outcomes = await Promise.allSettled([first, second]);

    assert.deepEqual(
      outcomes.map((outcome) => outcome.status),
      ['fulfilled', 'fulfilled'],
      `segunda a ${offset} turnos`,
    );
    assert.deepEqual(state(raw, batchId), { entries: 2, left: 6 }, `segunda a ${offset} turnos`);
  }
});

test('borrar una porcion mientras se come otra deja la tanda cuadrada', async () => {
  for (let offset = 0; offset <= 12; offset += 1) {
    const { db, raw, batchId } = await batchOfEight();
    const eaten = await consumeBatchPortion(db, batchId, '2026-10-03', 'mediodía');

    const removing = deleteFoodEntry(db, eaten);
    for (let turn = 0; turn < offset; turn += 1) await tick();
    const eating = consumeBatchPortion(db, batchId, '2026-10-03', 'cena');
    await Promise.all([removing, eating]);

    assert.deepEqual(state(raw, batchId), { entries: 1, left: 7 }, `a ${offset} turnos`);
  }
});
