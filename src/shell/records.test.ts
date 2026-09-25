import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { storeScore, upsertDailyLog } from '../core/daily-log.ts';
import { migrations } from '../db/migrations/index.ts';
import { computeTargets } from '../core/targets.ts';
import { backdateFirstSnapshot, setInitialTargets, writeTargetSnapshot } from '../core/snapshots.ts';
import { addFoodEntry } from '../nutrition/index.ts';
import { addSet, startSession } from '../training/index.ts';

import { loadCharts } from './charts.ts';
import {
  buildDayExports,
  listDayRows,
  rescoreMissing,
  rescoreSettling,
  loadDayDetail,
  sortDayRows,
  windowRange,
  type DayRow,
} from './records.ts';

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
  } as unknown as SQLiteDatabase;
}

function fresh(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  return adapt(raw);
}

const TODAY = '2026-09-23';

function row(fields: Partial<DayRow>): DayRow {
  return {
    date: '2026-09-20',
    score: null,
    hasData: true,
    trained: false,
    restDay: false,
    volume: 0,
    proteinG: null,
    kcal: null,
    ...fields,
  };
}

test('the list holds every day that left a trace, newest first', async () => {
  const db = fresh();

  await upsertDailyLog(db, { date: '2026-09-21', waterMl: 2000 });
  const session = await startSession(db, { date: '2026-09-22', timeBudget: 'completo' });
  await addSet(db, { sessionId: session, exerciseId: 'peck-deck', weightKg: 50, reps: 12 });
  await addFoodEntry(db, {
    date: '2026-09-23',
    foodId: 'eggs-costco-xl',
    quantity: 3,
    unit: 'huevo',
    mealSlot: 'desayuno',
  });

  const rows = await listDayRows(db, windowRange('month', TODAY));

  assert.deepEqual(
    rows.map((entry) => entry.date),
    ['2026-09-23', '2026-09-22', '2026-09-21'],
  );
  assert.equal(rows[1].trained, true);
  assert.equal(rows[1].volume, 600);
  assert.equal(Math.round(rows[0].proteinG ?? 0), 21);
});

test('a day opened in detail carries its exercises and the reason for its score', async () => {
  const db = fresh();
  const session = await startSession(db, {
    date: '2026-09-22',
    timeBudget: 'completo',
    routineId: 'push',
  });
  await addSet(db, { sessionId: session, exerciseId: 'incline-db-press', weightKg: 30, reps: 8 });
  await addSet(db, { sessionId: session, exerciseId: 'incline-db-press', weightKg: 30, reps: 7 });

  const detail = await loadDayDetail(db, '2026-09-22', TODAY);

  assert.equal(detail.routineName, 'Push');
  assert.equal(detail.exercises.length, 1);
  assert.equal(detail.exercises[0].name, 'Press inclinado con mancuernas');
  assert.equal(detail.exercises[0].perSide, true);
  assert.equal(detail.exercises[0].volume, 30 * 2 * 15);
  // Sin perfil no hay metas, y sin metas la nota no existe: eso es lo que hay que decir.
  assert.equal(detail.report.noScore, 'sin-metas');
});

test('sorting never puts a day without the number on top', () => {
  const rows = [
    row({ date: '2026-09-20', proteinG: 120, score: 40 }),
    row({ date: '2026-09-21', proteinG: null, score: 90 }),
    row({ date: '2026-09-22', proteinG: 180, score: null }),
  ];

  assert.deepEqual(
    sortDayRows(rows, 'protein').map((entry) => entry.date),
    ['2026-09-22', '2026-09-20', '2026-09-21'],
  );
  assert.deepEqual(
    sortDayRows(rows, 'score').map((entry) => entry.date),
    ['2026-09-21', '2026-09-20', '2026-09-22'],
  );
  assert.deepEqual(
    sortDayRows(rows, 'recent').map((entry) => entry.date),
    ['2026-09-22', '2026-09-21', '2026-09-20'],
  );
});

test('a window ends today and counts today as one of its days', () => {
  assert.deepEqual(windowRange('week', TODAY), { from: '2026-09-17', to: TODAY });
  assert.deepEqual(windowRange('quarter', TODAY), { from: '2026-06-26', to: TODAY });
  assert.equal(windowRange('all', TODAY).from, '2000-01-01');
});

test('the exported day carries the workout, the food and where the score came from', async () => {
  const db = fresh();
  const session = await startSession(db, {
    date: '2026-09-22',
    timeBudget: 'completo',
    routineId: 'push',
  });
  await addSet(db, { sessionId: session, exerciseId: 'peck-deck', weightKg: 50, reps: 10 });
  await addFoodEntry(db, {
    date: '2026-09-22',
    foodId: 'protein-bar-60g',
    quantity: 1,
    unit: 'unidad',
    mealSlot: 'snack',
  });
  await upsertDailyLog(db, { date: '2026-09-22', steps: 8200 });

  const [day] = await buildDayExports(db, TODAY);

  assert.equal(day.date, '2026-09-22');
  assert.equal(day.criteria.length, 8);
  assert.equal(day.log?.steps, 8200);

  const training = day.training as { volumeKg: number; exercises: { sets: unknown[] }[] };
  assert.equal(training.volumeKg, 500);
  assert.equal(training.exercises[0].sets.length, 1);

  const nutrition = day.nutrition as { proteinG: number; entries: { name: string }[] };
  assert.equal(Math.round(nutrition.proteinG), 21);
  assert.equal(nutrition.entries[0].name, 'Barra de proteina');
});

test('a day logged before there were targets gets its score back', async () => {
  const db = fresh();
  await upsertDailyLog(db, {
    date: '2026-09-21',
    sleepMinutes: 450,
    sleepSource: 'manual',
    waterMl: 3000,
    steps: 9000,
    creatineTaken: true,
  });

  // Sin metas no hay nota, que es justo lo que le pasaba a todo lo anotado antes de
  // llenar el perfil.
  const before = await loadDayDetail(db, '2026-09-21', TODAY);
  assert.equal(before.report.noScore, 'sin-metas');
  assert.equal(await rescoreMissing(db, { from: '2026-09-01', to: TODAY }, TODAY), 0);

  await writeTargetSnapshot(
    db,
    computeTargets(
      74,
      {
        heightCm: 170,
        birthDate: '1996-08-30',
        activityFactor: 1.55,
        phase: 'recomp',
        sleepMinutes: 420,
        steps: 7000,
      },
      '2026-09-01',
    ),
    '2026-09-01',
  );

  assert.equal(await rescoreMissing(db, { from: '2026-09-01', to: TODAY }, TODAY), 1);

  // Semanas sin entrenar dejan la penalizacion de spec 4.3 en su tope y se come los
  // 52 puntos que si gano, pero el dia ya tiene nota, que es lo que estaba roto.
  const rows = await listDayRows(db, windowRange('month', TODAY));
  assert.notEqual(rows.find((row) => row.date === '2026-09-21')?.score, null);
});

test('el descanso del jueves recibe sus puntos cuando la semana cierra', async () => {
  const db = fresh();
  const week = ['2026-09-17', '2026-09-18', '2026-09-20', '2026-09-21', '2026-09-22'];

  await setInitialTargets(
    db,
    73,
    {
      heightCm: 170,
      birthDate: '1996-08-30',
      activityFactor: 1.55,
      phase: 'recomp',
      sleepMinutes: 420,
      steps: 7000,
    },
    '2026-09-17',
  );

  // Jueves de descanso marcado, con dos entrenos detras y tres por delante.
  await upsertDailyLog(db, {
    date: '2026-09-19',
    restDay: true,
    sleepMinutes: 450,
    sleepSource: 'manual',
  });
  for (const date of week.slice(0, 2)) {
    const session = await startSession(db, { date, timeBudget: 'completo' });
    await addSet(db, { sessionId: session, exerciseId: 'peck-deck', weightKg: 50, reps: 10 });
  }

  await rescoreMissing(db, { from: '2026-09-01', to: TODAY }, TODAY);
  const before = await loadDayDetail(db, '2026-09-19', TODAY);
  const trainedLine = (detail: typeof before) =>
    detail.report.lines.find((line) => line.id === 'trained');
  assert.equal(trainedLine(before)?.earned, 0);

  // Llegan el sabado, el domingo y el lunes: la semana del jueves ya tiene cinco.
  for (const date of week.slice(2)) {
    const session = await startSession(db, { date, timeBudget: 'completo' });
    await addSet(db, { sessionId: session, exerciseId: 'peck-deck', weightKg: 50, reps: 10 });
  }

  assert.ok((await rescoreSettling(db, '2026-09-23')) > 0);
  const after = await loadDayDetail(db, '2026-09-19', TODAY);
  assert.equal(trainedLine(after)?.earned, 22);
  assert.ok((after.report.score ?? 0) > (before.report.score ?? 0));
});

test('las graficas leen lo mismo que el resto de la app', async () => {
  const db = fresh();

  await upsertDailyLog(db, { date: '2026-09-21', weightKg: 73 });
  await upsertDailyLog(db, { date: '2026-09-22', weightKg: 73.4 });
  await upsertDailyLog(db, { date: '2026-09-23', weightKg: 72.8 });

  const session = await startSession(db, { date: '2026-09-22', timeBudget: 'completo' });
  await addSet(db, { sessionId: session, exerciseId: 'peck-deck', weightKg: 50, reps: 10 });
  const later = await startSession(db, { date: '2026-09-23', timeBudget: 'completo' });
  await addSet(db, { sessionId: later, exerciseId: 'peck-deck', weightKg: 55, reps: 10 });

  await addFoodEntry(db, {
    date: '2026-09-23',
    foodId: 'protein-bar-60g',
    quantity: 2,
    unit: 'unidad',
    mealSlot: 'tarde',
  });

  const charts = await loadCharts(db, TODAY, 30);

  assert.equal(charts.weight.length, 3);
  // Con dos pesadas ya hay media, que es lo que se dibuja.
  assert.ok(charts.weightAverage.length > 0);

  const peck = charts.trends.find((trend) => trend.exerciseId === 'peck-deck');
  assert.equal(peck?.points.length, 2);
  // Epley sobre 55 x 10 proyecta mas que sobre 50 x 10, que es toda la grafica.
  assert.ok((peck?.points[1].value ?? 0) > (peck?.points[0].value ?? 0));

  assert.equal(charts.muscles.find((bar) => bar.muscle === 'chest')?.sets, 2);
  assert.equal(Math.round(charts.protein[0].value), 42);

  // La nota es la que ya guarda la cuadricula, no una segunda cuenta.
  await storeScore(db, '2026-09-22', 68);
  const scored = await loadCharts(db, TODAY, 30);
  assert.deepEqual(scored.score, [{ date: '2026-09-22', value: 68 }]);
});

test('un dia de puro entreno y comida tambien recibe su nota', async () => {
  const db = fresh();

  // El perfil se llena hoy, pero el entreno fue anteayer.
  const session = await startSession(db, { date: '2026-09-21', timeBudget: 'completo' });
  await addSet(db, { sessionId: session, exerciseId: 'peck-deck', weightKg: 50, reps: 10 });
  await addFoodEntry(db, {
    date: '2026-09-21',
    foodId: 'eggs-costco-xl',
    quantity: 6,
    unit: 'huevo',
    mealSlot: 'desayuno',
  });
  await upsertDailyLog(db, { date: '2026-09-21', sleepMinutes: 450, sleepSource: 'manual' });
  await upsertDailyLog(db, { date: TODAY, weightKg: 73 });

  await setInitialTargets(
    db,
    73,
    {
      heightCm: 170,
      birthDate: '1996-08-30',
      activityFactor: 1.55,
      phase: 'recomp',
      sleepMinutes: 420,
      steps: 7000,
    },
    TODAY,
  );
  await backdateFirstSnapshot(db);

  assert.ok((await rescoreMissing(db, { from: '2026-09-01', to: TODAY }, TODAY)) > 0);

  // Semanas sin entrenar dejan la penalizacion de spec 4.3 en su tope y se come los
  // 52 puntos que si gano, pero el dia ya tiene nota, que es lo que estaba roto.
  const rows = await listDayRows(db, windowRange('month', TODAY));
  assert.notEqual(rows.find((row) => row.date === '2026-09-21')?.score, null);
});
