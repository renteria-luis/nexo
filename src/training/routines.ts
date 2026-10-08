// Spec 8. Declaring less time reduces sets by importance instead of deleting the
// session, which is the difference between training badly and not training.
//
// The trim is computed, shown, and only applied when he approves it (spec 8.3 rule
// 7). Nothing here writes a session on its own.

import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays, type DateRange, type IsoDate } from '../core/dates.ts';
import type { TrainingRoutineRow, TrainingSessionRow } from '../db/types.ts';

import { usualMinutes } from './pace.ts';
import { listSessionTimes } from './sessions.ts';

export type TimeBudget = TrainingSessionRow['time_budget'];

/** Spec 8.3 rule 5: tier 2 and 3 rest drops to this at -50% and Express. */
export const TRIMMED_REST_SECONDS = 90;

/**
 * Spec 8.3. Starts at 45 s and the spec wants it refined from his own data after
 * ~10 sessions per exercise. That refinement is not here: the app records when a
 * set was logged, not how long the set itself took, so a measured value would be
 * rest plus set and would quietly double count.
 */
export const AVG_SET_SECONDS = 45;
export const TRANSITION_SECONDS = 60;
export const WARMUP_SECONDS = 300;

/** La version que hace cuando no anda con el reloj encima. */
export type RoutineAlternative = {
  exerciseId: string;
  name: string;
  unilateral: boolean;
  defaultRestSeconds: number;
};

export type RoutineExercise = {
  exerciseId: string;
  name: string;
  unilateral: boolean;
  /** Null cuando el ejercicio es el mismo tenga el tiempo que tenga. */
  fullTime: RoutineAlternative | null;
  position: number;
  tier: number;
  setsFull: number;
  setsMinus25: number | null;
  setsMinus50: number | null;
  setsExpress: number | null;
  repMode: 'range' | 'amrap' | 'failure';
  repMin: number | null;
  repMax: number | null;
  defaultRestSeconds: number;
};

export type PlannedExercise = {
  exerciseId: string;
  name: string;
  /** Un brazo por vez: la misma serie cuesta el doble de reloj. */
  unilateral: boolean;
  position: number;
  tier: number;
  sets: number;
  repMode: RoutineExercise['repMode'];
  repMin: number | null;
  repMax: number | null;
  restSeconds: number;
};

export type RoutinePlan = {
  routineId: string;
  name: string;
  budget: TimeBudget;
  exercises: PlannedExercise[];
  /** Lo que suele tardar un dia asi, o null si todavia no hay con que decirlo. */
  usualMinutes: number | null;
};

/** Null means the exercise is dropped at that budget, which is the dash in spec 8.4. */
export function setsForBudget(exercise: RoutineExercise, budget: TimeBudget): number | null {
  switch (budget) {
    case 'completo':
      return exercise.setsFull;
    case 'minus_25':
      return exercise.setsMinus25;
    case 'minus_50':
      return exercise.setsMinus50;
    case 'express':
      return exercise.setsExpress;
  }
}

export function restForBudget(
  tier: number,
  defaultRestSeconds: number,
  budget: TimeBudget,
): number {
  // Spec 9 is explicit that the heavy work keeps its three minutes whatever else
  // gets cut, so tier 1 is never touched here.
  if (tier === 1) return defaultRestSeconds;
  if (budget === 'minus_50' || budget === 'express') {
    return Math.min(defaultRestSeconds, TRIMMED_REST_SECONDS);
  }
  return defaultRestSeconds;
}

/**
 * Una serie mas o menos en el plan antes de empezar. Llega a cero: una maquina rota ese
 * dia se saca de aqui, y con el minimo en una serie no habia forma de dejarla fuera.
 */
export function overrideSets(
  exercises: readonly PlannedExercise[],
  exerciseId: string,
  direction: 1 | -1,
): PlannedExercise[] {
  return exercises.map((exercise) =>
    exercise.exerciseId === exerciseId
      ? { ...exercise, sets: Math.max(0, exercise.sets + direction) }
      : exercise,
  );
}

/** Lo que de verdad se va a hacer: lo que quedo en cero no entra en la sesion. */
export function toStart(exercises: readonly PlannedExercise[]): PlannedExercise[] {
  return exercises.filter((exercise) => exercise.sets > 0);
}

export function estimateSeconds(exercises: readonly PlannedExercise[]): number {
  if (exercises.length === 0) return 0;
  const work = exercises.reduce(
    // A un brazo se trabaja dos veces por serie y se descansa una: se cambia de
    // lado sin parar, y el descanso llega recien cuando termina el segundo.
    (total, exercise) =>
      total +
      exercise.sets * (AVG_SET_SECONDS * (exercise.unilateral ? 2 : 1) + exercise.restSeconds),
    0,
  );
  return WARMUP_SECONDS + work + exercises.length * TRANSITION_SECONDS;
}

export function trimRoutine(
  exercises: readonly RoutineExercise[],
  budget: TimeBudget,
): PlannedExercise[] {
  return exercises
    .slice()
    .sort((a, b) => a.position - b.position)
    .flatMap((exercise) => {
      const sets = setsForBudget(exercise, budget);
      if (sets === null) return [];

      // Con el tiempo completo hace la version buena aunque cueste mas reloj; en
      // cuanto recorta, vuelve la que se despacha en la mitad. Solo cuesta mas reloj la
      // de un brazo por vez: la maquina de laterales de Fit4Less es de dos brazos, y con
      // poco tiempo el plan la cambiaba por las mancuernas, la ultima de su lista.
      const better = exercise.fullTime;
      const upgrade = better !== null && (budget === 'completo' || !better.unilateral);
      const chosen = upgrade ? better : exercise;
      const restSeconds = upgrade ? better.defaultRestSeconds : exercise.defaultRestSeconds;

      return [
        {
          exerciseId: chosen.exerciseId,
          name: chosen.name,
          unilateral: chosen.unilateral,
          position: exercise.position,
          tier: exercise.tier,
          sets,
          repMode: exercise.repMode,
          repMin: exercise.repMin,
          repMax: exercise.repMax,
          restSeconds: restForBudget(exercise.tier, restSeconds, budget),
        },
      ];
    });
}

type RoutineExerciseRow = {
  exercise_id: string;
  name_es: string;
  position: number;
  tier: number;
  sets_full: number;
  sets_minus_25: number | null;
  sets_minus_50: number | null;
  sets_express: number | null;
  target_rep_mode: RoutineExercise['repMode'];
  target_rep_min: number | null;
  target_rep_max: number | null;
  default_rest_seconds: number;
  unilateral: number;
  full_time_exercise_id: string | null;
  full_time_name: string | null;
  full_time_unilateral: number | null;
  full_time_rest_seconds: number | null;
};

/** Spec 13: la semana son cinco dias, dos de empuje, dos de tiron y uno de pierna. */
export const WEEKLY_SPLIT: Readonly<Record<string, number>> = { push: 2, pull: 2, legs: 1 };

/** Una sesion con series, con su rutina: lo que se mira para saber que toca. */
export type RoutineDone = { routineId: string; date: IsoDate };

/**
 * Spec 8.5 paso 2: la rutina viene puesta por el patron, no siempre la primera.
 *
 * La que mas le debe la semana movil (los ultimos siete dias contra spec 13), y entre las
 * que deben lo mismo, la que hace mas que no hace; nunca hecha es la mas vieja. El chip se
 * puede cambiar igual: esto solo ahorra el toque, y el empuje en dia de tiron que salia
 * cuando se le olvidaba tocarlo.
 */
export function owedRoutine(
  routines: readonly TrainingRoutineRow[],
  done: readonly RoutineDone[],
  today: IsoDate,
): string | null {
  const weekStartsOn = addDays(today, -6);
  const owed = (id: string) =>
    (WEEKLY_SPLIT[id] ?? 0) -
    done.filter((one) => one.routineId === id && one.date >= weekStartsOn).length;
  const lastDone = (id: string) =>
    done.reduce<IsoDate | ''>(
      (latest, one) => (one.routineId === id && one.date > latest ? one.date : latest),
      '',
    );

  let best: TrainingRoutineRow | null = null;
  for (const routine of routines) {
    if (best === null) {
      best = routine;
      continue;
    }
    const difference = owed(routine.id) - owed(best.id);
    if (difference > 0 || (difference === 0 && lastDone(routine.id) < lastDone(best.id))) {
      best = routine;
    }
  }
  return best?.id ?? null;
}

/** Las sesiones con series de esas fechas que dicen su rutina. */
export async function listRoutinesDone(
  db: SQLiteDatabase,
  range: DateRange,
): Promise<RoutineDone[]> {
  return db.getAllAsync<RoutineDone>(
    `SELECT s.routine_id AS routineId, s.date
       FROM training_session s
      WHERE s.date BETWEEN ? AND ?
        AND s.routine_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM training_set_entry e
           WHERE e.session_id = s.id AND e.is_warmup = 0
        )
   ORDER BY s.date;`,
    [range.from, range.to],
  );
}

export async function listRoutines(db: SQLiteDatabase): Promise<TrainingRoutineRow[]> {
  return db.getAllAsync<TrainingRoutineRow>('SELECT * FROM training_routine ORDER BY rowid;');
}

/**
 * La mejor variante de cada ejercicio que exista en ese gimnasio.
 *
 * El mismo hueco de la rutina se hace con maquina, polea o mancuerna segun lo que
 * haya enfrente, y el orden no es un gusto: para las laterales la maquina fija el
 * hombro, la polea mantiene tension abajo y la mancuerna no hace ninguna de las dos.
 * Sin gimnasio elegido no hay nada que resolver y manda lo que diga la rutina.
 */
async function bestVariants(
  db: SQLiteDatabase,
  gymId: string | null,
): Promise<Map<string, { exerciseId: string; name: string; unilateral: number; rest: number }>> {
  if (gymId === null) return new Map();

  const rows = await db.getAllAsync<{
    base_exercise_id: string;
    exercise_id: string;
    name_es: string;
    unilateral: number;
    default_rest_seconds: number;
  }>(
    `SELECT v.base_exercise_id, v.exercise_id, e.name_es, e.unilateral, e.default_rest_seconds
       FROM training_exercise_variant v
       JOIN training_exercise e ON e.id = v.exercise_id
       JOIN training_exercise_gym g ON g.exercise_id = v.exercise_id AND g.gym_id = ?
   ORDER BY v.base_exercise_id, v.rank;`,
    [gymId],
  );

  const best = new Map<
    string,
    { exerciseId: string; name: string; unilateral: number; rest: number }
  >();
  for (const row of rows) {
    if (best.has(row.base_exercise_id)) continue;
    best.set(row.base_exercise_id, {
      exerciseId: row.exercise_id,
      name: row.name_es,
      unilateral: row.unilateral,
      rest: row.default_rest_seconds,
    });
  }
  return best;
}

export async function loadRoutine(
  db: SQLiteDatabase,
  routineId: string,
  gymId: string | null = null,
): Promise<RoutineExercise[]> {
  const rows = await db.getAllAsync<RoutineExerciseRow>(
    `SELECT re.exercise_id, e.name_es, re.position, re.tier,
            re.sets_full, re.sets_minus_25, re.sets_minus_50, re.sets_express,
            re.target_rep_mode, re.target_rep_min, re.target_rep_max,
            e.default_rest_seconds, e.unilateral,
            re.full_time_exercise_id,
            f.name_es              AS full_time_name,
            f.unilateral           AS full_time_unilateral,
            f.default_rest_seconds AS full_time_rest_seconds
       FROM training_routine_exercise re
       JOIN training_exercise e ON e.id = re.exercise_id
       LEFT JOIN training_exercise f ON f.id = re.full_time_exercise_id
      WHERE re.routine_id = ?
        -- Lo que el gimnasio no tiene no se planea: el interruptor "Donde lo tengo"
        -- cambiaba la ficha y nada mas. Un gimnasio sin nada marcado ("Otro") no dice
        -- que falte nada, y se queda con la rutina entera.
        AND (
          ? IS NULL
          OR NOT EXISTS (SELECT 1 FROM training_exercise_gym WHERE gym_id = ?)
          OR EXISTS (
            SELECT 1 FROM training_exercise_gym g
             WHERE g.gym_id = ?
               AND (g.exercise_id = re.exercise_id
                    OR g.exercise_id IN (SELECT v.exercise_id FROM training_exercise_variant v
                                          WHERE v.base_exercise_id = re.exercise_id))
          )
        )
   ORDER BY re.position;`,
    [routineId, gymId, gymId, gymId],
  );

  const variants = await bestVariants(db, gymId);

  return rows.map((row) => {
    const here = variants.get(row.exercise_id);
    const fullTime = here
      ? {
          exerciseId: here.exerciseId,
          name: here.name,
          unilateral: here.unilateral === 1,
          defaultRestSeconds: here.rest,
        }
      : row.full_time_exercise_id === null
        ? null
        : {
            exerciseId: row.full_time_exercise_id,
            name: row.full_time_name ?? row.full_time_exercise_id,
            unilateral: row.full_time_unilateral === 1,
            defaultRestSeconds: row.full_time_rest_seconds ?? row.default_rest_seconds,
          };

    return {
      exerciseId: row.exercise_id,
      name: row.name_es,
      unilateral: row.unilateral === 1,
      fullTime,
      position: row.position,
      tier: row.tier,
      setsFull: row.sets_full,
      setsMinus25: row.sets_minus_25,
      setsMinus50: row.sets_minus_50,
      setsExpress: row.sets_express,
      repMode: row.target_rep_mode,
      repMin: row.target_rep_min,
      repMax: row.target_rep_max,
      defaultRestSeconds: row.default_rest_seconds,
    };
  });
}

export async function loadRoutinePlan(
  db: SQLiteDatabase,
  routineId: string,
  budget: TimeBudget,
  gymId: string | null = null,
): Promise<RoutinePlan> {
  const [routine, exercises] = await Promise.all([
    db.getFirstAsync<TrainingRoutineRow>('SELECT * FROM training_routine WHERE id = ?;', [
      routineId,
    ]),
    loadRoutine(db, routineId, gymId),
  ]);
  if (!routine) throw new Error(`there is no routine called ${routineId}`);

  const planned = trimRoutine(exercises, budget);
  // Lo que tarda de verdad, al lado de lo que el plan calcula: el calculo suma series y
  // descansos, y el no es una suma de series y descansos.
  const times = await listSessionTimes(db);

  return {
    routineId,
    name: routine.name,
    budget,
    exercises: planned,
    usualMinutes: usualMinutes(times, { gymId, routineId, budget }),
  };
}

/**
 * El siguiente ejercicio al que le faltan series, en el orden del plan.
 *
 * Empieza despues del que acaba de cerrar y da la vuelta al llegar al final, que es lo
 * que recoge el que se salto porque la maquina estaba ocupada. Es solo para ahorrarle
 * toques en la pantalla de entreno: no escribe nada ni entra en ninguna cuenta.
 */
export function nextPendingExercise(
  from: string,
  order: readonly string[],
  done: ReadonlyMap<string, number>,
  planned: ReadonlyMap<string, number>,
): string | null {
  const at = order.indexOf(from);
  if (at === -1) return null;

  for (let step = 1; step <= order.length; step += 1) {
    const id = order[(at + step) % order.length];
    const target = planned.get(id);
    if (target !== undefined && (done.get(id) ?? 0) < target) return id;
  }
  return null;
}

export async function saveSessionPlan(
  db: SQLiteDatabase,
  sessionId: string,
  exercises: readonly PlannedExercise[],
): Promise<void> {
  // Replacing rather than adding, because approving a plan twice for one session
  // means he corrected it, and the second plan is the one he is training.
  await db.runAsync('DELETE FROM training_session_plan WHERE session_id = ?;', [sessionId]);

  for (const exercise of exercises) {
    await db.runAsync(
      `INSERT INTO training_session_plan
         (session_id, exercise_id, position, sets_planned, rest_seconds)
       VALUES (?, ?, ?, ?, ?);`,
      [sessionId, exercise.exerciseId, exercise.position, exercise.sets, exercise.restSeconds],
    );
  }
}

export type PlannedSet = {
  exerciseId: string;
  position: number;
  sets: number;
  restSeconds: number;
};

export async function loadDayPlans(
  db: SQLiteDatabase,
  date: IsoDate,
): Promise<(PlannedSet & { sessionId: string })[]> {
  return db.getAllAsync<PlannedSet & { sessionId: string }>(
    `SELECT p.session_id AS sessionId, p.exercise_id AS exerciseId,
            p.position, p.sets_planned AS sets, p.rest_seconds AS restSeconds
       FROM training_session_plan p JOIN training_session s ON s.id = p.session_id
      WHERE s.date = ? ORDER BY p.session_id, p.position;`,
    [date],
  );
}

/**
 * El descanso que toca ahora en ese ejercicio: el que aprobo en el plan de hoy, que con
 * poco tiempo baja a 90 s en los de nivel 2 y 3 (spec 8.3 regla 5), y el del catalogo
 * si el ejercicio no estaba en el plan. La sesion leia siempre el del catalogo y le
 * seguia pidiendo 2:00 despues de aprobar el recorte.
 */
export function suggestedRest(
  plan: readonly PlannedSet[],
  exerciseId: string,
  catalogueSeconds: number,
): number {
  return plan.find((entry) => entry.exerciseId === exerciseId)?.restSeconds ?? catalogueSeconds;
}

export async function loadSessionPlan(
  db: SQLiteDatabase,
  sessionId: string,
): Promise<PlannedSet[]> {
  const rows = await db.getAllAsync<{
    exercise_id: string;
    position: number;
    sets_planned: number;
    rest_seconds: number;
  }>(
    `SELECT exercise_id, position, sets_planned, rest_seconds
       FROM training_session_plan WHERE session_id = ? ORDER BY position;`,
    [sessionId],
  );

  return rows.map((row) => ({
    exerciseId: row.exercise_id,
    position: row.position,
    sets: row.sets_planned,
    restSeconds: row.rest_seconds,
  }));
}
