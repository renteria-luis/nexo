import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays } from '../core/dates.ts';
import type { TrainingSessionRow } from '../db/types.ts';
import { inTransaction } from '../db/transaction.ts';
import {
  analyzeTiming,
  type SessionTiming,
  type TimingReview,
  type TimingSample,
  type TimingSet,
} from './timing.ts';

async function timingSession(db: SQLiteDatabase, sessionId: string): Promise<TrainingSessionRow> {
  const row = await db.getFirstAsync<TrainingSessionRow>(
    'SELECT * FROM training_session WHERE id = ?;',
    [sessionId],
  );
  if (!row) throw new Error('No se encontró el entreno.');
  return row;
}

async function timingSets(db: SQLiteDatabase, sessionId: string): Promise<TimingSet[]> {
  const rows = await db.getAllAsync<{
    id: string;
    exerciseId: string;
    implement: string;
    setIndex: number;
    timestamp: number;
    warmup: number;
    eligible: number;
    review: TimingReview;
    correctedSeconds: number | null;
  }>(
    `SELECT s.id, s.exercise_id AS exerciseId, coalesce(s.implement, x.equipment_type) AS implement,
            s.set_index AS setIndex, s.timestamp, s.is_warmup AS warmup,
            s.timing_eligible AS eligible, s.timing_review AS review, s.timing_seconds AS correctedSeconds
       FROM training_set_entry s JOIN training_exercise x ON x.id = s.exercise_id
      WHERE s.session_id = ? ORDER BY s.timestamp, s.rowid;`,
    [sessionId],
  );
  return rows.map((row) => ({ ...row, warmup: row.warmup === 1, eligible: row.eligible === 1 }));
}

async function timingHistory(
  db: SQLiteDatabase,
  session: TrainingSessionRow,
): Promise<TimingSample[]> {
  return db.getAllAsync<TimingSample>(
    `SELECT t.session_id AS sessionId, s.date, t.exercise_id AS exerciseId, t.implement,
            t.set_count AS sets, t.sample_count AS samples, t.flagged_count AS flagged, t.minutes
       FROM training_exercise_time t JOIN training_session s ON s.id = t.session_id
      WHERE s.id <> ? AND s.end_time IS NOT NULL AND s.is_retroactive = 0
        AND s.gym_id IS ? AND s.time_budget = ? AND s.date BETWEEN ? AND ?
        AND s.start_time < ?
      ORDER BY s.date, s.start_time;`,
    [
      session.id,
      session.gym_id,
      session.time_budget,
      addDays(session.date, -90),
      session.date,
      session.start_time ?? 0,
    ],
  );
}

export async function readSessionTiming(
  db: SQLiteDatabase,
  sessionId: string,
): Promise<SessionTiming> {
  const session = await timingSession(db, sessionId);
  const [sets, history] = await Promise.all([
    timingSets(db, sessionId),
    timingHistory(db, session),
  ]);
  return { session, sets, history, exercises: analyzeTiming(session, sets, history) };
}

/** Call inside the caller's transaction when closing or correcting a session. */
export async function rebuildExerciseTimes(db: SQLiteDatabase, sessionId: string): Promise<void> {
  const data = await readSessionTiming(db, sessionId);
  await db.runAsync('DELETE FROM training_exercise_time WHERE session_id = ?;', [sessionId]);
  if (data.session.end_time === null || data.session.is_retroactive) return;
  for (const exercise of data.exercises) {
    await db.runAsync(
      `INSERT INTO training_exercise_time
         (session_id, exercise_id, implement, set_count, sample_count, flagged_count, minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        sessionId,
        exercise.exerciseId,
        exercise.implement,
        exercise.sets,
        exercise.samples,
        exercise.flagged,
        exercise.minutes,
      ],
    );
  }
}

/** Existing timestamps remain useful; rebuild only missing summaries, within the learning window. */
export async function prepareTimingHistory(db: SQLiteDatabase, sessionId: string): Promise<void> {
  await inTransaction(db, async () => {
    const session = await timingSession(db, sessionId);
    const missing = await db.getAllAsync<{ id: string }>(
      `WITH candidates AS (
        SELECT s.id, s.date, s.start_time,
               NOT EXISTS (SELECT 1 FROM training_exercise_time t WHERE t.session_id = s.id) AS missing
        FROM training_session s
        WHERE s.end_time IS NOT NULL AND s.is_retroactive = 0
          AND s.gym_id IS ? AND s.time_budget = ? AND s.date BETWEEN ? AND ?
          AND s.start_time <= ?
          AND EXISTS (SELECT 1 FROM training_set_entry e WHERE e.session_id = s.id AND e.is_warmup = 0)
      ) SELECT id FROM candidates
        WHERE start_time >= (SELECT min(start_time) FROM candidates WHERE missing = 1)
        ORDER BY date, start_time;`,
      [
        session.gym_id,
        session.time_budget,
        addDays(session.date, -90),
        session.date,
        session.start_time ?? 0,
      ],
    );
    for (const row of missing) await rebuildExerciseTimes(db, row.id);
  });
}

export type TimingCorrection = { review: TimingReview; seconds: number | null };

export async function reviewSetTiming(
  db: SQLiteDatabase,
  setId: string,
  correction: TimingCorrection,
): Promise<void> {
  if (
    !['auto', 'keep', 'exclude'].includes(correction.review) ||
    (correction.seconds !== null &&
      (!Number.isFinite(correction.seconds) ||
        correction.seconds <= 0 ||
        correction.seconds > 21600))
  ) {
    throw new Error('Escribe un tiempo mayor que cero y de hasta 360 minutos.');
  }
  await inTransaction(db, async () => {
    const set = await db.getFirstAsync<{ session_id: string }>(
      'SELECT session_id FROM training_set_entry WHERE id = ?;',
      [setId],
    );
    if (!set) throw new Error('La serie ya no existe.');
    await db.runAsync(
      'UPDATE training_set_entry SET timing_review = ?, timing_seconds = ? WHERE id = ?;',
      [correction.review, correction.seconds, setId],
    );
    await rebuildExerciseTimes(db, set.session_id);
    // Later automatic outlier decisions may have used this session as their reference.
    await db.runAsync(
      `DELETE FROM training_exercise_time WHERE session_id IN (
         SELECT later.id FROM training_session later JOIN training_session edited
           ON later.gym_id IS edited.gym_id AND later.time_budget = edited.time_budget
          AND later.start_time > edited.start_time
         WHERE edited.id = ?
       );`,
      [set.session_id],
    );
  });
}
