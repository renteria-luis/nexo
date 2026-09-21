import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';

import { exportBackup, importBackup, parseBackup, BACKUP_FORMAT } from './backup.ts';
import { upsertDailyLog } from './daily-log.ts';

type SqlValue = string | number | null;

function adapt(raw: DatabaseSync): SQLiteDatabase {
  return {
    getAllAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T[]> =>
      raw.prepare(source).all(...params) as T[],
    getFirstAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T | null> =>
      (raw.prepare(source).get(...params) as T) ?? null,
    runAsync: async (source: string, params: SqlValue[] = []) => {
      raw.prepare(source).run(...params);
      return { changes: 0, lastInsertRowId: 0 };
    },
    execAsync: async (source: string) => {
      raw.exec(source);
    },
    withTransactionAsync: async (work: () => Promise<void>) => {
      raw.exec('BEGIN;');
      try {
        await work();
        raw.exec('COMMIT;');
      } catch (error) {
        raw.exec('ROLLBACK;');
        throw error;
      }
    },
  } as unknown as SQLiteDatabase;
}

function fresh(): { db: SQLiteDatabase; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(`CREATE TABLE core_migration (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);`);
  for (const migration of migrations) {
    raw.exec(migration.sql);
    raw.prepare('INSERT INTO core_migration (id, applied_at) VALUES (?, ?);').run(migration.id, 1);
  }
  return { db: adapt(raw), raw };
}

test('what comes out of a phone goes back into another one unchanged', async () => {
  const source = fresh();
  await upsertDailyLog(source.db, {
    date: '2026-09-20',
    sleepMinutes: 450,
    sleepSource: 'manual',
    steps: 8200,
  });
  const backup = await exportBackup(source.db);

  // The file is what travels, so the test travels through it too.
  const travelled = parseBackup(JSON.parse(JSON.stringify(backup)));

  const target = fresh();
  await upsertDailyLog(target.db, {
    date: '2026-09-20',
    sleepMinutes: 1,
    sleepSource: 'manual',
    steps: 1,
  });
  const result = await importBackup(target.db, travelled);

  const restored = target.raw
    .prepare('SELECT sleep_minutes, steps FROM core_daily_log WHERE date = ?;')
    .get('2026-09-20') as { sleep_minutes: number; steps: number };

  assert.equal(restored.sleep_minutes, 450);
  assert.equal(restored.steps, 8200);
  assert.ok(result.rows > 0);
  assert.deepEqual(result.skipped, []);
});

test('the seeded catalogue survives a restore instead of being wiped', async () => {
  const source = fresh();
  const backup = await exportBackup(source.db);

  const target = fresh();
  await importBackup(target.db, backup);

  const foods = target.raw.prepare('SELECT count(*) AS n FROM nutrition_food;').get() as {
    n: number;
  };
  assert.equal(foods.n, 12);
});

test('a backup from a newer version of the app is refused, not half applied', async () => {
  const { db } = fresh();
  const backup = await exportBackup(db);
  backup.migrations = [...backup.migrations, '999_from_the_future'];

  await assert.rejects(() => importBackup(db, backup), /mas nueva/);
});

test('a file that is not a nexo backup says so', () => {
  assert.throws(() => parseBackup({ format: 'otra-cosa', version: 1 }), /no un respaldo/);
  assert.throws(() => parseBackup({ format: BACKUP_FORMAT, version: 99 }), /version/);
  assert.throws(() => parseBackup('{}'), /no es un objeto/);
});
