import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';
import type { CoreDailyLogRow } from '../db/types.ts';
import type { ExerciseMuscles, LoggedSet } from '../training/index.ts';

import { buildWeekSummary, loadWeekSummary, type WeekInput } from './week.ts';

type SqlValue = string | number | null;

function adapt(db: DatabaseSync): SQLiteDatabase {
  return {
    getAllAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T[]> =>
      db.prepare(source).all(...params) as T[],
    getFirstAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T | null> =>
      (db.prepare(source).get(...params) as T) ?? null,
  } as unknown as SQLiteDatabase;
}

const WEEK = { from: '2026-09-07', to: '2026-09-13' };

function log(date: string, fields: Partial<CoreDailyLogRow> = {}): CoreDailyLogRow {
  return {
    date,
    water_ml: null,
    creatine_taken: null,
    alcohol_drinks: null,
    alcohol_after_training: null,
    cannabis: null,
    sleep_minutes: null,
    sleep_source: null,
    resting_hr: null,
    hrv_ms: null,
    steps: null,
    weight_kg: null,
    score: null,
    has_data: 1,
    rest_day: 0,
    ...fields,
  };
}

const muscles: ExerciseMuscles = new Map([
  [
    'press',
    [
      { muscle: 'chest', contribution: 1 },
      { muscle: 'triceps', contribution: 0.5 },
    ],
  ],
  ['curl', [{ muscle: 'biceps', contribution: 1 }]],
]);

function sets(exerciseId: string, count: number, date = '2026-09-08'): LoggedSet[] {
  return Array.from({ length: count }, (_, i) => ({
    sessionId: `s-${date}`,
    date,
    exerciseId,
    setIndex: i + 1,
    weightKg: 20,
    reps: 10,
  }));
}

function input(overrides: Partial<WeekInput> = {}): WeekInput {
  return {
    range: WEEK,
    logs: [],
    nutrition: [],
    weekSets: [],
    priorSets: [],
    muscles,
    jbcCount: 0,
    ...overrides,
  };
}

test('direct sets are judged against the 10 to 20 band', () => {
  const summary = buildWeekSummary(
    input({ weekSets: [...sets('press', 12), ...sets('curl', 22)] }),
  );
  const byMuscle = new Map(summary.muscles.map((m) => [m.muscle, m]));

  assert.equal(byMuscle.get('chest')?.band, 'within');
  assert.equal(byMuscle.get('biceps')?.band, 'above');
  // Triceps only ever appears as a secondary: weighted sets, but no direct ones.
  assert.equal(byMuscle.get('triceps')?.directSets, 0);
  assert.equal(byMuscle.get('triceps')?.weightedSets, 6);
  assert.equal(byMuscle.get('triceps')?.band, 'below');
});

test('volume is compared to the four weeks before, and to nothing without history', () => {
  const noHistory = buildWeekSummary(input({ weekSets: sets('press', 3) }));
  assert.equal(noHistory.muscles[0].priorAverageVolumeKg, null);

  const withHistory = buildWeekSummary(
    input({ weekSets: sets('press', 3), priorSets: sets('press', 8, '2026-08-20') }),
  );
  const chest = withHistory.muscles.find((m) => m.muscle === 'chest');
  // 8 sets of 20 kg × 10 over four weeks.
  assert.equal(chest?.priorAverageVolumeKg, (8 * 200) / 4);
  assert.equal(chest?.volumeKg, 3 * 200);
});

test('averages leave out the days with nothing logged', () => {
  const summary = buildWeekSummary(
    input({
      logs: [
        log('2026-09-07', { sleep_minutes: 420, steps: 7000 }),
        log('2026-09-08', { sleep_minutes: null, steps: 9000 }),
        log('2026-09-09', { sleep_minutes: 480, water_ml: 2840 }),
      ],
      nutrition: [
        { date: '2026-09-07', kcal: 2400, proteinG: 150 },
        { date: '2026-09-09', kcal: 2200, proteinG: 130 },
      ],
    }),
  );

  assert.equal(summary.averages.sleepMinutes, 450);
  assert.equal(summary.averages.steps, 8000);
  assert.equal(summary.averages.waterMl, 2840);
  assert.equal(summary.averages.kcal, 2300);
  assert.equal(summary.averages.proteinG, 140);
  assert.equal(summary.averages.foodDays, 2);
});

test('an empty week has no averages rather than zeros', () => {
  const summary = buildWeekSummary(input());
  assert.equal(summary.averages.sleepMinutes, null);
  assert.equal(summary.averages.kcal, null);
  assert.deepEqual(summary.muscles, []);
});

test('weight follows the four weigh-in rule, this week against the one before', () => {
  const previous = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'].map((date) =>
    log(date, { weight_kg: 73 }),
  );
  const sparse = buildWeekSummary(
    input({ logs: [...previous, log('2026-09-10', { weight_kg: 74 })] }),
  );
  assert.equal(sparse.weightKg.previousWeek, 73);
  assert.equal(sparse.weightKg.thisWeek, null);

  const full = buildWeekSummary(
    input({
      logs: [
        ...previous,
        ...['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'].map((date) =>
          log(date, { weight_kg: 74 }),
        ),
      ],
    }),
  );
  assert.equal(full.weightKg.thisWeek, 74);
});

test('creatine compliance counts only the days it was logged, over four weeks', () => {
  const summary = buildWeekSummary(
    input({
      logs: [
        log('2026-08-10', { creatine_taken: 1 }), // before the 28 day window
        log('2026-08-20', { creatine_taken: 1 }),
        log('2026-09-01', { creatine_taken: 0 }),
        log('2026-09-12', { creatine_taken: 1 }),
        log('2026-09-13', { creatine_taken: null }),
      ],
    }),
  );
  assert.deepEqual(summary.creatine, { taken: 2, logged: 3, windowDays: 28 });
});

test('alcohol is totalled over the week with the days it happened on', () => {
  const summary = buildWeekSummary(
    input({
      logs: [
        log('2026-09-08', { alcohol_drinks: 2 }),
        log('2026-09-12', { alcohol_drinks: 5 }),
        log('2026-09-13', { alcohol_drinks: 0 }),
        log('2026-09-06', { alcohol_drinks: 8 }), // previous week
      ],
    }),
  );
  assert.deepEqual(summary.alcohol, { drinks: 7, daysWithDrinks: 2 });
});

test('recovery compares this week with the week before', () => {
  const summary = buildWeekSummary(
    input({
      logs: [
        log('2026-09-02', { resting_hr: 60, hrv_ms: 40 }),
        log('2026-09-09', { resting_hr: 54, hrv_ms: 50 }),
        log('2026-09-11', { resting_hr: 56, hrv_ms: 46 }),
      ],
    }),
  );
  assert.deepEqual(summary.restingHr, { thisWeek: 55, previousWeek: 60 });
  assert.deepEqual(summary.hrvMs, { thisWeek: 48, previousWeek: 40 });
});

test('the stored week counts Jr. Bacon Cheeseburgers and food days end to end', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  raw.exec(`
    INSERT INTO nutrition_food_entry (id, food_id, quantity, unit, timestamp, date, meal_slot) VALUES
      ('e1', 'wendys-jbc', 5, 'unidad', 1000, '2026-09-11', 'cena'),
      ('e2', 'eggs-large', 6, 'huevo', 2000, '2026-09-08', 'desayuno'),
      ('e3', 'wendys-jbc', 3, 'unidad', 3000, '2026-09-02', 'cena');
    INSERT INTO training_session (id, date, time_budget) VALUES ('s1', '2026-09-08', 'completo');
    INSERT INTO training_set_entry
      (id, session_id, exercise_id, set_index, weight_kg, reps, timestamp)
    VALUES ('t1', 's1', 'incline-db-press', 1, 13.6, 8, 4000);
  `);

  const summary = await loadWeekSummary(adapt(raw), '2026-09-10');

  assert.deepEqual(summary.range, WEEK);
  // The three from the week before do not count.
  assert.equal(summary.jbcCount, 5);
  assert.equal(summary.averages.foodDays, 2);
  assert.equal(summary.muscles.find((m) => m.muscle === 'chest')?.directSets, 1);
});
