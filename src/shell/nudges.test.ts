import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { upsertDailyLog } from '../core/daily-log.ts';
import { writeSetting } from '../core/settings.ts';
import { setInitialTargets } from '../core/snapshots.ts';
import { migrations } from '../db/migrations/index.ts';
import { addFoodEntry } from '../nutrition/index.ts';
import { addSet, startSession } from '../training/index.ts';

import { nudgePlan, recordNudgeAction, recordNudges, SCHEDULE_DAYS } from './nudges.ts';

type SqlValue = string | number | null;

function fresh(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
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

const TODAY = '2026-09-25';

async function withProfile(db: SQLiteDatabase): Promise<void> {
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
}

test('un dia en blanco recibe sus tres avisos, y los dias por delante tambien', async () => {
  const db = fresh();
  await withProfile(db);

  const plan = await nudgePlan(db, TODAY);
  const today = plan.filter((nudge) => nudge.date === TODAY);

  assert.equal(today.length, 3);
  // El cierre nunca falta: es la ultima pasada antes de que el dia quede gris.
  assert.ok(today.some((nudge) => nudge.kind === 'cierre'));
  // Y hay plan para los tres dias, porque iOS no puede pensar por su cuenta.
  assert.equal(new Set(plan.map((nudge) => nudge.date)).size, SCHEDULE_DAYS);
});

test('lo que ya anoto no se le recuerda', async () => {
  const db = fresh();
  await withProfile(db);

  await upsertDailyLog(db, {
    date: TODAY,
    sleepMinutes: 450,
    sleepSource: 'manual',
    waterMl: 3000,
    steps: 8000,
    creatineTaken: true,
  });
  const session = await startSession(db, { date: TODAY, timeBudget: 'completo' });
  await addSet(db, { sessionId: session, exerciseId: 'peck-deck', weightKg: 50, reps: 10 });
  for (const slot of ['desayuno', 'media mañana', 'mediodía', 'tarde', 'cena']) {
    await addFoodEntry(db, {
      date: TODAY,
      foodId: 'eggs-large',
      quantity: 2,
      unit: 'huevo',
      mealSlot: slot,
    });
  }

  const today = (await nudgePlan(db, TODAY)).filter((nudge) => nudge.date === TODAY);
  assert.deepEqual(today, []);
});

test('el interruptor general deja el plan vacio', async () => {
  const db = fresh();
  await withProfile(db);
  await writeSetting(db, 'nudges_enabled', 'false');

  assert.deepEqual(await nudgePlan(db, TODAY), []);
});

test('un tipo apagado a mano no entra en el plan', async () => {
  const db = fresh();
  await withProfile(db);
  await writeSetting(db, 'nudges_off', 'cierre,agua');

  const today = (await nudgePlan(db, TODAY)).filter((nudge) => nudge.date === TODAY);
  assert.equal(
    today.some((nudge) => nudge.kind === 'cierre' || nudge.kind === 'agua'),
    false,
  );
});

test('lo programado queda anotado y se puede marcar que hizo caso', async () => {
  const db = fresh();
  await withProfile(db);

  const plan = await nudgePlan(db, TODAY);
  await recordNudges(db, plan, 1000);
  // Programarlo dos veces no duplica la fila ni pisa la hora.
  await recordNudges(db, plan, 2000);

  const rows = await db.getAllAsync<{ id: string; sent_at: number; acted_at: number | null }>(
    'SELECT id, sent_at, acted_at FROM core_nudge ORDER BY id;',
  );
  assert.equal(rows.length, plan.length);
  assert.equal(rows[0].sent_at, 1000);
  assert.equal(rows[0].acted_at, null);

  await recordNudgeAction(db, rows[0].id, 3000);
  const acted = await db.getFirstAsync<{ acted_at: number }>(
    'SELECT acted_at FROM core_nudge WHERE id = ?;',
    [rows[0].id],
  );
  assert.equal(acted?.acted_at, 3000);
});
