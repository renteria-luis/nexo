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

import type { Nudge } from '../core/nudges.ts';

import {
  applyNudgeAction,
  fireAt,
  nudgePlan,
  recordNudgeAction,
  recordNudges,
  SCHEDULE_DAYS,
} from './nudges.ts';

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
      const result = raw.prepare(source).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
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
      heightCm: 180,
      birthDate: '1990-01-15',
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

  // Tres del cupo, y los dos de creatina, que van aparte.
  assert.equal(today.filter((nudge) => nudge.kind !== 'creatina').length, 3);
  assert.equal(today.filter((nudge) => nudge.kind === 'creatina').length, 2);
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

test('la creatina anotada hoy no se recuerda, y la de los dias por delante si', async () => {
  const db = fresh();
  await withProfile(db);
  await upsertDailyLog(db, { date: TODAY, creatineTaken: false });

  const plan = await nudgePlan(db, TODAY);
  const creatine = plan.filter((nudge) => nudge.kind === 'creatina');
  assert.equal(
    creatine.some((nudge) => nudge.date === TODAY),
    false,
  );
  assert.equal(creatine.length, 2 * (SCHEDULE_DAYS - 1));
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

/** Lo que hace una sincronizacion a esa hora, sin iOS: el plan, lo que se programa y lo anotado. */
async function syncAt(db: SQLiteDatabase, today: string, at: Date): Promise<Nudge[]> {
  const now = at.getTime();
  const plan = await nudgePlan(db, today);
  const scheduled = plan
    .map((nudge) => ({ nudge, firesAt: fireAt(nudge).getTime() }))
    .filter(({ firesAt }) => firesAt > now);
  await recordNudges(db, plan, scheduled, today, now);
  return plan;
}

function on(date: string, hour: number, minute = 0): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

/** Todo lo del dia, anotado a esa hora: no queda nada que recordarle. */
async function logEverything(db: SQLiteDatabase, date: string, at: Date): Promise<void> {
  await upsertDailyLog(db, {
    date,
    sleepMinutes: 450,
    sleepSource: 'manual',
    weightKg: 73,
    waterMl: 3000,
    steps: 8000,
    creatineTaken: true,
  });
  await db.runAsync(
    `INSERT INTO training_session (id, date, start_time, time_budget) VALUES (?, ?, ?, 'completo');`,
    [`s-${date}`, date, at.getTime()],
  );
  await db.runAsync(
    `INSERT INTO training_set_entry (id, session_id, exercise_id, set_index, weight_kg, reps, timestamp)
     VALUES (?, ?, 'peck-deck', 1, 50, 10, ?);`,
    [`e-${date}`, `s-${date}`, at.getTime()],
  );
  for (const slot of ['desayuno', 'media mañana', 'mediodía', 'tarde', 'cena']) {
    await db.runAsync(
      `INSERT INTO nutrition_food_entry (id, food_id, quantity, unit, timestamp, date, meal_slot)
       VALUES (?, 'eggs-large', 2, 'huevo', ?, ?, ?);`,
      [`f-${date}-${slot}`, at.getTime(), date, slot],
    );
  }
}

test('lo programado queda anotado con su hora y se puede marcar que hizo caso', async () => {
  const db = fresh();
  await withProfile(db);

  const early = on(TODAY, 6);
  const plan = await syncAt(db, TODAY, early);
  // Programarlo dos veces no duplica la fila ni pisa cuando se programo.
  await syncAt(db, TODAY, on(TODAY, 6, 5));

  const rows = await db.getAllAsync<{
    id: string;
    sent_at: number;
    acted_at: number | null;
    fires_at: number | null;
  }>('SELECT id, sent_at, acted_at, fires_at FROM core_nudge ORDER BY id;');
  assert.equal(rows.length, new Set(plan.map((nudge) => nudge.id)).size);
  assert.equal(rows[0].sent_at, early.getTime());
  assert.equal(rows[0].acted_at, null);
  assert.ok((rows[0].fires_at ?? 0) > early.getTime());

  assert.equal(
    await recordNudgeAction(db, { nudgeId: rows[0].id, kind: 'cierre' }, TODAY, 3000),
    true,
  );
  // La segunda vez no es hacer caso otra vez.
  assert.equal(
    await recordNudgeAction(db, { nudgeId: rows[0].id, kind: 'cierre' }, TODAY, 4000),
    false,
  );
  const acted = await db.getFirstAsync<{ acted_at: number }>(
    'SELECT acted_at FROM core_nudge WHERE id = ?;',
    [rows[0].id],
  );
  assert.equal(acted?.acted_at, 3000);
});

test('quien anota todo a tiempo no se queda sin avisos el dia que se le olvida', async () => {
  const db = fresh();
  await withProfile(db);

  // Seis dias abriendo la app a las 8:00 y anotando todo a las 8:05: no sale ni un aviso.
  for (const date of [
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
    '2026-10-09',
    '2026-10-10',
  ]) {
    await syncAt(db, date, on(date, 8));
    await logEverything(db, date, on(date, 8, 5));
    await syncAt(db, date, on(date, 8, 6));
  }

  // El septimo se le olvida. Antes, todo lo planeado contaba como ignorado y ese dia solo
  // quedaba el resumen del domingo.
  const forgotten = (await syncAt(db, '2026-10-11', on('2026-10-11', 8))).filter(
    (nudge) => nudge.date === '2026-10-11',
  );
  const kinds = forgotten.map((nudge) => nudge.kind);
  assert.ok(kinds.includes('cierre'), kinds.join(', '));
  assert.ok(kinds.includes('manana'), kinds.join(', '));
});

test('un aviso que salio y despues anoto lo que pedia cuenta como que hizo caso', async () => {
  const db = fresh();
  await withProfile(db);

  await syncAt(db, '2026-10-05', on('2026-10-05', 8));
  // El de la manana salio a las 8:15 y a las 9:00 anoto el sueno y el peso.
  await upsertDailyLog(db, {
    date: '2026-10-05',
    sleepMinutes: 450,
    sleepSource: 'manual',
    weightKg: 73,
  });
  await syncAt(db, '2026-10-05', on('2026-10-05', 9));

  const row = await db.getFirstAsync<{ acted_at: number | null }>(
    "SELECT acted_at FROM core_nudge WHERE id = 'manana-2026-10-05';",
  );
  assert.equal(row?.acted_at, on('2026-10-05', 9).getTime());
});

test('un aviso que salio tres dias y no hizo caso si se calla', async () => {
  const db = fresh();
  await withProfile(db);

  // Abre la app a las 8:00 y no anota nada: el de la manana sale a las 8:15 cada dia.
  for (const date of ['2026-10-05', '2026-10-06', '2026-10-07']) {
    await syncAt(db, date, on(date, 8));
  }

  const fourth = await syncAt(db, '2026-10-08', on('2026-10-08', 8));
  assert.equal(
    fourth.some((nudge) => nudge.date === '2026-10-08' && nudge.kind === 'manana'),
    false,
  );
});

test('el mismo toque en "+710 ml" llega dos veces y suma una botella, no dos', async () => {
  const db = fresh();
  await withProfile(db);
  await syncAt(db, TODAY, on(TODAY, 6));
  const water = async () =>
    (
      await db.getFirstAsync<{ water_ml: number | null }>(
        'SELECT water_ml FROM core_daily_log WHERE date = ?;',
        [TODAY],
      )
    )?.water_ml;

  // Lo que guardo iOS al abrir la app y lo que entrego el oyente son el mismo toque.
  const tap = { nudgeId: `agua-${TODAY}`, kind: 'agua' as const, action: 'agua' };
  await applyNudgeAction(db, tap, TODAY, 1000);
  await applyNudgeAction(db, tap, TODAY, 2000);
  assert.equal(await water(), 710);

  await applyNudgeAction(
    db,
    { nudgeId: `entreno-${TODAY}`, kind: 'entreno', action: 'descanso' },
    TODAY,
    3000,
  );
  const day = await db.getFirstAsync<{ rest_day: number }>(
    'SELECT rest_day FROM core_daily_log WHERE date = ?;',
    [TODAY],
  );
  assert.equal(day?.rest_day, 1);
});
