import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';

import { readDailyLog, upsertDailyLog } from './daily-log.ts';
import {
  listHealthImports,
  originOf,
  parseHealthLink,
  saveHealthReadings,
  type HealthLink,
  type HealthReading,
} from './health-import.ts';

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
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec('BEGIN;');
      try {
        await task();
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
  for (const migration of migrations) raw.exec(migration.sql);
  return { db: adapt(raw), raw };
}

// Las 22:30 del jueves 9, hora local del telefono.
const NOW = new Date(2026, 9, 9, 22, 30);
const WOKE = new Date(2026, 9, 9, 7, 25).toISOString();
const SLEPT = new Date(2026, 9, 8, 23, 40).toISOString();

function readings(url: string, now = NOW): HealthReading[] {
  const link = parseHealthLink(url, now) as HealthLink;
  assert.ok(link?.ok, link && !link.ok ? link.problem : 'not a health link');
  return link.readings;
}

function problem(url: string, now = NOW): string {
  const link = parseHealthLink(url, now);
  assert.ok(link && !link.ok, `accepted ${url}`);
  return link.problem;
}

test('a full link brings AutoSleep hours as minutes and the day steps', () => {
  const [sleep, steps] = readings(
    `nexo://salud?fecha=2026-10-09&sueno=7.75&inicio=${SLEPT}&fin=${WOKE}&pasos=8123`,
  );
  assert.deepEqual(sleep, {
    metric: 'sleep',
    source: 'autosleep',
    date: '2026-10-09',
    value: 465,
    startedAt: Date.parse(SLEPT),
    endedAt: Date.parse(WOKE),
  });
  assert.deepEqual(steps, {
    metric: 'steps',
    source: 'apple_health',
    date: '2026-10-09',
    value: 8123,
    startedAt: null,
    endedAt: null,
  });
});

test('numbers arrive in whatever format the phone language writes them', () => {
  assert.equal(readings('nexo://salud?sueno=7,75')[0].value, 465);
  assert.equal(readings('nexo://salud?sue%C3%B1o=7.33')[0].value, 440);
  assert.equal(readings('nexo://salud?Sueño=8')[0].value, 480);
  for (const written of ['8123', '8,123', '8.123', '8%20123', '8%C2%A0123', '8%E2%80%AF123']) {
    assert.equal(readings(`nexo://salud?pasos=${written}`)[0].value, 8123, written);
  }
});

test('nothing or zero is no data, never a measured zero', () => {
  const [sleep, steps] = readings('nexo://salud?sueno=&pasos=0');
  assert.equal(sleep.value, null);
  assert.equal(steps.value, null);
  assert.deepEqual(readings('nexo://salud?sueno=0')[0].value, null);
});

test('without a date everything is today; sleep belongs to the day it ended', () => {
  const [sleep, steps] = readings('nexo://salud?sueno=7&pasos=500');
  assert.equal(sleep.date, '2026-10-09');
  assert.equal(steps.date, '2026-10-09');
  // Run after midnight: the steps are for the new day, the night still ended on the 9th.
  const late = new Date(2026, 9, 10, 0, 20);
  const [night, today] = readings(
    `nexo://salud?fecha=2026-10-10&sueno=7&fin=${WOKE}&pasos=200`,
    late,
  );
  assert.equal(night.date, '2026-10-09');
  assert.equal(today.date, '2026-10-10');
});

test('links that are not for this importer are ignored, malformed ones say why', () => {
  assert.equal(parseHealthLink('http://localhost:8081/', NOW), null);
  assert.equal(parseHealthLink('exp+nexo://expo-development-client', NOW), null);
  assert.match(problem('nexo://otra?pasos=1'), /nexo:\/\/salud/);
  assert.match(problem('nexo://salud?fecha=2026-10-09'), /ni sueno ni pasos/);
  assert.match(problem('nexo://salud?pasos=1&paso=2'), /"paso"/);
  assert.match(problem('nexo://salud?sueno=7:45'), /no son horas/);
  assert.match(problem('nexo://salud?sueno=25'), /no son horas/);
  assert.match(problem('nexo://salud?pasos=8123%20pasos'), /no son un número/);
  assert.match(problem('nexo://salud?pasos=150000'), /no son un número/);
  assert.match(problem('nexo://salud?pasos=%E0%A4%A'), /no se entienden/);
});

test('dates out of the last week or in the future are refused before writing anywhere', () => {
  assert.match(problem('nexo://salud?fecha=09-10-2026&pasos=1'), /yyyy-MM-dd/);
  // Day and month swapped: a real date, but weeks away.
  assert.match(problem('nexo://salud?fecha=2026-09-10&pasos=1'), /más de una semana/);
  assert.match(problem('nexo://salud?fecha=2026-10-10&pasos=1'), /todavía no llega/);
  assert.equal(readings('nexo://salud?fecha=2026-10-02&pasos=1')[0].date, '2026-10-02');
  assert.match(problem('nexo://salud?sueno=7&fin=9 oct 7:25'), /ISO 8601/);
  assert.equal(
    readings('nexo://salud?sueno=7&fin=2026-10-09T07:25:00-0400')[0].endedAt,
    Date.parse('2026-10-09T07:25:00-04:00'),
  );
  assert.match(problem(`nexo://salud?sueno=7&inicio=${WOKE}&fin=${SLEPT}`), /después de terminar/);
  assert.match(
    problem(`nexo://salud?sueno=7&fin=${new Date(2026, 9, 9, 23, 30).toISOString()}`),
    /futuro/,
  );
});

test('an import fills the day, and a reimport replaces it even when lower', async () => {
  const { db } = fresh();
  const first = await saveHealthReadings(
    db,
    readings(`nexo://salud?sueno=7.75&fin=${WOKE}&pasos=8123`),
    1000,
  );
  assert.deepEqual(
    first.map((result) => result.outcome),
    ['saved', 'saved'],
  );
  let log = await readDailyLog(db, '2026-10-09');
  assert.equal(log?.sleep_minutes, 465);
  assert.equal(log?.sleep_source, 'autosleep');
  assert.equal(log?.steps, 8123);
  assert.equal(log?.has_data, 1);

  const second = await saveHealthReadings(db, readings('nexo://salud?sueno=7&pasos=600'), 2000);
  assert.deepEqual(
    second.map((result) => [result.outcome, result.current]),
    [
      ['saved', 465],
      ['saved', 8123],
    ],
  );
  log = await readDailyLog(db, '2026-10-09');
  assert.equal(log?.sleep_minutes, 420);
  assert.equal(log?.steps, 600);
  const imports = await listHealthImports(db, '2026-10-09');
  assert.equal(imports.length, 2);
  assert.ok(imports.every((row) => row.imported_at === 2000));
  assert.deepEqual(originOf(log, imports, 'steps'), {
    kind: 'imported',
    source: 'apple_health',
    importedAt: 2000,
  });
});

test('a value typed by hand is not overwritten without asking', async () => {
  const { db } = fresh();
  await saveHealthReadings(db, readings('nexo://salud?sueno=7.75&pasos=8123'), 1000);
  await upsertDailyLog(db, { date: '2026-10-09', sleepMinutes: 430, sleepSource: 'manual' });
  let log = await readDailyLog(db, '2026-10-09');
  assert.deepEqual(originOf(log, await listHealthImports(db, '2026-10-09'), 'sleep'), {
    kind: 'manual',
  });

  const link = readings('nexo://salud?sueno=7.5&pasos=9000');
  const asked = await saveHealthReadings(db, link, 2000);
  assert.deepEqual(
    asked.map((result) => [result.reading.metric, result.outcome, result.current]),
    [
      ['sleep', 'conflict', 430],
      ['steps', 'saved', 8123],
    ],
  );
  log = await readDailyLog(db, '2026-10-09');
  assert.equal(log?.sleep_minutes, 430);
  assert.equal(log?.steps, 9000);

  const [replaced] = await saveHealthReadings(db, [link[0]], 3000, true);
  assert.equal(replaced.outcome, 'saved');
  log = await readDailyLog(db, '2026-10-09');
  assert.equal(log?.sleep_minutes, 450);
  assert.equal(log?.sleep_source, 'autosleep');
});

test('a manual value equal to the import is simply confirmed', async () => {
  const { db } = fresh();
  await upsertDailyLog(db, { date: '2026-10-09', steps: 5000 });
  const [result] = await saveHealthReadings(db, readings('nexo://salud?pasos=5000'), 1000);
  assert.equal(result.outcome, 'saved');
  const log = await readDailyLog(db, '2026-10-09');
  assert.equal(originOf(log, await listHealthImports(db, '2026-10-09'), 'steps')?.kind, 'imported');
});

test('missing data writes nothing and keeps what was there', async () => {
  const { db, raw } = fresh();
  await upsertDailyLog(db, { date: '2026-10-09', steps: 4000 });
  const results = await saveHealthReadings(db, readings('nexo://salud?sueno=&pasos=0'), 1000);
  assert.deepEqual(
    results.map((result) => result.outcome),
    ['empty', 'empty'],
  );
  assert.equal((await readDailyLog(db, '2026-10-09'))?.steps, 4000);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM core_health_import;').get()!.n, 0);
});

test('a failed write keeps every value and its receipt together or neither', async () => {
  const { db, raw } = fresh();
  raw.exec(`CREATE TRIGGER reject_steps BEFORE INSERT ON core_health_import
            WHEN NEW.metric = 'steps' BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);
  await assert.rejects(
    saveHealthReadings(db, readings('nexo://salud?sueno=7&pasos=8000'), 1000),
    /disk full/,
  );
  assert.equal(await readDailyLog(db, '2026-10-09'), null);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM core_health_import;').get()!.n, 0);
});

test('a day without the value has no origin, and imports of another day do not count', async () => {
  const { db } = fresh();
  await saveHealthReadings(db, readings('nexo://salud?fecha=2026-10-08&pasos=7000'), 1000);
  await upsertDailyLog(db, { date: '2026-10-09', steps: 7000 });
  const log = await readDailyLog(db, '2026-10-09');
  const other = await listHealthImports(db, '2026-10-08');
  assert.equal(originOf(log, other, 'steps')?.kind, 'manual');
  assert.equal(originOf(log, other, 'sleep'), null);
});
