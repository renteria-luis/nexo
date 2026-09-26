import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';

import {
  listCatalog,
  loadExerciseCard,
  setExerciseGym,
  setExerciseNote,
  setRoutineSets,
  setRoutineTier,
  updateExercise,
} from './catalog.ts';
import { loadRoutine } from './routines.ts';

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

test('el catalogo dice con que se hace cada ejercicio y en cuantas rutinas entra', async () => {
  const db = fresh();
  const catalog = await listCatalog(db);

  const lateral = catalog.find((item) => item.id === 'lateral-raise');
  assert.deepEqual(lateral?.implements, ['dumbbell', 'cable', 'machine']);
  assert.ok((lateral?.routines ?? 0) > 0);

  // El press inclinado no se hace en polea, y por eso no lleva nada que elegir.
  const press = catalog.find((item) => item.id === 'incline-db-press');
  assert.deepEqual(press?.implements, []);
});

test('editar un ejercicio se guarda y se vuelve a leer', async () => {
  const db = fresh();

  await updateExercise(db, 'incline-db-press', {
    name: 'Press inclinado',
    restSeconds: 150,
    loadIncrement: 2,
    unilateral: true,
    // Se guardan en el orden de siempre, no en el que lleguen.
    implements: ['machine', 'dumbbell'],
  });

  const card = await loadExerciseCard(db, 'incline-db-press');
  assert.equal(card.exercise.name_es, 'Press inclinado');
  assert.equal(card.exercise.default_rest_seconds, 150);
  assert.equal(card.exercise.load_increment, 2);
  assert.equal(card.exercise.unilateral, 1);
  assert.deepEqual(card.implements, ['dumbbell', 'machine']);

  await assert.rejects(() => updateExercise(db, 'incline-db-press', { name: '   ' }));
  await assert.rejects(() => updateExercise(db, 'incline-db-press', { restSeconds: 0 }));
});

test('la nota de la (i) va por implemento, y vacia se borra', async () => {
  const db = fresh();

  await setExerciseNote(db, 'lateral-raise', '', 'Codo con flexion ligera.');
  await setExerciseNote(db, 'lateral-raise', 'cable', 'La polea manda tension abajo.');

  let card = await loadExerciseCard(db, 'lateral-raise');
  assert.equal(card.notes[''], 'Codo con flexion ligera.');
  assert.equal(card.notes.cable, 'La polea manda tension abajo.');

  await setExerciseNote(db, 'lateral-raise', 'cable', '   ');
  card = await loadExerciseCard(db, 'lateral-raise');
  assert.equal(card.notes.cable, undefined);
  assert.equal(card.notes[''], 'Codo con flexion ligera.');
});

test('quitar un ejercicio de un gimnasio lo saca de ahi y nada mas', async () => {
  const db = fresh();

  const before = await loadExerciseCard(db, 'lateral-raise');
  const gym = before.gyms.find((item) => item.available);
  assert.ok(gym, 'las laterales tienen que estar en algun gimnasio');

  await setExerciseGym(db, 'lateral-raise', gym.id, false);
  const after = await loadExerciseCard(db, 'lateral-raise');
  assert.equal(after.gyms.find((item) => item.id === gym.id)?.available, false);

  // Y volver a ponerlo dos veces no duplica la fila.
  await setExerciseGym(db, 'lateral-raise', gym.id, true);
  await setExerciseGym(db, 'lateral-raise', gym.id, true);
  const again = await loadExerciseCard(db, 'lateral-raise');
  assert.equal(again.gyms.filter((item) => item.id === gym.id).length, 1);
});

test('las series por tiempo deciden que se cae del plan recortado', async () => {
  const db = fresh();

  const card = await loadExerciseCard(db, 'incline-db-press');
  const routine = card.routines[0];
  assert.ok(routine, 'el press inclinado tiene que estar en alguna rutina');

  // De nucleo no se recorta, y el esquema lo exige: primero baja de importancia.
  await assert.rejects(() =>
    setRoutineSets(db, routine.routineId, 'incline-db-press', 'express', null),
  );

  await setRoutineTier(db, routine.routineId, 'incline-db-press', 2);
  await setRoutineSets(db, routine.routineId, 'incline-db-press', 'express', null);

  const exercises = await loadRoutine(db, routine.routineId);
  const press = exercises.find((item) => item.exerciseId === 'incline-db-press');
  assert.equal(press?.setsExpress, null);
  assert.equal(press?.tier, 2);

  // El tiempo completo no puede quedarse sin series: eso seria sacarlo de la rutina.
  await assert.rejects(() =>
    setRoutineSets(db, routine.routineId, 'incline-db-press', 'completo', null),
  );
  await assert.rejects(() =>
    setRoutineSets(db, routine.routineId, 'incline-db-press', 'minus_25', 0),
  );

  // Y volver a subirlo a nucleo le devuelve las series en todos los tiempos.
  await setRoutineTier(db, routine.routineId, 'incline-db-press', 1);
  const back = await loadRoutine(db, routine.routineId);
  const core = back.find((item) => item.exerciseId === 'incline-db-press');
  assert.equal(core?.setsExpress, core?.setsFull);
});
