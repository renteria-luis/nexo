// Editar el catalogo desde la app: el ejercicio, donde lo tiene y como entra en cada
// rutina.
//
// Hasta ahora todo esto vivia en migraciones, asi que cambiar "las laterales tambien se
// pueden hacer en maquina" o "en Fit4Less no hay hack squat" era pedir codigo nuevo.
// Son sus datos y los conoce mejor que nadie; lo unico que no se toca desde aqui es lo
// que la app usa como vocabulario cerrado (el musculo y el tipo de equipo), porque un
// valor inventado ahi no falla, solo cuenta mal.

import type { SQLiteDatabase } from 'expo-sqlite';

import type { TrainingExerciseRow, TrainingGymRow, TrainingRoutineRow } from '../db/types.ts';

import { parseImplements, SWAPPABLE, type Swappable } from './queries.ts';
import type { TimeBudget } from './routines.ts';

/** Una linea de la lista: lo justo para encontrarlo y saber que tiene puesto. */
export type CatalogEntry = {
  id: string;
  name: string;
  muscle: string;
  implements: Swappable[];
  /** En cuantas rutinas entra, para ver de un vistazo cual esta suelto. */
  routines: number;
};

export type ExerciseGym = {
  id: string;
  name: string;
  /** Si lo tiene ahi. Sin esto el plan de ese gimnasio no lo propone. */
  available: boolean;
};

/** Como entra en una rutina. Series en null es "se cae con ese tiempo". */
export type ExerciseRoutine = {
  routineId: string;
  name: string;
  position: number;
  tier: number;
  setsFull: number;
  setsMinus25: number | null;
  setsMinus50: number | null;
  setsExpress: number | null;
  repMin: number | null;
  repMax: number | null;
};

export type ExerciseCard = {
  exercise: TrainingExerciseRow;
  implements: Swappable[];
  /** La clave vacia es la nota general; las otras, la de cada implemento. */
  notes: Record<string, string>;
  gyms: ExerciseGym[];
  routines: ExerciseRoutine[];
};

export async function listCatalog(db: SQLiteDatabase): Promise<CatalogEntry[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name_es: string;
    primary_muscle: string;
    implements: string;
    routines: number;
  }>(
    `SELECT e.id, e.name_es, e.primary_muscle, e.implements,
            (SELECT count(*) FROM training_routine_exercise re WHERE re.exercise_id = e.id)
              AS routines
       FROM training_exercise e
   ORDER BY e.name_es;`,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name_es,
    muscle: row.primary_muscle,
    implements: parseImplements(row.implements),
    routines: row.routines,
  }));
}

export async function loadExerciseCard(
  db: SQLiteDatabase,
  exerciseId: string,
): Promise<ExerciseCard> {
  const [exercise, notes, gyms, mine, routines] = await Promise.all([
    db.getFirstAsync<TrainingExerciseRow>('SELECT * FROM training_exercise WHERE id = ?;', [
      exerciseId,
    ]),
    db.getAllAsync<{ implement: string; note: string }>(
      'SELECT implement, note FROM training_exercise_note WHERE exercise_id = ?;',
      [exerciseId],
    ),
    db.getAllAsync<TrainingGymRow>('SELECT * FROM training_gym ORDER BY name;'),
    db.getAllAsync<{ gym_id: string }>(
      'SELECT gym_id FROM training_exercise_gym WHERE exercise_id = ?;',
      [exerciseId],
    ),
    db.getAllAsync<
      TrainingRoutineRow & {
        position: number;
        tier: number;
        sets_full: number;
        sets_minus_25: number | null;
        sets_minus_50: number | null;
        sets_express: number | null;
        target_rep_min: number | null;
        target_rep_max: number | null;
      }
    >(
      `SELECT r.*, re.position, re.tier, re.sets_full, re.sets_minus_25, re.sets_minus_50,
              re.sets_express, re.target_rep_min, re.target_rep_max
         FROM training_routine_exercise re
         JOIN training_routine r ON r.id = re.routine_id
        WHERE re.exercise_id = ?
     ORDER BY r.name;`,
      [exerciseId],
    ),
  ]);

  if (!exercise) throw new Error(`there is no exercise called ${exerciseId}`);

  const here = new Set(mine.map((row) => row.gym_id));

  return {
    exercise,
    implements: parseImplements(exercise.implements),
    notes: Object.fromEntries(notes.map((row) => [row.implement, row.note])),
    gyms: gyms.map((gym) => ({ id: gym.id, name: gym.name, available: here.has(gym.id) })),
    routines: routines.map((row) => ({
      routineId: row.id,
      name: row.name,
      position: row.position,
      tier: row.tier,
      setsFull: row.sets_full,
      setsMinus25: row.sets_minus_25,
      setsMinus50: row.sets_minus_50,
      setsExpress: row.sets_express,
      repMin: row.target_rep_min,
      repMax: row.target_rep_max,
    })),
  };
}

/** Lo que se puede cambiar del ejercicio en si. Lo que no esta aqui no se toca. */
export type ExerciseEdit = {
  name?: string;
  restSeconds?: number;
  loadIncrement?: number;
  unilateral?: boolean;
  implements?: Swappable[];
};

export async function updateExercise(
  db: SQLiteDatabase,
  exerciseId: string,
  edit: ExerciseEdit,
): Promise<void> {
  if (edit.name !== undefined) {
    const name = edit.name.trim();
    if (name === '') throw new Error('an exercise needs a name');
    await db.runAsync('UPDATE training_exercise SET name_es = ? WHERE id = ?;', [name, exerciseId]);
  }

  if (edit.restSeconds !== undefined) {
    if (!Number.isInteger(edit.restSeconds) || edit.restSeconds <= 0) {
      throw new Error(`a rest of ${edit.restSeconds} seconds is not a rest`);
    }
    await db.runAsync('UPDATE training_exercise SET default_rest_seconds = ? WHERE id = ?;', [
      edit.restSeconds,
      exerciseId,
    ]);
  }

  if (edit.loadIncrement !== undefined) {
    if (!(edit.loadIncrement > 0)) {
      throw new Error(`a step of ${edit.loadIncrement} is not a step`);
    }
    await db.runAsync('UPDATE training_exercise SET load_increment = ? WHERE id = ?;', [
      edit.loadIncrement,
      exerciseId,
    ]);
  }

  if (edit.unilateral !== undefined) {
    await db.runAsync('UPDATE training_exercise SET unilateral = ? WHERE id = ?;', [
      edit.unilateral ? 1 : 0,
      exerciseId,
    ]);
  }

  if (edit.implements !== undefined) {
    // Se guarda en el orden de siempre para que los botones no bailen de sitio.
    const chosen = SWAPPABLE.filter((option) => edit.implements?.includes(option));
    await db.runAsync('UPDATE training_exercise SET implements = ? WHERE id = ?;', [
      chosen.join(','),
      exerciseId,
    ]);
  }
}

/** La nota de la (i). Vacia la borra: una nota en blanco no es una nota. */
export async function setExerciseNote(
  db: SQLiteDatabase,
  exerciseId: string,
  implement: string,
  note: string,
): Promise<void> {
  const text = note.trim();
  if (text === '') {
    await db.runAsync(
      'DELETE FROM training_exercise_note WHERE exercise_id = ? AND implement = ?;',
      [exerciseId, implement],
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO training_exercise_note (exercise_id, implement, note) VALUES (?, ?, ?)
     ON CONFLICT (exercise_id, implement) DO UPDATE SET note = excluded.note;`,
    [exerciseId, implement, text],
  );
}

export async function setExerciseGym(
  db: SQLiteDatabase,
  exerciseId: string,
  gymId: string,
  available: boolean,
): Promise<void> {
  if (available) {
    await db.runAsync(
      `INSERT INTO training_exercise_gym (exercise_id, gym_id) VALUES (?, ?)
       ON CONFLICT (exercise_id, gym_id) DO NOTHING;`,
      [exerciseId, gymId],
    );
    return;
  }
  await db.runAsync('DELETE FROM training_exercise_gym WHERE exercise_id = ? AND gym_id = ?;', [
    exerciseId,
    gymId,
  ]);
}

const SETS_COLUMN: Record<TimeBudget, string> = {
  completo: 'sets_full',
  minus_25: 'sets_minus_25',
  minus_50: 'sets_minus_50',
  express: 'sets_express',
};

/**
 * Cuantas series hace de ese ejercicio en esa rutina con ese tiempo. Null es que se cae
 * del plan con ese tiempo, que es justo lo que spec 8.4 dibuja con un guion.
 */
export async function setRoutineSets(
  db: SQLiteDatabase,
  routineId: string,
  exerciseId: string,
  budget: TimeBudget,
  sets: number | null,
): Promise<void> {
  if (sets !== null && (!Number.isInteger(sets) || sets <= 0)) {
    throw new Error(`${sets} is not a number of sets`);
  }
  // El tiempo completo siempre hace algo: si no, el ejercicio no estaria en la rutina.
  if (sets === null && budget === 'completo') {
    throw new Error('El tiempo completo no puede quedarse sin series.');
  }

  const row = await db.getFirstAsync<{ tier: number }>(
    'SELECT tier FROM training_routine_exercise WHERE routine_id = ? AND exercise_id = ?;',
    [routineId, exerciseId],
  );
  if (!row) throw new Error(`${exerciseId} is not in routine ${routineId}`);

  // Spec 8.3: lo de nucleo no se recorta, y el esquema lo exige con un CHECK. Asi que
  // un numero en un ejercicio de nucleo es el mismo para los cuatro tiempos.
  if (row.tier === 1) {
    if (sets === null) {
      throw new Error('Un ejercicio de núcleo no se recorta: bájale la importancia primero.');
    }
    await db.runAsync(
      `UPDATE training_routine_exercise
          SET sets_full = ?, sets_minus_25 = ?, sets_minus_50 = ?, sets_express = ?
        WHERE routine_id = ? AND exercise_id = ?;`,
      [sets, sets, sets, sets, routineId, exerciseId],
    );
    return;
  }

  await db.runAsync(
    `UPDATE training_routine_exercise SET ${SETS_COLUMN[budget]} = ?
      WHERE routine_id = ? AND exercise_id = ?;`,
    [sets, routineId, exerciseId],
  );
}

export async function setRoutineReps(
  db: SQLiteDatabase,
  routineId: string,
  exerciseId: string,
  repMin: number | null,
  repMax: number | null,
): Promise<void> {
  await db.runAsync(
    `UPDATE training_routine_exercise SET target_rep_min = ?, target_rep_max = ?
      WHERE routine_id = ? AND exercise_id = ?;`,
    [repMin, repMax, routineId, exerciseId],
  );
}

export async function setRoutineTier(
  db: SQLiteDatabase,
  routineId: string,
  exerciseId: string,
  tier: number,
): Promise<void> {
  if (!Number.isInteger(tier) || tier < 1 || tier > 4) {
    throw new Error(`${tier} is not a tier`);
  }

  // Subirlo a nucleo lo saca de todo recorte, que es lo que el esquema exige de un
  // tier 1: las mismas series con cualquier tiempo.
  if (tier === 1) {
    await db.runAsync(
      `UPDATE training_routine_exercise
          SET tier = 1, sets_minus_25 = sets_full, sets_minus_50 = sets_full,
              sets_express = sets_full
        WHERE routine_id = ? AND exercise_id = ?;`,
      [routineId, exerciseId],
    );
    return;
  }

  await db.runAsync(
    'UPDATE training_routine_exercise SET tier = ? WHERE routine_id = ? AND exercise_id = ?;',
    [tier, routineId, exerciseId],
  );
}
