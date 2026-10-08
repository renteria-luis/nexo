// Editar el catalogo desde la app: el ejercicio, donde lo tiene y como entra en cada
// rutina.
//
// Hasta ahora todo esto vivia en migraciones, asi que cambiar "las laterales tambien se
// pueden hacer en maquina" o "en Fit4Less no hay hack squat" era pedir codigo nuevo.
// Son sus datos y los conoce mejor que nadie; lo unico que no se toca desde aqui es lo
// que la app usa como vocabulario cerrado (el musculo y el tipo de equipo), porque un
// valor inventado ahi no falla, solo cuenta mal.

import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  EquipmentType,
  TrainingExerciseRow,
  TrainingGymRow,
  TrainingRoutineRow,
} from '../db/types.ts';
import { inTransaction } from '../db/transaction.ts';
import { listExercises, parseImplements, type CatalogExercise, type Swappable } from './queries.ts';
import type { TimeBudget } from './routines.ts';

/** Una linea de la lista: lo justo para encontrarlo y saber que tiene puesto. */
export type CatalogEntry = {
  id: string;
  name: string;
  muscle: string;
  implements: Swappable[];
  /** En cuantas rutinas entra, para ver de un vistazo cual esta suelto. */
  routines: number;
  archived: number;
  familyId: string;
  familyName: string;
  equipmentType: EquipmentType;
  unilateral: number;
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
  exercise: TrainingExerciseRow & { archived: number; family_name: string | null };
  implements: Swappable[];
  /** La clave vacia es la nota general; las otras, la de cada implemento. */
  notes: Record<string, string>;
  gyms: ExerciseGym[];
  routines: ExerciseRoutine[];
  availableRoutines: TrainingRoutineRow[];
  variants: CatalogExercise[];
  familyId: string;
  familyName: string;
};

export async function listCatalog(db: SQLiteDatabase): Promise<CatalogEntry[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name_es: string;
    primary_muscle: string;
    implements: string;
    routines: number;
    archived: number;
    familyId: string;
    familyName: string;
    equipment_type: EquipmentType;
    unilateral: number;
  }>(
    `SELECT e.id, e.name_es, e.primary_muscle, e.implements, e.archived, e.equipment_type, e.unilateral,
            coalesce(v.base_exercise_id, e.id) AS familyId,
            coalesce(b.family_name, b.name_es, e.family_name, e.name_es) AS familyName,
            (SELECT count(*) FROM training_routine_exercise re WHERE re.exercise_id = e.id)
              AS routines
       FROM training_exercise e
       LEFT JOIN training_exercise_variant v ON v.exercise_id = e.id
       LEFT JOIN training_exercise b ON b.id = v.base_exercise_id
   ORDER BY e.name_es;`,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name_es,
    muscle: row.primary_muscle,
    implements: parseImplements(row.implements),
    routines: row.routines,
    archived: row.archived,
    familyId: row.familyId,
    familyName: row.familyName,
    equipmentType: row.equipment_type,
    unilateral: row.unilateral,
  }));
}

export async function loadExerciseCard(
  db: SQLiteDatabase,
  exerciseId: string,
): Promise<ExerciseCard> {
  const [exercise, notes, gyms, mine, routines, allRoutines, catalog] = await Promise.all([
    db.getFirstAsync<ExerciseCard['exercise']>('SELECT * FROM training_exercise WHERE id = ?;', [
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
    db.getAllAsync<TrainingRoutineRow>('SELECT * FROM training_routine ORDER BY name;'),
    listExercises(db),
  ]);

  if (!exercise) throw new Error(`there is no exercise called ${exerciseId}`);

  const here = new Set(mine.map((row) => row.gym_id));
  const selected = catalog.find((row) => row.id === exerciseId)!;
  const familyId = selected.familyId ?? exerciseId;

  return {
    exercise,
    familyId,
    familyName: selected.familyName ?? exercise.name_es,
    variants: catalog.filter((row) => row.familyId === familyId),
    availableRoutines: allRoutines.filter((row) => !routines.some((entry) => entry.id === row.id)),
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
  familyName?: string;
  restSeconds?: number;
  loadIncrement?: number;
  unilateral?: boolean;
};

export async function updateExercise(
  db: SQLiteDatabase,
  exerciseId: string,
  edit: ExerciseEdit,
): Promise<void> {
  await inTransaction(db, async () => {
    if (edit.familyName !== undefined) {
      if (!edit.familyName.trim()) throw new Error('Escribe un nombre para la familia.');
      await db.runAsync(
        `UPDATE training_exercise SET family_name = ?, edited_at = ?
      WHERE id = coalesce((SELECT base_exercise_id FROM training_exercise_variant WHERE exercise_id = ?), ?);`,
        [edit.familyName.trim(), Date.now(), exerciseId, exerciseId],
      );
    }
    if (edit.name !== undefined) {
      const name = edit.name.trim();
      if (name === '') throw new Error('Escribe un nombre para el ejercicio.');
      await db.runAsync('UPDATE training_exercise SET name_es = ? WHERE id = ?;', [
        name,
        exerciseId,
      ]);
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

    await db.runAsync('UPDATE training_exercise SET edited_at = ? WHERE id = ?;', [
      Date.now(),
      exerciseId,
    ]);
  });
}

export type NewExercise = {
  name: string;
  muscle: string;
  equipmentType: EquipmentType;
  unilateral: boolean;
  restSeconds: number;
  loadIncrement: number;
  note: string;
  variantOf?: string;
  secondaryMuscles?: string[];
};

export async function createExercise(db: SQLiteDatabase, input: NewExercise): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('Escribe el nombre del ejercicio.');
  if (
    !Number.isSafeInteger(input.restSeconds) ||
    input.restSeconds < 1 ||
    !Number.isFinite(input.loadIncrement) ||
    input.loadIncrement <= 0
  )
    throw new Error('Revisa el descanso y el salto de peso.');
  const id = `exercise-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  await inTransaction(db, async () => {
    let parent: string | null = null;
    if (input.variantOf) {
      const row = await db.getFirstAsync<{ id: string }>(
        `SELECT coalesce(v.base_exercise_id, e.id) AS id
        FROM training_exercise e LEFT JOIN training_exercise_variant v ON v.exercise_id = e.id WHERE e.id = ?;`,
        [input.variantOf],
      );
      if (!row) throw new Error('No se encontró el ejercicio original.');
      parent = row.id;
    }
    await db.runAsync(
      `INSERT INTO training_exercise
      (id, name_es, name_en, primary_muscle, equipment_type, load_increment, default_rest_seconds,
       unilateral, family_name, catalog_source, edited_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', ?);`,
      [
        id,
        name,
        name,
        input.muscle,
        input.equipmentType,
        input.loadIncrement,
        input.restSeconds,
        input.unilateral ? 1 : 0,
        parent ? null : name,
        Date.now(),
      ],
    );
    await db.runAsync(
      'INSERT INTO training_exercise_muscle (exercise_id, muscle, contribution) VALUES (?, ?, 1);',
      [id, input.muscle],
    );
    for (const muscle of new Set(input.secondaryMuscles ?? [])) {
      if (muscle !== input.muscle)
        await db.runAsync(
          'INSERT INTO training_exercise_muscle (exercise_id, muscle, contribution) VALUES (?, ?, 0.5);',
          [id, muscle],
        );
    }
    await db.runAsync(
      `INSERT INTO training_exercise_gym (exercise_id, gym_id)
      SELECT ?, id FROM training_gym;`,
      [id],
    );
    if (input.note.trim()) await writeExerciseNote(db, id, '', input.note);
    if (parent)
      await db.runAsync(
        `INSERT INTO training_exercise_variant (base_exercise_id, exercise_id, rank, auto_select)
      SELECT ?, ?, coalesce(max(rank), 0) + 1, 0 FROM training_exercise_variant WHERE base_exercise_id = ?;`,
        [parent, id, parent],
      );
  });
  return id;
}

export async function archiveExercise(
  db: SQLiteDatabase,
  exerciseId: string,
  archived: boolean,
): Promise<void> {
  await inTransaction(db, async () => {
    if (archived) {
      const pending = await db.getFirstAsync<{ id: string }>(
        `SELECT p.session_id AS id
        FROM training_session_plan p JOIN training_session s ON s.id = p.session_id
        WHERE p.exercise_id = ? AND s.end_time IS NULL AND p.sets_planned >
          (SELECT count(*) FROM training_set_entry e WHERE e.session_id = s.id AND e.exercise_id = p.exercise_id AND e.is_warmup = 0)
        LIMIT 1;`,
        [exerciseId],
      );
      if (pending) throw new Error('Reemplaza u omite sus series pendientes antes de archivarlo.');
    }
    const row = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM training_exercise WHERE id = ?;',
      [exerciseId],
    );
    if (!row) throw new Error('No se encontró el ejercicio.');
    await db.runAsync('UPDATE training_exercise SET archived = ?, edited_at = ? WHERE id = ?;', [
      archived ? 1 : 0,
      Date.now(),
      exerciseId,
    ]);
  });
}

export async function setExerciseRoutine(
  db: SQLiteDatabase,
  exerciseId: string,
  routineId: string,
  included: boolean,
): Promise<void> {
  await inTransaction(db, async () => {
    if (!included) {
      await db.runAsync(
        'DELETE FROM training_routine_exercise WHERE exercise_id = ? AND routine_id = ?;',
        [exerciseId, routineId],
      );
      return;
    }
    const exercise = await db.getFirstAsync<{ archived: number }>(
      'SELECT archived FROM training_exercise WHERE id = ?;',
      [exerciseId],
    );
    if (!exercise || exercise.archived)
      throw new Error('Restaura el ejercicio antes de añadirlo a una rutina.');
    await db.runAsync(
      `INSERT INTO training_routine_exercise
      (id, routine_id, exercise_id, position, tier, sets_full, sets_minus_25, sets_minus_50, sets_express,
       target_rep_mode, target_rep_min, target_rep_max)
      SELECT ?, ?, ?, coalesce(max(position), 0) + 1, 2, 3, 3, 2, NULL, 'range', 8, 12
      FROM training_routine_exercise WHERE routine_id = ?
      ON CONFLICT (routine_id, exercise_id) DO NOTHING;`,
      [`routine-exercise-${routineId}-${exerciseId}`, routineId, exerciseId, routineId],
    );
  });
}

/** La nota de la (i). Vacia la borra: una nota en blanco no es una nota. */
export async function setExerciseNote(
  db: SQLiteDatabase,
  exerciseId: string,
  implement: string,
  note: string,
): Promise<void> {
  await inTransaction(db, () => writeExerciseNote(db, exerciseId, implement, note));
}

async function writeExerciseNote(
  db: SQLiteDatabase,
  exerciseId: string,
  implement: string,
  note: string,
): Promise<void> {
  const text = note.trim();
  await db.runAsync('UPDATE training_exercise SET edited_at = ? WHERE id = ?;', [
    Date.now(),
    exerciseId,
  ]);
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
  await inTransaction(db, async () => {
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
  });
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
  await inTransaction(db, async () => {
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
  });
}

export async function setRoutineReps(
  db: SQLiteDatabase,
  routineId: string,
  exerciseId: string,
  repMin: number | null,
  repMax: number | null,
): Promise<void> {
  await inTransaction(db, async () => {
    await db.runAsync(
      `UPDATE training_routine_exercise SET target_rep_min = ?, target_rep_max = ?
      WHERE routine_id = ? AND exercise_id = ?;`,
      [repMin, repMax, routineId, exerciseId],
    );
  });
}

export async function setRoutineTier(
  db: SQLiteDatabase,
  routineId: string,
  exerciseId: string,
  tier: number,
): Promise<void> {
  await inTransaction(db, async () => {
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
  });
}
