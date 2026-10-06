import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { upsertDailyLog } from '../core/daily-log.ts';
import { type ReadRequest } from '../core/questions.ts';
import { writeTargetSnapshot } from '../core/snapshots.ts';
import { toKg } from '../core/units.ts';
import { migrations } from '../db/migrations/index.ts';
import { addFood, addFoodEntry } from '../nutrition/queries.ts';
import { savePantryItem } from '../pantry/queries.ts';
import { addSet, startSession, type NewSet } from '../training/sessions.ts';

import { answerLocalQuestion } from './assistant-read.ts';

const TODAY = '2026-10-04';
function fresh() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  let writes = 0;
  const db = {
    getAllAsync: async (sql: string, params: (string | number | null)[] = []) =>
      raw.prepare(sql).all(...params),
    getFirstAsync: async (sql: string, params: (string | number | null)[] = []) =>
      raw.prepare(sql).get(...params) ?? null,
    runAsync: async (sql: string, params: (string | number | null)[] = []) => {
      writes += 1;
      return raw.prepare(sql).run(...params);
    },
  } as unknown as SQLiteDatabase;
  return { raw, db, writes: () => writes };
}
async function workout(
  db: SQLiteDatabase,
  date: string,
  weight = 90,
  reps = [8, 7, 6],
  exerciseId = 'incline-db-press',
  extra: Partial<NewSet> = {},
) {
  const sessionId = await startSession(db, { date, timeBudget: 'completo' });
  for (const count of reps)
    await addSet(db, {
      sessionId,
      exerciseId,
      weightKg: toKg(weight, 'lb'),
      reps: count,
      ...extra,
    });
}
const request = (
  question: ReadRequest['question'],
  exercise: string | null = null,
  date: string | null = null,
): ReadRequest => ({ question, exercise, date });
const ask = (
  db: SQLiteDatabase,
  question: ReadRequest['question'],
  exercise: string | null = null,
  date: string | null = null,
) => answerLocalQuestion(db, request(question, exercise, date), TODAY, 'lb');

test('a single workout returns recorded dumbbell weight and every rep count, without an estimate', async () => {
  const { db, writes } = fresh();
  await workout(db, '2026-09-22');
  const before = writes();
  const answer = await ask(db, 'marca', 'press inclinado');
  assert.match(answer, /90 lb por (lado|mancuerna)/);
  assert.match(answer, /22-sep-2026/);
  assert.match(answer, /8[–-]7[–-]6/);
  assert.doesNotMatch(answer, /228|estimad/);
  assert.equal(writes(), before);
});

test('records include old dates and high rep sets and use the latest tied occurrence', async () => {
  const { db } = fresh();
  await workout(db, '2025-09-22', 100, [13]);
  await workout(db, '2026-09-22', 90);
  assert.match(await ask(db, 'marca', 'press inclinado'), /100 lb.*22-sep-2025/s);
  await workout(db, '2026-09-29', 100, [14]);
  const answer = await ask(db, 'marca', 'press inclinado');
  assert.match(answer, /100 lb.*29-sep-2026/s);
  assert.match(answer, /14/);
});

test('bench aliases return both flat and incline variants, excluding shoulder press', async () => {
  const { db, raw } = fresh();
  raw.exec(
    "INSERT INTO training_exercise (id,name_es,name_en,primary_muscle,equipment_type,load_increment,default_rest_seconds,unilateral) VALUES ('flat','Press banca plano','Flat bench press','chest','barbell',2.5,120,0), ('shoulder','Press de hombros','Shoulder press','front_delts','dumbbell',2.5,120,0);",
  );
  await workout(db, '2026-09-22');
  await workout(db, '2026-09-23', 150, [8], 'flat');
  await workout(db, '2026-09-24', 40, [8], 'shoulder');
  const answer = await ask(db, 'marca', 'press banca');
  assert.match(answer, /Press inclinado con mancuernas/);
  assert.match(answer, /Press banca plano/);
  assert.doesNotMatch(answer, /hombros/);
  assert.doesNotMatch(await ask(db, 'marca', 'press banca con mancuernas'), /Press banca plano/);
  assert.match(await ask(db, 'marca', 'pres inclinado'), /90 lb/);
});

test('explicit estimates are labeled and retain the per-dumbbell convention', async () => {
  const { db } = fresh();
  await workout(db, '2026-09-22');
  const answer = await ask(db, 'e1rm', 'press inclinado');
  assert.match(answer, /114 lb por (lado|mancuerna)/);
  assert.match(answer, /estimad/);
});

test('warmups cannot replace a working-set record and a requested range is respected', async () => {
  const { db } = fresh();
  await workout(db, '2026-08-22', 100);
  await workout(db, '2026-09-22', 200, [1], 'incline-db-press', { isWarmup: true });
  await workout(db, '2026-09-23', 90);
  assert.match(await ask(db, 'marca', 'press inclinado'), /100 lb/);
  assert.match(await ask(db, 'marca', 'press inclinado', 'mes pasado'), /90 lb/);
});

test('different implements of one exercise keep separate records', async () => {
  const { db } = fresh();
  await workout(db, '2026-09-22', 30, [10], 'hammer-curl', { implement: 'dumbbell' });
  await workout(db, '2026-09-23', 65, [10], 'hammer-curl', { implement: 'cable' });
  const answer = await ask(db, 'marca', 'curl martillo');
  assert.match(answer, /30 lb por (lado|mancuerna)/);
  assert.match(answer, /65 lb/);
  assert.match(answer, /polea/);
});

async function meal(db: SQLiteDatabase, date: string, grams: number) {
  const foodId = await addFood(db, {
    name: `Food ${date}`,
    amount: 1,
    unit: 'unidad',
    kind: 'count',
    kcal: 100,
    proteinG: grams,
    fatG: 1,
    carbsG: 2,
  });
  await addFoodEntry(db, { date, foodId, quantity: 1, unit: 'unidad', mealSlot: 'almuerzo' });
}
async function targets(db: SQLiteDatabase, date: string, proteinG: number) {
  await writeTargetSnapshot(
    db,
    {
      weightBasisKg: 70,
      kcal: 2200,
      proteinG,
      fatG: 60,
      carbsG: 200,
      waterMlRest: 2000,
      waterMlTraining: 2500,
      sleepMinutes: 420,
      steps: 6000,
    },
    date,
  );
}

test('yesterday protein uses yesterday food and the target in force then', async () => {
  const { db } = fresh();
  await targets(db, '2026-09-01', 120);
  await targets(db, TODAY, 160);
  await meal(db, '2026-10-03', 80);
  await meal(db, TODAY, 30);
  const answer = await ask(db, 'proteina', null, 'ayer');
  assert.match(answer, /80 g/);
  assert.match(answer, /120 g/);
  assert.doesNotMatch(answer, /160|Hoy/);
});

test('a range aggregates logged food but discloses days without records', async () => {
  const { db } = fresh();
  await meal(db, '2026-09-28', 30);
  await meal(db, '2026-09-30', 40);
  const answer = await ask(db, 'proteina', null, 'esta semana');
  assert.match(answer, /70 g/);
  assert.match(answer, /5 días sin/);
});

test('missing records, real zero and unknown nutrient values are distinguished', async () => {
  const { db, raw } = fresh();
  assert.match(await ask(db, 'proteina', null, 'ayer'), /No hay comida registrada/);
  await meal(db, '2026-10-03', 0);
  assert.match(await ask(db, 'proteina', null, 'ayer'), /0 g/);
  raw.exec("UPDATE nutrition_food SET carbs_g = NULL WHERE name = 'Food 2026-10-03';");
  assert.match(
    await ask(db, 'nutricion', null, 'ayer'),
    /totales incompletos: faltan datos nutricionales/,
  );
  assert.match(await ask(db, 'proteina', null, 'ayer'), /0 g de proteína/);
});

test('unknown dates refuse instead of reading today', async () => {
  const { db } = fresh();
  await meal(db, TODAY, 80);
  assert.match(await ask(db, 'proteina', null, 'algún día'), /No sé qué fecha/);
});

test('daily reads keep body weight in kg and preserve explicit negative creatine', async () => {
  const { db } = fresh();
  await upsertDailyLog(db, {
    date: '2026-10-03',
    weightKg: 70,
    steps: 8000,
    waterMl: 1500,
    sleepMinutes: 390,
    sleepSource: 'manual',
    creatineTaken: false,
  });
  assert.match(await ask(db, 'peso', null, 'ayer'), /70 kg/);
  assert.match(await ask(db, 'sueno', null, 'ayer'), /6 h 30 min/);
  assert.match(await ask(db, 'creatina', null, 'ayer'), /no tomada/);
  assert.match(await ask(db, 'agua', null, 'ayer'), /1500 ml/);
});

test('pantry reads include counted quantities, low stock and absent items without inventing availability', async () => {
  const { db } = fresh();
  await savePantryItem(db, {
    name: 'Arroz',
    kind: 'weighed',
    quantity: 200,
    unit: 'g',
    state: null,
    hasIt: null,
    foodId: null,
  });
  await savePantryItem(db, {
    name: 'Aceite',
    kind: 'durable',
    quantity: null,
    unit: null,
    state: 'poco',
    hasIt: null,
    foodId: null,
  });
  await savePantryItem(db, {
    name: 'Sal',
    kind: 'spice',
    quantity: null,
    unit: null,
    state: null,
    hasIt: false,
    foodId: null,
  });
  const answer = await ask(db, 'despensa');
  assert.match(answer, /Arroz: 200 g/);
  assert.match(answer, /Aceite: poco/);
  assert.match(answer, /Sal: no hay/);
});
