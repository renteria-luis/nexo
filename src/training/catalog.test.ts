import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';

import {
  listCatalog,
  createExercise,
  archiveExercise,
  setExerciseRoutine,
  loadExerciseCard,
  setExerciseGym,
  setExerciseNote,
  setRoutineSets,
  setRoutineTier,
  updateExercise,
} from './catalog.ts';
import { loadRoutine, loadRoutinePlan, loadSessionPlan } from './routines.ts';
import { lastSessionSets } from './sessions.ts';

type SqlValue = string | number | null;

function fresh(upTo?: string): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) {
    raw.exec(migration.sql);
    if (migration.id === upTo) break;
  }
  return {
    execAsync: async (source: string) => {
      raw.exec(source);
    },
    withTransactionAsync: async (work: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await work();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
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
  assert.deepEqual(lateral?.implements, []);
  assert.equal(catalog.filter((entry) => entry.familyId === 'lateral-raise').length, 3);
  assert.ok((lateral?.routines ?? 0) > 0);
  const machine = catalog.find((item) => item.id === 'lateral-raise-machine');
  assert.equal(
    machine?.routines,
    lateral?.routines,
    'a gym variant belongs to the same routine family',
  );
  const machineCard = await loadExerciseCard(db, 'lateral-raise-machine');
  assert.ok(machineCard.familyRoutines.some((routine) => routine.id === 'push'));

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
  });

  const card = await loadExerciseCard(db, 'incline-db-press');
  assert.equal(card.exercise.name_es, 'Press inclinado');
  assert.equal(card.exercise.default_rest_seconds, 150);
  assert.equal(card.exercise.load_increment, 2);
  assert.equal(card.exercise.unilateral, 1);
  assert.deepEqual(card.implements, []);

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

const custom = {
  name: 'Custom press',
  muscle: 'chest',
  equipmentType: 'machine',
  unilateral: false,
  restSeconds: 150,
  loadIncrement: 2.5,
  note: 'My technique',
  secondaryMuscles: ['triceps'],
} as const;

test('custom exercises and variants are complete, editable, and available in future routines', async () => {
  const db = fresh();
  const id = await createExercise(db, {
    ...custom,
    secondaryMuscles: [...custom.secondaryMuscles],
  });
  const variant = await createExercise(db, {
    ...custom,
    name: 'Custom unilateral press',
    equipmentType: 'cable',
    unilateral: true,
    variantOf: id,
    secondaryMuscles: [],
  });
  const card = await loadExerciseCard(db, variant);
  assert.equal(card.familyId, id);
  assert.equal(card.variants.length, 2);
  assert.equal(card.notes[''], 'My technique');
  assert.ok(card.gyms.every((gym) => gym.available));
  await setExerciseRoutine(db, id, 'push', true);
  await setExerciseRoutine(db, id, 'push', true);
  assert.equal((await loadRoutine(db, 'push')).filter((row) => row.exerciseId === id).length, 1);
  assert.equal(
    (await loadRoutine(db, 'push', 'fanshawe')).find((row) => row.exerciseId === id)?.fullTime,
    null,
  );
  await setExerciseRoutine(db, id, 'push', false);
  assert.equal(
    (await loadRoutine(db, 'push')).some((row) => row.exerciseId === id),
    false,
  );
  await updateExercise(db, variant, { familyName: 'My press family' });
  assert.equal((await loadExerciseCard(db, id)).familyName, 'My press family');
});

test('invalid creation and storage failures roll back the whole catalog entry', async () => {
  const db = fresh();
  const before = await listCatalog(db);
  await assert.rejects(createExercise(db, { ...custom, secondaryMuscles: ['not-a-muscle'] }));
  assert.equal((await listCatalog(db)).length, before.length);
  await db.execAsync(`CREATE TRIGGER fail_note BEFORE INSERT ON training_exercise_note
    BEGIN SELECT RAISE(ABORT, 'storage failure'); END;`);
  await assert.rejects(createExercise(db, { ...custom, secondaryMuscles: [] }), /storage failure/);
  assert.equal((await listCatalog(db)).length, before.length);
});

test('archiving preserves notes and historical sets, hides routine choices, and is reversible', async () => {
  const db = fresh();
  await db.execAsync(`INSERT INTO training_session (id, date, time_budget, end_time) VALUES ('past', '2026-10-01', 'completo', 200);
    INSERT INTO training_set_entry (id, session_id, exercise_id, set_index, weight_kg, reps, timestamp)
    VALUES ('past-set', 'past', 'lateral-raise-machine', 1, 20, 12, 100);`);
  const before = await db.getAllAsync('SELECT * FROM training_set_entry;');
  await archiveExercise(db, 'lateral-raise-machine', true);
  assert.deepEqual(await db.getAllAsync('SELECT * FROM training_set_entry;'), before);
  assert.ok((await loadExerciseCard(db, 'lateral-raise-machine')).notes['']);
  assert.equal((await loadExerciseCard(db, 'lateral-raise-machine')).exercise.archived, 1);
  assert.equal(
    (await loadRoutine(db, 'push', 'fit4less-proudfoot')).some(
      (entry) => entry.fullTime?.exerciseId === 'lateral-raise-machine',
    ),
    false,
  );
  await archiveExercise(db, 'lateral-raise-machine', false);
  assert.equal((await loadExerciseCard(db, 'lateral-raise-machine')).exercise.archived, 0);
});

test('archiving the base variant keeps the available preferred variant in its routine slot', async () => {
  const db = fresh();
  await archiveExercise(db, 'lateral-raise', true);
  for (const budget of ['completo', 'minus_50'] as const) {
    const plan = await loadRoutinePlan(db, 'push', budget, 'fit4less-proudfoot');
    assert.equal(
      plan.exercises.some((entry) => entry.exerciseId === 'lateral-raise'),
      false,
    );
    assert.equal(
      plan.exercises.some((entry) => entry.exerciseId === 'lateral-raise-machine'),
      true,
    );
  }
  await archiveExercise(db, 'lateral-raise-cable', true);
  await archiveExercise(db, 'lateral-raise-machine', true);
  const plan = await loadRoutinePlan(db, 'push', 'completo', 'fit4less-proudfoot');
  assert.equal(
    plan.exercises.some((entry) => entry.exerciseId.startsWith('lateral-raise')),
    false,
  );
});

test('migration preserves customized notes, names, and every historical set while resolving old equipment chips', async () => {
  const db = fresh('057_multi_session_score');
  await db.runAsync(
    "UPDATE training_exercise SET name_es = 'My lateral raise' WHERE id = 'lateral-raise';",
  );
  await db.runAsync(
    "INSERT INTO training_exercise_note (exercise_id, implement, note) VALUES ('lateral-raise', 'cable', 'My old cable explanation') ON CONFLICT (exercise_id, implement) DO UPDATE SET note=excluded.note;",
  );
  await db.runAsync(
    "UPDATE training_exercise_note SET note='My machine explanation' WHERE exercise_id='lateral-raise-machine' AND implement='';",
  );
  await db.execAsync(`INSERT INTO training_session (id, date, time_budget) VALUES ('past', '2026-10-01', 'completo');
    INSERT INTO training_set_entry (id, session_id, exercise_id, set_index, weight_kg, reps, timestamp, implement)
    VALUES ('past-set', 'past', 'lateral-raise', 1, 20, 12, 100, 'cable');`);
  const before = await db.getAllAsync('SELECT * FROM training_set_entry;');
  await db.execAsync(migrations.find((migration) => migration.id === '058_exercise_catalog')!.sql);
  assert.deepEqual(await db.getAllAsync('SELECT * FROM training_set_entry;'), before);
  const base = await loadExerciseCard(db, 'lateral-raise');
  assert.equal(base.exercise.name_es, 'My lateral raise');
  assert.equal(base.familyName, 'My lateral raise');
  assert.equal(base.variants.length, 3);
  assert.equal(base.notes.cable, 'My old cable explanation');
  assert.equal(
    (await loadExerciseCard(db, 'lateral-raise-cable')).notes.cable,
    'My old cable explanation',
  );
  assert.equal(
    (await loadExerciseCard(db, 'lateral-raise-machine')).notes[''],
    'My machine explanation',
  );
});

/** A database one step before the sets moved, with a past session holding these sets. */
async function beforeSetVariants(sets: string): Promise<SQLiteDatabase> {
  const db = fresh('060_deal_match_verdict');
  await db.execAsync(`INSERT INTO training_session (id, date, start_time, end_time, time_budget)
    VALUES ('past', '2026-10-01', 1, 1000000, 'completo');
    INSERT INTO training_set_entry
      (id, session_id, exercise_id, set_index, weight_kg, reps, timestamp, implement)
    VALUES ${sets};`);
  return db;
}

const setVariants = migrations.find((migration) => migration.id === '061_set_variants')!.sql;
const rows = async (db: SQLiteDatabase) =>
  (
    await db.getAllAsync<{ id: string; exercise_id: string; set_index: number }>(
      'SELECT id, exercise_id, set_index FROM training_set_entry ORDER BY id;',
    )
  ).map((row) => ({ ...row }));

test('old sets marked with dumbbells leave the cable hammer curl, and its plan goes with them', async () => {
  const db = await beforeSetVariants(`
    ('h1', 'past', 'hammer-curl', 1, 11.34, 12, 100, 'dumbbell'),
    ('h2', 'past', 'hammer-curl', 2, 11.34, 10, 200, 'dumbbell'),
    ('h3', 'past', 'hammer-curl', 3, 11.34, 9, 300, 'dumbbell')`);
  await db.execAsync(`INSERT INTO training_session_plan
    (session_id, exercise_id, position, sets_planned, rest_seconds)
    VALUES ('past', 'hammer-curl', 1, 3, 120);
    INSERT INTO training_exercise_time
      (session_id, exercise_id, implement, set_count, sample_count, flagged_count, minutes)
    VALUES ('past', 'hammer-curl', 'dumbbell', 3, 2, 0, 6);`);
  await db.execAsync(setVariants);

  assert.deepEqual(await lastSessionSets(db, 'hammer-curl', null), []);
  const moved = await lastSessionSets(db, 'hammer-curl-variant-dumbbell', null);
  assert.deepEqual(
    moved.map((set) => [set.setIndex, set.reps, set.loadFactor]),
    [
      [1, 12, 2],
      [2, 10, 2],
      [3, 9, 2],
    ],
  );
  assert.deepEqual(
    (await loadSessionPlan(db, 'past')).map((entry) => [entry.exerciseId, entry.sets]),
    [['hammer-curl-variant-dumbbell', 3]],
  );
  // The pace learned from that session was filed under the old exercise: it is rebuilt.
  assert.deepEqual(await db.getAllAsync('SELECT * FROM training_exercise_time;'), []);
});

test('a session that mixed both keeps each set with its own, numbered by time', async () => {
  const db = await beforeSetVariants(`
    ('h1', 'past', 'hammer-curl', 1, 11.34, 12, 100, 'dumbbell'),
    ('h2', 'past', 'hammer-curl', 2, 11.34, 10, 200, 'dumbbell'),
    ('h3', 'past', 'hammer-curl', 3, 22.68, 12, 300, 'cable'),
    ('n1', 'past', 'hammer-curl', 4, 22.68, 12, 400, NULL)`);
  await db.execAsync(`INSERT INTO training_session_plan
    (session_id, exercise_id, position, sets_planned, rest_seconds)
    VALUES ('past', 'hammer-curl', 1, 4, 120);`);
  await db.execAsync(setVariants);

  assert.deepEqual(await rows(db), [
    { id: 'h1', exercise_id: 'hammer-curl-variant-dumbbell', set_index: 1 },
    { id: 'h2', exercise_id: 'hammer-curl-variant-dumbbell', set_index: 2 },
    { id: 'h3', exercise_id: 'hammer-curl', set_index: 1 },
    { id: 'n1', exercise_id: 'hammer-curl', set_index: 2 },
  ]);
  // Something stayed behind, so the plan does not move.
  assert.deepEqual(
    (await loadSessionPlan(db, 'past')).map((entry) => entry.exerciseId),
    ['hammer-curl'],
  );
});

test('sets joining a variant that already had sets that day fall in line by time', async () => {
  const db = await beforeSetVariants(`
    ('l1', 'past', 'lateral-raise', 1, 9.07, 12, 100, 'cable'),
    ('c1', 'past', 'lateral-raise-cable', 1, 4.54, 12, 200, NULL),
    ('l2', 'past', 'lateral-raise', 2, 9.07, 12, 300, 'cable'),
    ('m1', 'past', 'lateral-raise', 3, 20, 12, 400, 'machine'),
    ('b1', 'past', 'lateral-raise', 4, 20, 12, 500, 'barbell'),
    ('d1', 'past', 'lateral-raise', 5, 6.8, 12, 600, 'dumbbell')`);
  await db.execAsync(`INSERT INTO training_session_plan
    (session_id, exercise_id, position, sets_planned, rest_seconds)
    VALUES ('past', 'lateral-raise', 1, 3, 120), ('past', 'lateral-raise-cable', 2, 1, 120);`);
  await db.execAsync(setVariants);

  assert.deepEqual(await rows(db), [
    // No barbell lateral raise exists, so that set stays where it was.
    { id: 'b1', exercise_id: 'lateral-raise', set_index: 1 },
    { id: 'c1', exercise_id: 'lateral-raise-cable', set_index: 2 },
    { id: 'd1', exercise_id: 'lateral-raise', set_index: 2 },
    { id: 'l1', exercise_id: 'lateral-raise-cable', set_index: 1 },
    { id: 'l2', exercise_id: 'lateral-raise-cable', set_index: 3 },
    { id: 'm1', exercise_id: 'lateral-raise-machine', set_index: 1 },
  ]);
  assert.deepEqual(
    (await loadSessionPlan(db, 'past')).map((entry) => [entry.exerciseId, entry.sets]),
    [
      ['lateral-raise', 3],
      ['lateral-raise-cable', 1],
    ],
  );
});
