import type { SQLiteDatabase } from 'expo-sqlite';

import { inTransaction, whenIdle } from '../db/transaction.ts';
import {
  isActive,
  parseActiveTrip,
  type ActiveTrip,
  type WalkObservationDraft,
} from './active-trip.ts';
import type { ObservationStatus, WalkObservation } from './walks.ts';

/** Finished trips kept as evidence of what happened; older ones go. */
export const KEPT_TRIPS = 100;
/** Walks kept per link, reviewed or not; learning only reads the latest ten accepted. */
export const KEPT_WALKS = 30;

export async function readActiveTrip(db: SQLiteDatabase): Promise<ActiveTrip | null> {
  await whenIdle(db);
  const row = await db.getFirstAsync<{ content: string }>(
    "SELECT content FROM transit_trip WHERE status = 'active';",
  );
  return row ? parseActiveTrip(row.content) : null;
}

export async function readLastTrip(db: SQLiteDatabase): Promise<ActiveTrip | null> {
  await whenIdle(db);
  const row = await db.getFirstAsync<{ content: string }>(
    "SELECT content FROM transit_trip WHERE status <> 'active' ORDER BY ended_at DESC LIMIT 1;",
  );
  return row ? parseActiveTrip(row.content) : null;
}

/**
 * Saves the trip and the walks it just measured together. A finished trip keeps its stops,
 * times and evidence but not the street geometry, which the schedule already holds.
 */
export async function saveTrip(
  db: SQLiteDatabase,
  trip: ActiveTrip,
  observations: readonly WalkObservationDraft[] = [],
): Promise<void> {
  const active = isActive(trip);
  const kept = active
    ? trip
    : { ...trip, rides: trip.rides.map((ride) => ({ ...ride, path: [], after: [] })) };
  const now = Date.now();
  await inTransaction(db, async () => {
    if (active) {
      const other = await db.getFirstAsync<{ id: string }>(
        "SELECT id FROM transit_trip WHERE status = 'active' AND id <> ?;",
        [trip.id],
      );
      if (other) throw new Error('Ya hay un viaje en curso. Termínalo antes de empezar otro.');
    }
    await db.runAsync(
      `INSERT INTO transit_trip (id, status, started_at, ended_at, content) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, ended_at = excluded.ended_at,
      content = excluded.content;`,
      // A trip saved before readings were rounded can still hold fractions of a millisecond.
      [
        trip.id,
        active ? 'active' : trip.phase,
        Math.round(trip.startedAt),
        trip.endedAt === null ? null : Math.round(trip.endedAt),
        JSON.stringify(kept),
      ],
    );
    for (const walk of observations) {
      const row = {
        kind: walk.kind,
        place_id: walk.placeId,
        from_stop: walk.fromStop,
        to_stop: walk.toStop,
      };
      // Named by the trip and the moment, so saving the same step twice keeps one.
      await db.runAsync(
        `INSERT OR IGNORE INTO transit_walk_observation (id, trip_id, kind, place_id, from_stop,
        to_stop, started_at, left_at, ended_at, start_source, end_source, accuracy_m, path_m,
        straight_m, planned_minutes, trace, flag, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?);`,
        [
          `${walk.tripId}:${walk.kind}:${walk.startedAt}`,
          walk.tripId,
          walk.kind,
          walk.placeId,
          walk.fromStop,
          walk.toStop,
          Math.round(walk.startedAt),
          walk.leftAt === null ? null : Math.round(walk.leftAt),
          Math.round(walk.endedAt),
          walk.startSource,
          walk.endSource,
          walk.accuracy,
          walk.pathMetres,
          walk.straightMetres,
          walk.plannedMinutes,
          JSON.stringify(walk.trace),
          walk.flag,
          now,
        ],
      );
      await db.runAsync(
        `DELETE FROM transit_walk_observation WHERE id IN (SELECT id FROM transit_walk_observation
        WHERE kind = ? AND place_id IS ? AND from_stop IS ? AND to_stop IS ?
        ORDER BY ended_at DESC LIMIT -1 OFFSET ?);`,
        [row.kind, row.place_id, row.from_stop, row.to_stop, KEPT_WALKS],
      );
    }
    if (!active)
      await db.runAsync(
        `DELETE FROM transit_trip WHERE status <> 'active' AND id NOT IN (SELECT id FROM
        transit_trip WHERE status <> 'active' ORDER BY started_at DESC LIMIT ?);`,
        [KEPT_TRIPS],
      );
  });
}

export async function listWalkObservations(db: SQLiteDatabase): Promise<WalkObservation[]> {
  await whenIdle(db);
  return db.getAllAsync<WalkObservation>(
    'SELECT * FROM transit_walk_observation ORDER BY ended_at DESC;',
  );
}

/** Only the fields learning reads, without the traces. */
export async function listAcceptedWalks(db: SQLiteDatabase) {
  await whenIdle(db);
  return db.getAllAsync<
    Pick<
      WalkObservation,
      'kind' | 'place_id' | 'from_stop' | 'to_stop' | 'started_at' | 'ended_at' | 'status'
    >
  >(
    `SELECT kind, place_id, from_stop, to_stop, started_at, ended_at, status
    FROM transit_walk_observation WHERE status = 'accepted';`,
  );
}

export async function reviewWalk(
  db: SQLiteDatabase,
  id: string,
  status: Exclude<ObservationStatus, 'new'>,
): Promise<void> {
  await inTransaction(db, async () => {
    const result = await db.runAsync(
      'UPDATE transit_walk_observation SET status = ? WHERE id = ?;',
      [status, id],
    );
    if (!result.changes) throw new Error('Esa caminata ya no está. Vuelve a abrir Transit.');
  });
}
