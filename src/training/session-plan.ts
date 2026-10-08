import type { SQLiteDatabase } from 'expo-sqlite';

import { inTransaction } from '../db/transaction.ts';
import {
  loadRoutinePlan,
  loadSessionPlan,
  saveSessionPlan,
  type PlannedExercise,
  type PlannedSet,
} from './routines.ts';
import {
  OPEN_SESSION_CARRIES_MS,
  openSessionSince,
  setSessionRoutine,
  startSession,
  type NewSession,
} from './sessions.ts';
import type { TrainingSessionRow } from '../db/types.ts';
import { replacePendingSets } from './variants.ts';

export async function startPlannedSession(
  db: SQLiteDatabase,
  session: NewSession,
  plan: readonly PlannedExercise[],
): Promise<string> {
  let sessionId = '';
  await inTransaction(db, async () => {
    // A second tap can arrive after the write but before the screen reloads.
    const active = await openSessionSince(db, Date.now() - OPEN_SESSION_CARRIES_MS);
    if (active) {
      sessionId = active.id;
      return;
    }
    sessionId = await startSession(db, session);
    await saveSessionPlan(db, sessionId, plan);
  });
  return sessionId;
}

export type SessionPlanEdit = {
  sessionId: string;
  routineId: string | null;
  routineName: string | null;
  baseline: string;
  exercises: PlannedSet[];
  done: { exerciseId: string; sets: number }[];
  removedPending: number;
};

async function readPlanState(db: SQLiteDatabase, sessionId: string) {
  const session = await db.getFirstAsync<TrainingSessionRow>(
    'SELECT * FROM training_session WHERE id = ?;',
    [sessionId],
  );
  if (!session) throw new Error('No se encontró el entreno que quieres cambiar.');
  if (session.end_time !== null) throw new Error('Reabre el entreno antes de cambiar su plan.');
  const plan = await loadSessionPlan(db, sessionId);
  const done = await db.getAllAsync<{ exerciseId: string; sets: number; restSeconds: number }>(
    `SELECT e.exercise_id AS exerciseId, count(*) AS sets, x.default_rest_seconds AS restSeconds
       FROM training_set_entry e JOIN training_exercise x ON x.id = e.exercise_id
      WHERE e.session_id = ? AND e.is_warmup = 0 GROUP BY e.exercise_id ORDER BY e.exercise_id;`,
    [sessionId],
  );
  const baseline = JSON.stringify([
    session.id,
    session.date,
    session.routine_id,
    session.gym_id,
    session.time_budget,
    plan,
    done,
  ]);
  return { session, plan, done, baseline };
}

export async function loadSessionPlanEdit(
  db: SQLiteDatabase,
  sessionId: string,
  routineId?: string,
): Promise<SessionPlanEdit> {
  let edit!: SessionPlanEdit;
  await inTransaction(db, async () => {
    const { session, plan, done, baseline } = await readPlanState(db, sessionId);
    const completed = new Map(done.map((entry) => [entry.exerciseId, entry.sets]));
    const changing = routineId !== undefined && routineId !== session.routine_id;
    const next = changing
      ? await loadRoutinePlan(db, routineId, session.time_budget, session.gym_id)
      : null;
    const shared = new Set(next?.exercises.map((entry) => entry.exerciseId));
    // Shared exercises retain the approved order and counts; departed exercises keep only work already done.
    const exercises: PlannedSet[] = plan.flatMap((entry) => {
      const sets =
        changing && !shared.has(entry.exerciseId)
          ? (completed.get(entry.exerciseId) ?? 0)
          : Math.max(entry.sets, completed.get(entry.exerciseId) ?? 0);
      return sets > 0 ? [{ ...entry, sets }] : [];
    });
    const included = new Set(exercises.map((entry) => entry.exerciseId));
    for (const entry of next?.exercises ?? []) {
      if (!included.has(entry.exerciseId)) {
        exercises.push({
          ...entry,
          sets: Math.max(entry.sets, completed.get(entry.exerciseId) ?? 0),
        });
        included.add(entry.exerciseId);
      }
    }
    // Work logged outside the old plan still belongs to this session.
    for (const entry of done) {
      if (!included.has(entry.exerciseId)) exercises.push({ ...entry, position: 0 });
    }
    const removedPending = plan.reduce(
      (sum, entry) =>
        sum +
        (changing && !shared.has(entry.exerciseId)
          ? Math.max(0, entry.sets - (completed.get(entry.exerciseId) ?? 0))
          : 0),
      0,
    );
    edit = {
      sessionId,
      routineId: routineId ?? session.routine_id,
      routineName: next?.name ?? null,
      baseline,
      done,
      removedPending,
      exercises: exercises.map((entry, index) => ({
        exerciseId: entry.exerciseId,
        sets: entry.sets,
        restSeconds: entry.restSeconds,
        position: index + 1,
      })),
    };
  });
  return edit;
}

export async function applySessionPlanEdit(
  db: SQLiteDatabase,
  edit: SessionPlanEdit,
): Promise<void> {
  await inTransaction(db, async () => {
    const current = await readPlanState(db, edit.sessionId);
    if (current.baseline !== edit.baseline)
      throw new Error('El entreno cambió. Actualiza el plan para revisar las series actuales.');
    const ids = new Set<string>();
    for (const entry of edit.exercises) {
      if (
        ids.has(entry.exerciseId) ||
        !Number.isSafeInteger(entry.sets) ||
        entry.sets < 1 ||
        !Number.isSafeInteger(entry.restSeconds) ||
        entry.restSeconds < 1
      )
        throw new Error('Revisa los ejercicios y sus cantidades de series.');
      ids.add(entry.exerciseId);
    }
    for (const entry of current.done) {
      if (
        (edit.exercises.find((one) => one.exerciseId === entry.exerciseId)?.sets ?? 0) < entry.sets
      )
        throw new Error('Las series ya hechas deben permanecer en el plan.');
    }
    if (edit.routineId !== current.session.routine_id) {
      if (edit.routineId === null) throw new Error('Elige una rutina válida.');
      await setSessionRoutine(db, edit.sessionId, edit.routineId);
    }
    await saveSessionPlan(
      db,
      edit.sessionId,
      edit.exercises.map((entry, index) => ({ ...entry, position: index + 1 })),
    );
  });
}

export async function replaceSessionVariant(
  db: SQLiteDatabase,
  sessionId: string,
  from: string,
  to: string,
): Promise<PlannedSet[]> {
  let updated: PlannedSet[] = [];
  await inTransaction(db, async () => {
    const current = await readPlanState(db, sessionId);
    const rows = await db.getAllAsync<{
      id: string;
      familyId: string;
      archived: number;
      default_rest_seconds: number;
    }>(
      `SELECT e.id, e.archived, e.default_rest_seconds, coalesce(v.base_exercise_id, e.id) AS familyId
         FROM training_exercise e LEFT JOIN training_exercise_variant v ON v.exercise_id = e.id
        WHERE e.id IN (?, ?);`,
      [from, to],
    );
    const source = rows.find((row) => row.id === from);
    const target = rows.find((row) => row.id === to);
    if (!source || !target || source.familyId !== target.familyId || target.archived)
      throw new Error('Elige una variante disponible del mismo ejercicio.');
    const done = new Map(current.done.map((entry) => [entry.exerciseId, entry.sets]));
    updated = replacePendingSets(current.plan, done, from, target);
    if (JSON.stringify(updated) !== JSON.stringify(current.plan))
      await saveSessionPlan(db, sessionId, updated);
  });
  return updated;
}
