import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { upsertDailyLog } from '../core/daily-log.ts';
import { writeSetting } from '../core/settings.ts';
import { writeTargetSnapshot } from '../core/snapshots.ts';
import { computeTargets, type TargetProfile } from '../core/targets.ts';
import { migrations } from '../db/migrations/index.ts';
import { addSet, startSession } from '../training/index.ts';

import { assembleDay, exerciseContext, withTappedSet } from './day.ts';

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
  heightCm: 180,
  birthDate: '1990-01-15',
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

test('the open exercise only contains sets from its session when a day has two workouts', async () => {
  const { db, raw } = await fixture();
  raw.exec(`INSERT INTO training_session (id, date, start_time, time_budget)
    VALUES ('early', '${TODAY}', 1000000, 'completo'), ('later', '${TODAY}', 2000000, 'completo');`);
  await addSet(db, { sessionId: 'early', exerciseId: 'peck-deck', weightKg: 30, reps: 10 });
  await addSet(db, { sessionId: 'later', exerciseId: 'peck-deck', weightKg: 40, reps: 12 });
  const day = await assembleDay(db, TODAY, TODAY);
  assert.equal(day.sessionSets.length, 2);
  const exercise = await exerciseContext(db, day, 'peck-deck');
  assert.equal(exercise.todaySets.length, 1);
  assert.equal(exercise.todaySets[0].sessionId, 'later');
});

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
  assert.equal(day.bestWeekSessions, 0);
});

test('legacy missing-sleep settings leave the absolute score unchanged', async () => {
  const { db } = await fixture();
  await upsertDailyLog(db, { date: TODAY, waterMl: 2800, steps: 7200, creatineTaken: true });
  for (const value of ['true', 'false']) {
    await db.runAsync(
      `INSERT INTO core_setting (key, value) VALUES ('treat_missing_sleep_as_zero', ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value;`,
      [value],
    );
    const day = await assembleDay(db, TODAY, TODAY);
    assert.equal(
      day.result?.criteria.find((criterion) => criterion.id === 'sleep')?.fraction,
      null,
    );
    assert.equal(day.result?.score, 22);
    assert.equal(day.result?.pointsWithoutData, 78);
  }
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
  // 39 g en 73 kg es medio gramo por kilo: poquisimo, pero la curva de spec 4.1 no
  // lo manda a cero de golpe.
  assert.ok((protein?.fraction ?? 0) > 0 && (protein?.fraction ?? 1) < 0.2);
});

test('a day still open has not failed to train; a day already past has', async () => {
  const { db } = await fixture();
  await upsertDailyLog(db, { date: TODAY, waterMl: 2800, creatineTaken: true, steps: 7000 });

  const stillOpen = await assembleDay(db, TODAY, TODAY);
  assert.equal(stillOpen.trained, null);

  const closed = await assembleDay(db, TODAY, '2026-09-14');
  assert.equal(closed.trained, false);
});

test('una sesion vale por lo que movio, no por estar abierta', async () => {
  const { db, raw } = await fixture();
  raw.exec(
    `INSERT INTO training_session (id, date, time_budget) VALUES ('s1', '${TODAY}', 'completo');`,
  );
  await upsertDailyLog(db, { date: TODAY, waterMl: 3500, creatineTaken: true });

  const trained = (day: Awaited<ReturnType<typeof assembleDay>>) =>
    day.result?.criteria.find((c) => c.id === 'trained')?.fraction ?? 0;

  // Abierta y vacia todavia no es un entreno: el dia sigue abierto, sin puntos de entreno.
  const empty = await assembleDay(db, TODAY, TODAY);
  assert.equal(empty.trained, null);
  assert.equal(trained(empty), 0);

  // Una serie suelta tampoco es una sesion.
  await addSet(db, { sessionId: 's1', exerciseId: 'incline-db-press', weightKg: 30, reps: 8 });
  const single = await assembleDay(db, TODAY, TODAY);
  assert.ok(trained(single) > 0 && trained(single) < 0.2);
  assert.equal(single.effort?.sets, 1);

  // Doce series repartidas ya son el dia entero.
  for (let i = 0; i < 5; i += 1) {
    await addSet(db, { sessionId: 's1', exerciseId: 'incline-db-press', weightKg: 30, reps: 8 });
    await addSet(db, { sessionId: 's1', exerciseId: 'peck-deck', weightKg: 50, reps: 12 });
  }
  const full = await assembleDay(db, TODAY, TODAY);
  assert.ok(trained(full) > trained(single));
});

test('una sesion abierta y dejada vacia no cuenta para la semana ni para el descanso', async () => {
  const { db, raw } = await fixture();
  // Cuatro sesiones de verdad y el sabado marcado como descanso.
  for (const date of ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']) {
    raw.exec(`
      INSERT INTO training_session (id, date, time_budget) VALUES ('s-${date}', '${date}', 'completo');
      INSERT INTO training_set_entry (id, session_id, exercise_id, set_index, weight_kg, reps, timestamp)
      VALUES ('e-${date}', 's-${date}', 'peck-deck', 1, 50, 10, 1);
    `);
  }
  await upsertDailyLog(db, { date: '2026-09-26', restDay: true, waterMl: 2800 });
  const before = await assembleDay(db, '2026-09-26', '2026-09-28');

  // Y ese sabado tocó "Empezar", el gym estaba lleno y no anotó nada.
  raw.exec(
    `INSERT INTO training_session (id, date, time_budget) VALUES ('vacia', '2026-09-26', 'completo');`,
  );
  const after = await assembleDay(db, '2026-09-26', '2026-09-28');

  assert.equal(after.trained, false);
  // Antes, la vacia era la quinta de la semana y el descanso ganaba sus 22 puntos.
  assert.equal(after.bestWeekSessions, 4);
  assert.equal(after.result?.score, before.result?.score);
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

test('la serie tocada sale ya en la lista, y la siguiente propone esa y no la de antes', async () => {
  const { db } = await fixture();
  const sessionId = await startSession(db, { date: TODAY, timeBudget: 'completo' });
  await addSet(db, { sessionId, exerciseId: 'peck-deck', weightKg: 40, reps: 12 });
  const today = await assembleDay(db, TODAY, TODAY);
  const loaded = { today, exercise: await exerciseContext(db, today, 'peck-deck') };

  const tapped = withTappedSet(loaded, {
    sessionId,
    exerciseId: 'peck-deck',
    weightKg: 45,
    reps: 10,
    rpe: 8,
    timestamp: Date.now(),
  });

  // Lo que proponen los campos es la ultima serie de hoy: antes seguia siendo la de 40.
  assert.deepEqual(
    tapped.exercise.todaySets.map((set) => [set.setIndex, set.weightKg, set.reps]),
    [
      [1, 40, 12],
      [2, 45, 10],
    ],
  );
  // Y la cuenta del ejercicio, que decide si el plan abre el siguiente, ya la incluye.
  assert.equal(tapped.today.sessionSets.length, 2);
  // Lo cargado de antes no se toca: es lo que vuelve si la base la rechaza.
  assert.equal(loaded.exercise.todaySets.length, 1);
});
