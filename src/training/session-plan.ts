import type { SQLiteDatabase } from 'expo-sqlite';

import { inTransaction } from '../db/transaction.ts';
import { loadRoutinePlan, saveSessionPlan, type PlannedExercise } from './routines.ts';
import {
  OPEN_SESSION_CARRIES_MS,
  openSessionSince,
  setSessionRoutine,
  startSession,
  type NewSession,
} from './sessions.ts';
import type { TrainingSessionRow } from '../db/types.ts';

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

export async function changePlannedRoutine(
  db: SQLiteDatabase,
  sessionId: string,
  routineId: string,
): Promise<void> {
  await inTransaction(db, async () => {
    const session = await db.getFirstAsync<TrainingSessionRow>(
      'SELECT * FROM training_session WHERE id = ?;',
      [sessionId],
    );
    if (!session) throw new Error('No se encontró el entreno que quieres cambiar.');
    const plan = await loadRoutinePlan(db, routineId, session.time_budget, session.gym_id);
    await setSessionRoutine(db, sessionId, routineId);
    await saveSessionPlan(db, sessionId, plan.exercises);
  });
}
