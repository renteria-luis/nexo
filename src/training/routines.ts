// Spec 8. Declaring less time reduces sets by importance instead of deleting the
// session, which is the difference between training badly and not training.
//
// The trim is computed, shown, and only applied when he approves it (spec 8.3 rule
// 7). Nothing here writes a session on its own.

import type { SQLiteDatabase } from 'expo-sqlite';

import type { TrainingRoutineRow, TrainingSessionRow } from '../db/types.ts';

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

export type RoutineExercise = {
  exerciseId: string;
  name: string;
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
  estimatedSeconds: number;
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

export function estimateSeconds(exercises: readonly PlannedExercise[]): number {
  if (exercises.length === 0) return 0;
  const work = exercises.reduce(
    (total, exercise) => total + exercise.sets * (AVG_SET_SECONDS + exercise.restSeconds),
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
      return [
        {
          exerciseId: exercise.exerciseId,
          name: exercise.name,
          position: exercise.position,
          tier: exercise.tier,
          sets,
          repMode: exercise.repMode,
          repMin: exercise.repMin,
          repMax: exercise.repMax,
          restSeconds: restForBudget(exercise.tier, exercise.defaultRestSeconds, budget),
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
};

export async function listRoutines(db: SQLiteDatabase): Promise<TrainingRoutineRow[]> {
  return db.getAllAsync<TrainingRoutineRow>('SELECT * FROM training_routine ORDER BY rowid;');
}

export async function loadRoutine(
  db: SQLiteDatabase,
  routineId: string,
): Promise<RoutineExercise[]> {
  const rows = await db.getAllAsync<RoutineExerciseRow>(
    `SELECT re.exercise_id, e.name_es, re.position, re.tier,
            re.sets_full, re.sets_minus_25, re.sets_minus_50, re.sets_express,
            re.target_rep_mode, re.target_rep_min, re.target_rep_max,
            e.default_rest_seconds
       FROM training_routine_exercise re
       JOIN training_exercise e ON e.id = re.exercise_id
      WHERE re.routine_id = ?
   ORDER BY re.position;`,
    [routineId],
  );

  return rows.map((row) => ({
    exerciseId: row.exercise_id,
    name: row.name_es,
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
  }));
}

export async function loadRoutinePlan(
  db: SQLiteDatabase,
  routineId: string,
  budget: TimeBudget,
): Promise<RoutinePlan> {
  const [routine, exercises] = await Promise.all([
    db.getFirstAsync<TrainingRoutineRow>('SELECT * FROM training_routine WHERE id = ?;', [
      routineId,
    ]),
    loadRoutine(db, routineId),
  ]);
  if (!routine) throw new Error(`there is no routine called ${routineId}`);

  const planned = trimRoutine(exercises, budget);
  return {
    routineId,
    name: routine.name,
    budget,
    exercises: planned,
    estimatedSeconds: estimateSeconds(planned),
  };
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
