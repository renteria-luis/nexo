import type { SQLiteDatabase } from 'expo-sqlite';

import type { Coordinates } from '../core/geo.ts';
import { inTransaction, whenIdle } from '../db/transaction.ts';
import { SCHEDULE_SCHEMA, validateSchedule, validCoordinates, type Schedule } from './schedule.ts';

export const PLACE_ICONS = [
  'pin',
  'home',
  'work',
  'gym',
  'school',
  'grocery',
  'mall',
  'store',
  'cinema',
  'food',
  'coffee',
  'love',
  'hospital',
  'pharmacy',
  'park',
  'library',
  'church',
  'friends',
  'train',
  'airport',
] as const;
export type PlaceIcon = (typeof PLACE_ICONS)[number];

export type Place = Coordinates & {
  id: string;
  name: string;
  address: string;
  gym_id: string | null;
  icon: PlaceIcon;
  updated_at: number;
};
export type WalkLink = {
  place_id: string;
  stop_id: string;
  direction: 'to_stop' | 'from_stop';
  minutes: number;
  entrance: string;
  updated_at: number;
};
export type StopWalk = {
  from_stop: string;
  to_stop: string;
  minutes: number;
  note: string;
  updated_at: number;
};
export type CachedSchedule = {
  sha256: string;
  schedule: Schedule;
  saved_at: number;
  checked_at: number | null;
  last_error: string | null;
};

export async function listPlaces(db: SQLiteDatabase): Promise<Place[]> {
  await whenIdle(db);
  return db.getAllAsync<Place>('SELECT * FROM transit_place ORDER BY rowid;');
}

export async function savePlace(
  db: SQLiteDatabase,
  input: { id?: string; name: string; address: string; icon?: PlaceIcon } & Coordinates,
): Promise<string> {
  if (input.icon !== undefined && !PLACE_ICONS.includes(input.icon)) {
    throw new Error('Elige uno de los íconos de la lista.');
  }
  if (
    !input.name.trim() ||
    input.name.length > 120 ||
    input.address.length > 500 ||
    !validCoordinates(input)
  ) {
    throw new Error('Revisa el nombre, la latitud (-90 a 90) y la longitud (-180 a 180).');
  }
  const id = input.id ?? `place-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  await inTransaction(db, async () => {
    if (input.id) {
      const existing = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM transit_place WHERE id = ?;',
        [id],
      );
      if (!existing) throw new Error('Ese lugar ya no existe. Vuelve a abrir Transit.');
      await db.runAsync(
        'UPDATE transit_place SET name = ?, address = ?, lat = ?, lng = ?, icon = COALESCE(?, icon), updated_at = ? WHERE id = ?;',
        [
          input.name.trim(),
          input.address.trim(),
          input.lat,
          input.lng,
          input.icon ?? null,
          Date.now(),
          id,
        ],
      );
    } else {
      await db.runAsync(
        'INSERT INTO transit_place (id, name, address, lat, lng, icon, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?);',
        [
          id,
          input.name.trim(),
          input.address.trim(),
          input.lat,
          input.lng,
          input.icon ?? 'pin',
          Date.now(),
        ],
      );
    }
  });
  return id;
}

export async function listWalkLinks(db: SQLiteDatabase, placeId: string): Promise<WalkLink[]> {
  await whenIdle(db);
  return db.getAllAsync<WalkLink>(
    'SELECT * FROM transit_walk_link WHERE place_id = ? ORDER BY stop_id, direction;',
    [placeId],
  );
}

export async function saveWalkLink(
  db: SQLiteDatabase,
  link: Omit<WalkLink, 'updated_at'>,
): Promise<void> {
  if (
    !Number.isFinite(link.minutes) ||
    link.minutes <= 0 ||
    link.minutes > 240 ||
    !link.stop_id ||
    !['to_stop', 'from_stop'].includes(link.direction) ||
    link.entrance.length > 500
  ) {
    throw new Error(
      'Escribe más de 0 y hasta 240 minutos y una puerta o nota de hasta 500 caracteres.',
    );
  }
  await inTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO transit_walk_link (place_id, stop_id, direction, minutes, entrance, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(place_id, stop_id, direction) DO UPDATE SET
      minutes = excluded.minutes, entrance = excluded.entrance, updated_at = excluded.updated_at;`,
      [link.place_id, link.stop_id, link.direction, link.minutes, link.entrance.trim(), Date.now()],
    );
  });
}

export async function listStopWalks(db: SQLiteDatabase): Promise<StopWalk[]> {
  await whenIdle(db);
  return db.getAllAsync<StopWalk>('SELECT * FROM transit_stop_walk ORDER BY from_stop, to_stop;');
}

export async function saveStopWalk(
  db: SQLiteDatabase,
  walk: Omit<StopWalk, 'updated_at'>,
): Promise<void> {
  if (
    !Number.isFinite(walk.minutes) ||
    walk.minutes <= 0 ||
    walk.minutes > 60 ||
    !walk.from_stop ||
    !walk.to_stop ||
    walk.from_stop === walk.to_stop ||
    walk.note.length > 500
  ) {
    throw new Error(
      'Escribe más de 0 y hasta 60 minutos entre dos paradas distintas, y una nota de hasta 500 caracteres.',
    );
  }
  await inTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO transit_stop_walk (from_stop, to_stop, minutes, note, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(from_stop, to_stop) DO UPDATE SET
      minutes = excluded.minutes, note = excluded.note, updated_at = excluded.updated_at;`,
      [walk.from_stop, walk.to_stop, walk.minutes, walk.note.trim(), Date.now()],
    );
  });
}

export async function readSchedule(db: SQLiteDatabase): Promise<CachedSchedule | null> {
  await whenIdle(db);
  const row = await db.getFirstAsync<{ content: string } & Omit<CachedSchedule, 'schedule'>>(
    'SELECT * FROM transit_schedule_cache WHERE id = 1;',
  );
  if (!row) return null;
  const content = JSON.parse(row.content);
  // A package saved by an older version of the app gives way to the one this version ships.
  if (typeof content?.schema === 'number' && content.schema < SCHEDULE_SCHEMA) return null;
  return { ...row, schedule: validateSchedule(content) };
}

export async function replaceSchedule(
  db: SQLiteDatabase,
  content: string,
  sha256: string,
  now = Date.now(),
): Promise<CachedSchedule> {
  const schedule = validateSchedule(JSON.parse(content));
  await inTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO transit_schedule_cache (id, sha256, content, saved_at, checked_at, last_error)
      VALUES (1, ?, ?, ?, ?, NULL) ON CONFLICT(id) DO UPDATE SET sha256 = excluded.sha256,
      content = excluded.content, saved_at = excluded.saved_at, checked_at = excluded.checked_at, last_error = NULL;`,
      [sha256, content, now, now],
    );
  });
  return { sha256, schedule, saved_at: now, checked_at: now, last_error: null };
}

export async function scheduleCheck(
  db: SQLiteDatabase,
  at: number,
  error: string | null,
): Promise<void> {
  await inTransaction(db, async () => {
    await db.runAsync(
      'UPDATE transit_schedule_cache SET checked_at = ?, last_error = ? WHERE id = 1;',
      [at, error],
    );
  });
}
