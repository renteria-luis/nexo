import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { readDailyLog, storeScore, upsertDailyLog } from '../core/daily-log.ts';
import { currentStreak, longestStreak } from '../core/discipline.ts';
import { setInitialTargets } from '../core/snapshots.ts';
import { averageScore, buildGrid } from '../core/heatmap.ts';
import { readSettings, reEntryFrom } from '../core/settings.ts';
import { addDays, todayIso } from '../core/dates.ts';
import { applySnapshot, parseSnapshot } from '../deals/snapshot.ts';
import { migrations } from '../db/migrations/index.ts';
import { addFoodEntry } from '../nutrition/index.ts';
import { addSet, finishSession, startSession } from '../training/index.ts';

import { load, REREAD_ALL, REREAD_FOODS, REREAD_NOTHING, withFresh } from './load.ts';

type SqlValue = string | number | null;

/** La base de la app en memoria, contando lo que cada consulta devuelve y de donde. */
function fixture() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);

  const reads: { source: string; rows: number }[] = [];
  const db = {
    getAllAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T[]> => {
      const rows = raw.prepare(source).all(...params) as T[];
      reads.push({ source, rows: rows.length });
      return rows;
    },
    getFirstAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T | null> => {
      const row = (raw.prepare(source).get(...params) as T) ?? null;
      reads.push({ source, rows: row === null ? 0 : 1 });
      return row;
    },
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

  return { db, reads };
}

const today = todayIso();

async function seeded() {
  const { db, reads } = fixture();
  await applySnapshot(db, parseSnapshot(readFileSync('deals/flipp.json', 'utf8')));
  for (let back = 0; back < 30; back += 1) {
    await addFoodEntry(db, {
      foodId: 'chicken-breast-kirkland',
      quantity: 200,
      unit: 'g',
      date: addDays(today, -back),
      mealSlot: 'mediodía',
    });
  }
  reads.length = 0;
  return { db, reads };
}

const touches = (reads: { source: string }[], table: string, also = '') =>
  reads.filter(({ source }) => source.includes(`FROM ${table}`) && source.includes(also));

test('una botella no vuelve a leer las ofertas ni lo comido en los ultimos noventa dias', async () => {
  const { db, reads } = await seeded();
  const opened = withFresh(null, await load(db, null, true, REREAD_ALL, null));
  assert.ok(opened.deals.length > 100, 'the real snapshot is loaded');
  const fullRows = reads.reduce((sum, read) => sum + read.rows, 0);

  reads.length = 0;
  await upsertDailyLog(db, { date: today, waterMl: 710 });
  const fresh = await load(db, null, false, REREAD_NOTHING, today);

  assert.equal(fresh.dealSlice, null);
  assert.equal(fresh.foodSlice, null);
  assert.deepEqual(touches(reads, 'deals_deal'), []);
  assert.deepEqual(touches(reads, 'nutrition_food_entry', 'BETWEEN'), []);
  const tapRows = reads.reduce((sum, read) => sum + read.rows, 0);
  assert.ok(tapRows * 3 < fullRows, `${tapRows} rows per bottle against ${fullRows} to open`);

  // Lo que no releyo se queda como estaba en pantalla, y el agua nueva entra.
  const shown = withFresh(opened, fresh);
  assert.equal(shown.deals, opened.deals);
  assert.equal(shown.foodHistory, opened.foodHistory);
  assert.equal(shown.today.log?.water_ml, 710);
});

test('anotar comida relee lo comido pero no las ofertas', async () => {
  const { db, reads } = await seeded();
  const fresh = await load(db, null, false, REREAD_FOODS, today);

  assert.ok(fresh.foodSlice);
  assert.equal(fresh.dealSlice, null);
  assert.deepEqual(touches(reads, 'deals_deal'), []);
});

test('un dia nuevo lo relee todo, porque lo comido y lo vencido dependen de hoy', async () => {
  const { db } = await seeded();
  const fresh = await load(db, null, false, REREAD_NOTHING, addDays(today, -1));

  assert.ok(fresh.foodSlice);
  assert.ok(fresh.dealSlice);
});

test('sin nada en pantalla, una carga que se salto algo falla en vez de pintar a medias', async () => {
  const { db } = await seeded();
  const fresh = await load(db, null, false, REREAD_NOTHING, today);

  assert.throws(() => withFresh(null, fresh), /nothing on screen/);
});

async function trainedOn(db: SQLiteDatabase, date: string) {
  const sessionId = await startSession(db, { date, timeBudget: 'completo' });
  await addSet(db, { sessionId, exerciseId: 'peck-deck', weightKg: 50, reps: 10 });
}

test('diez dias sin entrenar encienden la readaptacion en la carga del dia', async () => {
  const { db } = fixture();
  for (const back of [14, 13, 12, 11, 10]) await trainedOn(db, addDays(today, -back));

  // Sin el trabajo de fondo no se mira: es lo que corre la primera carga de cada dia.
  await load(db, null, false, REREAD_ALL, null);
  assert.equal(reEntryFrom(await readSettings(db)).startedOn, null);

  const fresh = await load(db, null, true, REREAD_ALL, null);
  assert.equal(reEntryFrom(await readSettings(db)).startedOn, today);
  assert.equal(fresh.readapting?.week, 1);
});

test('una semana normal no la enciende', async () => {
  const { db } = fixture();
  for (const back of [6, 5, 3, 2, 1]) await trainedOn(db, addDays(today, -back));

  await load(db, null, true, REREAD_ALL, null);
  assert.equal(reEntryFrom(await readSettings(db)).startedOn, null);
});

test('una sesion de anoche que sigue abierta despues de medianoche se sigue viendo', async () => {
  const { db } = fixture();
  const yesterday = addDays(today, -1);
  // Empezo a las 23:30 de ayer, que para el reloj fue hace un rato.
  const sessionId = await startSession(db, { date: yesterday, timeBudget: 'completo' });
  await addSet(db, { sessionId, exerciseId: 'peck-deck', weightKg: 40, reps: 12 });

  const fresh = await load(db, 'peck-deck', false, REREAD_ALL, null);

  assert.equal(fresh.today.date, today);
  assert.equal(fresh.today.session?.id, sessionId);
  assert.deepEqual(
    fresh.exercise.todaySets.map((set) => [set.date, set.weightKg]),
    [[yesterday, 40]],
  );
  // Hoy no gano un entreno por esto: la sesion es de su dia.
  assert.notEqual(fresh.today.trained, true);
});

test('una sesion de ayer ya cerrada, o escrita despues, no se arrastra a hoy', async () => {
  const { db } = fixture();
  const yesterday = addDays(today, -1);
  const closed = await startSession(db, { date: yesterday, timeBudget: 'completo' });
  await addSet(db, { sessionId: closed, exerciseId: 'peck-deck', weightKg: 40, reps: 12 });
  await finishSession(db, closed);
  // Abrir un dia pasado desde Registros crea una sesion sin cerrar, pero nunca estuvo en curso.
  // Otro dia, porque el id lleva la fecha y la hora y dos en el mismo milisegundo chocan.
  await startSession(db, {
    date: addDays(today, -2),
    timeBudget: 'completo',
    isRetroactive: true,
  });

  const fresh = await load(db, null, false, REREAD_ALL, null);
  assert.equal(fresh.today.session, null);
});

test('streaks retain scored history beyond the twelve-week grid', async () => {
  const { db } = fixture();
  for (let back = 0; back < 100; back += 1) {
    const date = addDays(today, -back);
    await upsertDailyLog(db, { date, creatineTaken: true });
    await storeScore(db, date, 80);
  }
  const fresh = await load(db, null, false, REREAD_ALL, null);
  // Today's incomplete score does not break yesterday's ongoing run.
  assert.equal(currentStreak(fresh.scoreHistory, today), 99);
  assert.equal(longestStreak(fresh.scoreHistory, today), 99);
  assert.ok(fresh.days.length < fresh.scoreHistory.length);

  await storeScore(db, addDays(today, -1), 0);
  const broken = await load(db, null, false, REREAD_ALL, null);
  assert.equal(currentStreak(broken.scoreHistory, today), 0);
  assert.equal(longestStreak(broken.scoreHistory, today), 98);
});

test('a score reset also recovers days older than the grid', async () => {
  const { db, reads } = fixture();
  const old = addDays(today, -150);
  await setInitialTargets(
    db,
    80,
    {
      heightCm: 175,
      birthDate: '1990-01-01',
      activityFactor: 1.5,
      phase: 'recomp',
      steps: 7000,
      sleepMinutes: 420,
    },
    old,
  );
  await upsertDailyLog(db, { date: old, creatineTaken: true });
  const fresh = await load(db, null, true, REREAD_ALL, null);
  assert.notEqual((await readDailyLog(db, old))?.score, null);
  assert.ok(fresh.scoreHistory.some((day) => day.date === old));
  assert.ok(fresh.days.every((day) => day.date > old));

  reads.length = 0;
  await load(db, null, true, REREAD_ALL, null);
  const pending = reads.filter(({ source }) => source.includes('SELECT DISTINCT trace.date'));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].rows, 0);
});

test('food alone stores a score and colors today and past grid cells', async () => {
  for (const date of [today, addDays(today, -1)]) {
    const { db } = fixture();
    await setInitialTargets(
      db,
      80,
      {
        heightCm: 175,
        birthDate: '1990-01-01',
        activityFactor: 1.5,
        phase: 'recomp',
        steps: 7000,
        sleepMinutes: 420,
      },
      date,
    );
    await addFoodEntry(db, {
      foodId: 'chicken-breast-kirkland',
      quantity: 200,
      unit: 'g',
      date,
      mealSlot: 'mediodía',
    });
    const fresh = await load(db, null, date !== today, REREAD_ALL, null);
    const stored = await readDailyLog(db, date);
    assert.ok(stored && stored.score !== null);
    const cell = fresh.days.find((day) => day.date === date);
    assert.ok(cell?.hasData);
    assert.equal(cell.score, stored.score);
    assert.equal(averageScore(fresh.days), stored.score);
    const grid = buildGrid(fresh.days, { from: date, to: today }, 'deutan');
    assert.equal(
      grid.flatMap((week) => week.cells).find((day) => day.date === date)?.score,
      stored.score,
    );
    if (date !== today) assert.equal(fresh.today.result?.score ?? null, null);
  }
});
