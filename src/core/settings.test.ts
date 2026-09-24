import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';

import {
  TRIGGER_MISSED_SCHEDULED_DAYS,
  comparisonFloor,
  isReEntryActive,
  reEntryBanner,
  shouldStartReEntry,
} from './re-entry.ts';
import {
  clearSetting,
  paletteFrom,
  profileFrom,
  readSettings,
  reEntryFrom,
  treatMissingSleepAsZero,
  writeSetting,
  type Settings,
  settingProblem,
} from './settings.ts';

type SqlValue = string | number | null;

function adapt(db: DatabaseSync): SQLiteDatabase {
  return {
    getAllAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T[]> =>
      db.prepare(source).all(...params) as T[],
    runAsync: async (source: string, params: SqlValue[] = []) => {
      db.prepare(source).run(...params);
      return { changes: 0, lastInsertRowId: 0 };
    },
  } as unknown as SQLiteDatabase;
}

function fresh(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  return adapt(raw);
}

function settings(entries: Record<string, string> = {}): Settings {
  return new Map(Object.entries(entries));
}

test('an empty store still answers with the shipped defaults', async () => {
  const stored = await readSettings(fresh());

  assert.equal(stored.size, 0);
  assert.equal(paletteFrom(stored), 'deutan');
  assert.equal(treatMissingSleepAsZero(stored), false);
  assert.deepEqual(reEntryFrom(stored), { startedOn: null, weeks: 3 });
});

test('a written setting survives and overrides the default', async () => {
  const db = fresh();

  await writeSetting(db, 'palette', 'tritan');
  assert.equal(paletteFrom(await readSettings(db)), 'tritan');

  await writeSetting(db, 'palette', 'standard');
  assert.equal(paletteFrom(await readSettings(db)), 'standard');

  await clearSetting(db, 'palette');
  assert.equal(paletteFrom(await readSettings(db)), 'deutan');
});

test('a setting holding nonsense fails loudly instead of falling back', () => {
  assert.throws(() => paletteFrom(settings({ palette: 'morado' })), /not one of the three/);
  assert.throws(
    () => profileFrom(settings({ height_cm: 'alto', birth_date: '1996-08-30' })),
    /not a number/,
  );
  assert.throws(
    () => profileFrom(settings({ height_cm: '170', birth_date: '1996-08-30', phase: 'volumen' })),
    /not a phase/,
  );
});

test('there is no profile until height and birth date are entered', () => {
  assert.equal(profileFrom(settings()), null);
  assert.equal(profileFrom(settings({ height_cm: '170' })), null);
  assert.equal(profileFrom(settings({ birth_date: '1996-08-30' })), null);

  const profile = profileFrom(settings({ height_cm: '170', birth_date: '1996-08-30' }));
  assert.deepEqual(profile, {
    heightCm: 170,
    birthDate: '1996-08-30',
    activityFactor: 1.58,
    phase: 'recomp',
    sleepMinutes: 420,
    steps: 7000,
  });
});

test('the editable parts of the profile are editable', () => {
  const profile = profileFrom(
    settings({
      height_cm: '170',
      birth_date: '1996-08-30',
      activity_factor: '1.6',
      phase: 'cut',
      steps_target: '8500',
    }),
  );

  assert.equal(profile?.activityFactor, 1.6);
  assert.equal(profile?.phase, 'cut');
  assert.equal(profile?.steps, 8500);
});

test('re-entry runs for its three weeks and then stops on its own', () => {
  const state = { startedOn: '2026-09-05', weeks: 3 };

  assert.equal(isReEntryActive(state, '2026-09-04'), false);
  assert.equal(isReEntryActive(state, '2026-09-05'), true);
  assert.equal(isReEntryActive(state, '2026-09-25'), true);
  assert.equal(isReEntryActive(state, '2026-09-26'), false);
});

test('the banner counts the week he is in', () => {
  const state = { startedOn: '2026-09-05', weeks: 3 };

  assert.deepEqual(reEntryBanner(state, '2026-09-05'), {
    week: 1,
    of: 3,
    endsOn: '2026-09-25',
  });
  assert.equal(reEntryBanner(state, '2026-09-13')?.week, 2);
  assert.equal(reEntryBanner(state, '2026-09-20')?.week, 3);
  assert.equal(reEntryBanner(state, '2026-09-26'), null);
});

test('re-entry that was never started is simply not on', () => {
  const never = { startedOn: null, weeks: 3 };
  assert.equal(isReEntryActive(never, '2026-09-13'), false);
  assert.equal(reEntryBanner(never, '2026-09-13'), null);
  assert.equal(comparisonFloor(never, '2026-09-13'), null);
});

test('while readapting, comparisons start at the day he came back', () => {
  const state = { startedOn: '2026-09-05', weeks: 3 };
  assert.equal(comparisonFloor(state, '2026-09-13'), '2026-09-05');
  assert.equal(comparisonFloor(state, '2026-10-13'), null);
});

test('a week of scheduled days without a session starts re-entry', () => {
  assert.equal(shouldStartReEntry(6), false);
  assert.equal(shouldStartReEntry(TRIGGER_MISSED_SCHEDULED_DAYS), true);
  assert.equal(shouldStartReEntry(20), true);
});

test('an adjustable window is actually adjustable', () => {
  const shorter = { startedOn: '2026-09-05', weeks: 2 };
  assert.equal(isReEntryActive(shorter, '2026-09-18'), true);
  assert.equal(isReEntryActive(shorter, '2026-09-19'), false);
  assert.equal(reEntryBanner(shorter, '2026-09-05')?.of, 2);
});

test('una fecha con forma correcta pero imposible se rechaza antes de guardarse', () => {
  assert.match(settingProblem('birth_date', '1996-30-08') ?? '', /no existe/);
  assert.match(settingProblem('birth_date', '2026-02-31') ?? '', /no existe/);
  assert.equal(settingProblem('birth_date', '1996-08-30'), null);
});

test('una fecha imposible ya guardada deja sin perfil, no tumba la app', () => {
  const settings = new Map([
    ['height_cm', '170'],
    ['birth_date', '1996-30-08'],
    ['phase', 'recomp'],
    ['activity_factor', '1.55'],
    ['sleep_target_minutes', '420'],
    ['steps_target', '7000'],
  ]);

  assert.equal(profileFrom(settings), null);
  assert.equal(reEntryFrom(new Map([['re_entry_started_on', '2026-13-01']])).startedOn, null);
});
