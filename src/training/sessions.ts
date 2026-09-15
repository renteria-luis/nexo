// Writing a session and its sets, and the lookups spec 6.4 needs to put last
// time's numbers in front of him while he trains.
//
// A session does not require a gym or a routine. Both are nullable because the
// gym inventories are still to come (spec 14.3) and the routine tables in spec 8.4
// cannot be seeded until re-entry ends (spec 13.4). Neither of those should stop
// him recording what he actually lifted.

import type { SQLiteDatabase } from 'expo-sqlite';

import { trailingDays, type IsoDate } from '../core/dates.ts';
import type { TrainingSessionRow, TrainingSetEntryRow } from '../db/types.ts';

import type { LoggedSet } from './calculations.ts';

export type NewSession = {
  date: IsoDate;
  timeBudget: TrainingSessionRow['time_budget'];
  gymId?: string | null;
  routineId?: string | null;
  aloneOrPartner?: TrainingSessionRow['alone_or_partner'];
  isRetroactive?: boolean;
};

export async function startSession(db: SQLiteDatabase, session: NewSession): Promise<string> {
  const now = Date.now();
  const id = `session-${session.date}-${now}`;

  await db.runAsync(
    `INSERT INTO training_session
       (id, date, start_time, gym_id, routine_id, alone_or_partner, time_budget, is_retroactive)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      session.date,
      now,
      session.gymId ?? null,
      session.routineId ?? null,
      session.aloneOrPartner ?? null,
      session.timeBudget,
      session.isRetroactive ? 1 : 0,
    ],
  );

  return id;
}

export async function finishSession(db: SQLiteDatabase, sessionId: string): Promise<void> {
  await db.runAsync('UPDATE training_session SET end_time = ? WHERE id = ?;', [
    Date.now(),
    sessionId,
  ]);
}

export async function getSessionOn(
  db: SQLiteDatabase,
  date: IsoDate,
): Promise<TrainingSessionRow | null> {
  return db.getFirstAsync<TrainingSessionRow>(
    'SELECT * FROM training_session WHERE date = ? ORDER BY start_time DESC LIMIT 1;',
    [date],
  );
}

export type SessionDetails = {
  aloneOrPartner?: TrainingSessionRow['alone_or_partner'];
  crowding?: TrainingSessionRow['crowding'];
};

/**
 * Spec 8.5: how busy the gym was is asked on arrival and not while starting, so it
 * stays off the critical path. Spec 5.4 keeps it off a session written after the
 * fact, because crowding recalled days later is not evidence; the schema enforces
 * that too, and this refuses first so the message says why.
 */
export async function setSessionDetails(
  db: SQLiteDatabase,
  sessionId: string,
  details: SessionDetails,
): Promise<void> {
  const session = await db.getFirstAsync<TrainingSessionRow>(
    'SELECT * FROM training_session WHERE id = ?;',
    [sessionId],
  );
  if (!session) throw new Error(`there is no session called ${sessionId}`);

  if (details.crowding !== undefined && session.is_retroactive === 1) {
    throw new Error('a session written after the fact cannot say how busy the gym was');
  }

  if (details.aloneOrPartner !== undefined) {
    await db.runAsync('UPDATE training_session SET alone_or_partner = ? WHERE id = ?;', [
      details.aloneOrPartner,
      sessionId,
    ]);
  }
  if (details.crowding !== undefined) {
    await db.runAsync('UPDATE training_session SET crowding = ? WHERE id = ?;', [
      details.crowding,
      sessionId,
    ]);
  }
}

export type NewSet = {
  sessionId: string;
  exerciseId: string;
  weightKg: number;
  reps: number;
  isWarmup?: boolean;
  rpe?: number | null;
  restBeforeSeconds?: number | null;
};

/**
 * Spec 9. The rest is read off the previous set of the same exercise instead of a
 * timer he has to remember to start, which is the only way a number this boring
 * ever gets recorded. Null on the first set of an exercise, where there is nothing
 * to measure from.
 */
async function measureRest(db: SQLiteDatabase, set: NewSet, now: number): Promise<number | null> {
  const previous = await db.getFirstAsync<{ timestamp: number }>(
    `SELECT timestamp FROM training_set_entry
      WHERE session_id = ? AND exercise_id = ?
   ORDER BY set_index DESC
      LIMIT 1;`,
    [set.sessionId, set.exerciseId],
  );

  if (!previous) return null;
  return Math.max(0, Math.round((now - previous.timestamp) / 1000));
}

export async function addSet(db: SQLiteDatabase, set: NewSet): Promise<string> {
  if (!Number.isInteger(set.reps) || set.reps < 1) {
    throw new Error(`a set of ${set.reps} reps is not a set`);
  }
  if (!Number.isFinite(set.weightKg) || set.weightKg < 0) {
    throw new Error(`a set cannot weigh ${set.weightKg} kg`);
  }

  const timestamp = Date.now();
  const id = `set-${timestamp}-${Math.floor(Math.random() * 1e6)}`;

  // A set typed in after the fact carries its own rest or none at all: the clock
  // says nothing about a session that happened hours ago.
  const restBeforeSeconds =
    set.restBeforeSeconds !== undefined
      ? set.restBeforeSeconds
      : await measureRest(db, set, timestamp);

  await db.runAsync(
    `INSERT INTO training_set_entry
       (id, session_id, exercise_id, set_index, weight_kg, reps, rest_before_seconds,
        timestamp, rpe, is_warmup)
     VALUES (
       ?, ?, ?,
       (SELECT coalesce(max(set_index), 0) + 1 FROM training_set_entry
         WHERE session_id = ? AND exercise_id = ?),
       ?, ?, ?, ?, ?, ?
     );`,
    [
      id,
      set.sessionId,
      set.exerciseId,
      set.sessionId,
      set.exerciseId,
      set.weightKg,
      set.reps,
      restBeforeSeconds,
      timestamp,
      set.rpe ?? null,
      set.isWarmup ? 1 : 0,
    ],
  );

  return id;
}

export async function deleteSet(db: SQLiteDatabase, setId: string): Promise<void> {
  await db.runAsync('DELETE FROM training_set_entry WHERE id = ?;', [setId]);
}

export async function listSetsForSession(
  db: SQLiteDatabase,
  sessionId: string,
): Promise<TrainingSetEntryRow[]> {
  return db.getAllAsync<TrainingSetEntryRow>(
    'SELECT * FROM training_set_entry WHERE session_id = ? ORDER BY exercise_id, set_index;',
    [sessionId],
  );
}

type LastSetRow = {
  session_id: string;
  date: IsoDate;
  exercise_id: string;
  set_index: number;
  weight_kg: number;
  reps: number;
  rest_before_seconds: number | null;
  timestamp: number;
};

/**
 * Spec 6.4: the largest element on the in-session screen is last session's actual
 * sets for this exercise, because that is what he copies most of the time. Warmups
 * are left out, as everywhere else (spec 5.5).
 */
export async function lastSessionSets(
  db: SQLiteDatabase,
  exerciseId: string,
  beforeSessionId: string | null,
): Promise<LoggedSet[]> {
  const rows = await db.getAllAsync<LastSetRow>(
    `SELECT s.session_id, e.date, s.exercise_id, s.set_index, s.weight_kg, s.reps,
            s.rest_before_seconds, s.timestamp
       FROM training_set_entry s
       JOIN training_session e ON e.id = s.session_id
      WHERE s.exercise_id = ?
        AND s.is_warmup = 0
        AND (? IS NULL OR s.session_id <> ?)
        AND s.session_id = (
          SELECT s2.session_id
            FROM training_set_entry s2
            JOIN training_session e2 ON e2.id = s2.session_id
           WHERE s2.exercise_id = ?
             AND s2.is_warmup = 0
             AND (? IS NULL OR s2.session_id <> ?)
        ORDER BY e2.date DESC, s2.timestamp DESC
           LIMIT 1
        )
   ORDER BY s.set_index;`,
    [exerciseId, beforeSessionId, beforeSessionId, exerciseId, beforeSessionId, beforeSessionId],
  );

  return rows.map((row) => ({
    sessionId: row.session_id,
    date: row.date,
    exerciseId: row.exercise_id,
    setIndex: row.set_index,
    weightKg: row.weight_kg,
    reps: row.reps,
    restBeforeSeconds: row.rest_before_seconds,
    timestamp: row.timestamp,
  }));
}

/** Spec 6.3: the eight week window the best and worst marks are drawn from. */
export const MARKS_WINDOW_DAYS = 56;

export function marksWindow(onDate: IsoDate, floor: IsoDate | null) {
  const window = trailingDays(onDate, MARKS_WINDOW_DAYS);
  // Spec 6.5: while readapting, comparisons only reach back to the day he returned.
  return floor && floor > window.from ? { from: floor, to: window.to } : window;
}
