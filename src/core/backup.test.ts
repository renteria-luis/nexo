import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';

import { addFoodEntry } from '../nutrition/queries.ts';
import { buildDayExports } from '../shell/records.ts';
import { cookRecipe, savePantryItem, saveRecipe } from '../pantry/index.ts';
import { addSet, startSession } from '../training/sessions.ts';

import { appendMessage, startChat } from './assistant.ts';
import { exportBackup, importBackup, parseBackup, BACKUP_FORMAT } from './backup.ts';
import { upsertDailyLog } from './daily-log.ts';

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
    execAsync: async (source: string) => {
      raw.exec(source);
    },
    withTransactionAsync: async (work: () => Promise<void>) => {
      raw.exec('BEGIN;');
      try {
        await work();
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
  raw.exec(`CREATE TABLE core_migration (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);`);
  for (const migration of migrations) {
    raw.exec(migration.sql);
    raw.prepare('INSERT INTO core_migration (id, applied_at) VALUES (?, ?);').run(migration.id, 1);
  }
  return { db: adapt(raw), raw };
}

test('what comes out of a phone goes back into another one unchanged', async () => {
  const source = fresh();
  await upsertDailyLog(source.db, {
    date: '2026-09-20',
    sleepMinutes: 450,
    sleepSource: 'manual',
    steps: 8200,
  });
  const backup = await exportBackup(source.db);

  // The file is what travels, so the test travels through it too.
  const travelled = parseBackup(JSON.parse(JSON.stringify(backup)));

  const target = fresh();
  await upsertDailyLog(target.db, {
    date: '2026-09-20',
    sleepMinutes: 1,
    sleepSource: 'manual',
    steps: 1,
  });
  const result = await importBackup(target.db, travelled);

  const restored = target.raw
    .prepare('SELECT sleep_minutes, steps FROM core_daily_log WHERE date = ?;')
    .get('2026-09-20') as { sleep_minutes: number; steps: number };

  assert.equal(restored.sleep_minutes, 450);
  assert.equal(restored.steps, 8200);
  assert.ok(result.rows > 0);
  assert.deepEqual(result.skipped, []);
});

test('the seeded catalogue survives a restore instead of being wiped', async () => {
  const source = fresh();
  const backup = await exportBackup(source.db);

  const target = fresh();
  await importBackup(target.db, backup);

  const foods = target.raw.prepare('SELECT count(*) AS n FROM nutrition_food;').get() as {
    n: number;
  };
  assert.equal(foods.n, 14);
});

test('a backup from a newer version of the app is refused, not half applied', async () => {
  const { db } = fresh();
  const backup = await exportBackup(db);
  backup.migrations = [...backup.migrations, '999_from_the_future'];

  await assert.rejects(() => importBackup(db, backup), /mas nueva/);
});

test('a file that is not a nexo backup says so', () => {
  assert.throws(() => parseBackup({ format: 'otra-cosa', version: 1 }), /no un respaldo/);
  assert.throws(() => parseBackup({ format: BACKUP_FORMAT, version: 99 }), /version/);
  assert.throws(() => parseBackup('{}'), /no es un objeto/);
});

test('el respaldo es de sus datos: las ofertas no entran', async () => {
  const { db, raw } = fresh();
  raw
    .prepare(
      `INSERT INTO deals_deal (id, source_id, title, fetched_at, confidence, raw_payload)
       VALUES ('flipp-1', 'flipp', 'Huevos', 1, 'exact', '{"mucho":"texto"}');`,
    )
    .run();

  const backup = await exportBackup(db);

  assert.equal(backup.tables.deals_deal, undefined);
  assert.equal(backup.tables.deals_source, undefined);
  // Lo suyo sigue estando entero.
  assert.ok(backup.tables.core_daily_log);
  assert.ok(backup.tables.training_set_entry);

  // Y restaurar no borra las ofertas que el telefono ya tenga.
  await importBackup(db, backup);
  const left = raw.prepare('SELECT count(*) AS n FROM deals_deal;').get() as { n: number };
  assert.equal(left.n, 1);
});

/**
 * El respaldo de verdad: un telefono con algo de todo dentro, incluidas las tablas que
 * llegaron despues (el chat del asistente, la despensa, el recetario), pasado por el
 * archivo y devuelto a otro telefono.
 *
 * Compara tabla por tabla y fila por fila en lugar de mirar tres campos: lo que rompe un
 * respaldo es siempre la tabla nueva que nadie volvio a probar.
 */
async function fillPhone(db: SQLiteDatabase) {
  await upsertDailyLog(db, {
    date: '2026-09-20',
    sleepMinutes: 450,
    sleepSource: 'manual',
    steps: 8200,
    waterMl: 2800,
    weightKg: 74.2,
    creatineTaken: true,
  });

  const sessionId = await startSession(db, {
    date: '2026-09-20',
    timeBudget: 'completo',
    gymId: 'fanshawe',
    routineId: null,
    aloneOrPartner: 'alone',
  });
  await addSet(db, { sessionId, exerciseId: 'incline-db-press', weightKg: 60, reps: 8, rpe: 8 });

  await addFoodEntry(db, {
    foodId: 'eggs-large',
    quantity: 3,
    unit: 'huevo',
    date: '2026-09-20',
    mealSlot: 'desayuno',
  });

  const chat = await startChat(db);
  await appendMessage(db, chat, 'me', 'pasos 8200');
  await appendMessage(db, chat, 'app', '8200 pasos hoy');

  const item = await savePantryItem(db, {
    name: 'Hamburguesas',
    kind: 'counted',
    quantity: 8,
    unit: 'unidad',
    state: null,
    hasIt: null,
    foodId: 'chicken-burger',
  });
  const spice = await savePantryItem(db, {
    name: 'Sal',
    kind: 'spice',
    quantity: null,
    unit: null,
    state: null,
    hasIt: true,
    foodId: null,
  });
  const recipe = await saveRecipe(db, {
    name: 'Pollo con arroz',
    steps: 'Uno\nDos',
    portions: 4,
    ingredients: [
      { itemId: item, amount: 3 },
      { itemId: spice, amount: null },
    ],
  });
  await cookRecipe(db, recipe, '2026-09-20');
}

function dump(raw: DatabaseSync): Record<string, unknown[]> {
  const names = raw
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'deals_%'
          AND name <> 'core_migration'
        ORDER BY name;`,
    )
    .all() as { name: string }[];

  const out: Record<string, unknown[]> = {};
  for (const { name } of names) {
    out[name] = raw.prepare(`SELECT * FROM ${name} ORDER BY rowid;`).all();
  }
  return out;
}

test('un telefono lleno cabe entero en el archivo y vuelve igual', async () => {
  const source = fresh();
  await fillPhone(source.db);

  const backup = await exportBackup(source.db);
  // Lo que viaja es el archivo, asi que la prueba viaja por el tambien.
  const text = JSON.stringify(backup);
  assert.ok(!text.includes('NaN') && !text.includes('Infinity'), 'el archivo no es JSON valido');
  const travelled = parseBackup(JSON.parse(text));

  const target = fresh();
  await upsertDailyLog(target.db, { date: '2026-09-20', steps: 1 });
  const result = await importBackup(target.db, travelled);

  assert.deepEqual(result.skipped, []);
  assert.deepEqual(dump(target.raw), dump(source.raw));
  assert.ok(result.rows > 10);
});

test('el archivo que escribe la app, con sus dias resueltos, sigue siendo importable', async () => {
  const source = fresh();
  await fillPhone(source.db);

  // Lo que escribe la pantalla de Ajustes lleva ademas un objeto por dia ya resuelto,
  // que es lo unico del archivo que no sale de una tabla.
  const days = await buildDayExports(source.db, '2026-09-21');
  const backup = await exportBackup(source.db, days);
  const text = JSON.stringify(backup, null, 2);
  assert.ok(!text.includes('NaN') && !text.includes('Infinity'), 'el archivo no es JSON valido');
  assert.ok(days.length > 0, 'un telefono con datos tiene dias que exportar');

  const target = fresh();
  const result = await importBackup(target.db, parseBackup(JSON.parse(text)));

  assert.deepEqual(result.skipped, []);
  assert.deepEqual(dump(target.raw), dump(source.raw));
});

test('restaurar el mismo archivo dos veces deja lo mismo, no el doble', async () => {
  const source = fresh();
  await fillPhone(source.db);
  const backup = parseBackup(JSON.parse(JSON.stringify(await exportBackup(source.db))));

  const target = fresh();
  await importBackup(target.db, backup);
  await importBackup(target.db, backup);

  assert.deepEqual(dump(target.raw), dump(source.raw));
});

test('un respaldo que dejaria referencias colgando no se aplica a medias', async () => {
  const source = fresh();
  await fillPhone(source.db);
  const backup = parseBackup(JSON.parse(JSON.stringify(await exportBackup(source.db))));
  // Un respaldo de antes de que existiera la despensa: no trae esas tablas, asi que al
  // restaurarlo lo que haya en ellas se queda donde esta.
  delete backup.tables.pantry_item;
  delete backup.tables.pantry_recipe;
  delete backup.tables.pantry_recipe_ingredient;

  // El caso de verdad: restaurar ese respaldo encima de un telefono donde ya hay algo
  // en la despensa que apunta a un alimento que ese respaldo no trae.
  const target = fresh();
  target.raw
    .prepare(
      `INSERT INTO nutrition_food
         (id, name, base_unit, unit_kind, base_unit_g, kcal, protein_g, fat_g, source)
       VALUES ('mi-alimento-nuevo', 'Mío', 'g', 'mass', 1, 1, 1, 1, 'user_measured');`,
    )
    .run();
  await savePantryItem(target.db, {
    name: 'Algo mio',
    kind: 'weighed',
    quantity: 100,
    unit: 'g',
    state: null,
    hasIt: null,
    foodId: 'mi-alimento-nuevo',
  });
  const before = dump(target.raw);

  await assert.rejects(() => importBackup(target.db, backup), /referencias rotas/);
  // Y el telefono se queda con lo suyo, no a medio restaurar.
  assert.deepEqual(dump(target.raw), before);
});
