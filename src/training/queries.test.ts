// Runs the real query SQL against node:sqlite, the same engine expo-sqlite uses
// on device. The adapter below exists only so the queries can be called with the
// one method of the expo-sqlite surface they use.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';

import { setCountsByMuscle, volumeLoad, volumeLoadByMuscle } from './calculations.ts';
import { listWorkingSets, loadExerciseMuscles } from './queries.ts';

type SqlValue = string | number | null;

function adapt(db: DatabaseSync): SQLiteDatabase {
  return {
    getAllAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T[]> =>
      db.prepare(source).all(...params) as T[],
  } as unknown as SQLiteDatabase;
}

function fixture(): SQLiteDatabase {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) db.exec(migration.sql);

  db.exec(`
    INSERT INTO training_exercise
      (id, name_es, name_en, primary_muscle, equipment_type, load_increment, default_rest_seconds)
    VALUES
      ('press',  'Press',  'Press',  'chest',   'dumbbell', 2.5, 180),
      ('fly',    'Apertura','Fly',   'chest',   'machine',  5,   120),
      ('pushdown','Jalon', 'Pushdown','triceps','cable',    2.5, 120);

    INSERT INTO training_exercise_muscle (exercise_id, muscle, contribution) VALUES
      ('press',    'chest',       1.0),
      ('press',    'triceps',     0.5),
      ('press',    'front_delts', 0.5),
      ('fly',      'chest',       1.0),
      ('pushdown', 'triceps',     1.0);

    INSERT INTO training_session (id, date, time_budget) VALUES
      ('mon', '2026-09-07', 'completo'),
      ('thu', '2026-09-10', 'completo'),
      ('nextmon', '2026-09-14', 'completo');

    INSERT INTO training_set_entry
      (id, session_id, exercise_id, set_index, weight_kg, reps, timestamp, is_warmup)
    VALUES
      ('w1',  'mon', 'press',    1, 20, 12, 1000, 1),
      ('m1',  'mon', 'press',    2, 30,  8, 1001, 0),
      ('m2',  'mon', 'press',    3, 30,  8, 1002, 0),
      ('m3',  'mon', 'fly',      1, 50, 14, 1003, 0),
      ('t1',  'thu', 'pushdown', 1, 25, 10, 2001, 0),
      ('t2',  'thu', 'pushdown', 2, 25, 10, 2002, 0),
      ('n1',  'nextmon', 'press', 1, 32.5, 6, 3001, 0);
  `);

  return adapt(db);
}

const thatWeek = { from: '2026-09-07', to: '2026-09-13' };

test('warmups are left out of the working sets', async () => {
  const sets = await listWorkingSets(fixture(), thatWeek);
  assert.equal(sets.length, 5);
  assert.ok(!sets.some((set) => set.setIndex === 1 && set.exerciseId === 'press'));
});

test('the range is inclusive on both ends and stops at the week boundary', async () => {
  const db = fixture();

  const week = await listWorkingSets(db, thatWeek);
  assert.deepEqual([...new Set(week.map((set) => set.date))], ['2026-09-07', '2026-09-10']);

  const nextWeek = await listWorkingSets(db, { from: '2026-09-14', to: '2026-09-20' });
  assert.deepEqual(
    nextWeek.map((set) => set.sessionId),
    ['nextmon'],
  );
});

test('one exercise can be asked for on its own', async () => {
  const sets = await listWorkingSets(fixture(), thatWeek, 'pushdown');
  assert.equal(sets.length, 2);
  assert.ok(sets.every((set) => set.exerciseId === 'pushdown'));
});

test('sets come back in the order they were performed', async () => {
  const sets = await listWorkingSets(fixture(), thatWeek);
  assert.deepEqual(
    sets.map((set) => `${set.sessionId}:${set.exerciseId}:${set.setIndex}`),
    ['mon:fly:1', 'mon:press:2', 'mon:press:3', 'thu:pushdown:1', 'thu:pushdown:2'],
  );
});

test('the muscle map comes back primary first', async () => {
  const muscles = await loadExerciseMuscles(fixture());
  assert.deepEqual(muscles.get('press'), [
    { muscle: 'chest', contribution: 1 },
    { muscle: 'front_delts', contribution: 0.5 },
    { muscle: 'triceps', contribution: 0.5 },
  ]);
  assert.deepEqual(muscles.get('pushdown'), [{ muscle: 'triceps', contribution: 1 }]);
});

test('a week of stored sets produces the weekly numbers end to end', async () => {
  const db = fixture();
  const sets = await listWorkingSets(db, thatWeek);
  const muscles = await loadExerciseMuscles(db);

  // press 30x8 twice, fly 50x14, pushdown 25x10 twice. El press es con mancuernas,
  // asi que sus 30 kg son 30 en cada mano y cuentan doble.
  assert.equal(volumeLoad(sets), 30 * 2 * 8 * 2 + 50 * 14 + 25 * 10 * 2);

  assert.deepEqual(setCountsByMuscle(sets, muscles).get('chest'), { direct: 3, weighted: 3 });
  assert.deepEqual(setCountsByMuscle(sets, muscles).get('triceps'), { direct: 2, weighted: 3 });

  const byMuscle = volumeLoadByMuscle(sets, muscles);
  assert.equal(byMuscle.get('chest'), 30 * 2 * 8 * 2 + 50 * 14);
  assert.equal(byMuscle.get('triceps'), (30 * 2 * 8 * 2) / 2 + 25 * 10 * 2);
});
