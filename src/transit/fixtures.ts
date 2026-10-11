import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { migrate } from '../db/migrate.ts';
import { SCHEDULE_SOURCE, type Schedule } from './schedule.ts';

export function scheduleFixture(): Schedule {
  return {
    schema: 1,
    source: SCHEDULE_SOURCE,
    sourceSha256: 'a'.repeat(64),
    createdAt: Date.UTC(2026, 9, 11),
    feedVersion: 'fixture',
    timezone: 'America/Toronto',
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    stops: [
      ['A', '10', 'Road NB', 43, -81],
      ['B', '11', 'Road SB', 43.0001, -81.0001],
    ],
    routes: [['02', '02', 'Route 2']],
    services: [
      ['weekday', 31, '2026-01-01', '2026-12-31'],
      ['weekend', 96, '2026-01-01', '2026-12-31'],
    ],
    exceptions: [
      ['weekday', '2026-10-12', 2],
      ['holiday', '2026-10-12', 1],
    ],
    patterns: [
      [
        [0, 1, 0, 0, 0, 1, 1, ''],
        [1, 2, 600, 660, 1, 0, 0, ''],
      ],
    ],
    trips: [
      ['weekday-late', 0, 'weekday', '2A Downtown', 0, 'shape', 0, 25 * 3600],
      ['weekend-trip', 0, 'weekend', '2B Terminal', 1, 'shape', 0, 8 * 3600],
      ['holiday-trip', 0, 'holiday', 'Holiday branch', null, 'shape', 0, 8 * 3600],
    ],
    shapes: {
      shape: [
        [43, -81, 1],
        [43.0001, -81.0001, 2],
      ],
    },
    transfers: [[0, 1, 2, 180]],
  };
}

export function adapt(raw: DatabaseSync): SQLiteDatabase {
  type Param = string | number | null;
  return {
    getAllAsync: async <T>(sql: string, params: Param[] = []) =>
      raw.prepare(sql).all(...params) as T[],
    getFirstAsync: async <T>(sql: string, params: Param[] = []) =>
      (raw.prepare(sql).get(...params) as T) ?? null,
    runAsync: async (sql: string, params: Param[] = []) => raw.prepare(sql).run(...params),
    execAsync: async (sql: string) => {
      raw.exec(sql);
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

export async function database() {
  const raw = new DatabaseSync(':memory:');
  const db = adapt(raw);
  await migrate(db);
  return { raw, db };
}
