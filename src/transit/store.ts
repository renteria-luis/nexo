import type { SQLiteDatabase } from 'expo-sqlite';

import { distanceMetres, type Coordinates } from '../core/geo.ts';
import { inTransaction, whenIdle } from '../db/transaction.ts';
import { SCHEDULE_SCHEMA, validateSchedule, validCoordinates, type Schedule } from './schedule.ts';
import { serializePath } from './walks.ts';
import { categoryKey, cleanCategory } from './place-categories.ts';

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
  'leaf',
] as const;
export type PlaceIcon = (typeof PLACE_ICONS)[number];

export type Place = Coordinates & {
  id: string;
  name: string;
  address: string;
  gym_id: string | null;
  icon: PlaceIcon;
  /** Words to find it by, separated by commas. */
  tags: string;
  /** A user-defined map group; empty means uncategorized. */
  category: string;
  /** 1 lists it first; without one it goes after the ranked places. */
  importance: number | null;
  updated_at: number;
};
export type WalkLink = {
  place_id: string;
  stop_id: string;
  direction: 'to_stop' | 'from_stop';
  minutes: number;
  entrance: string;
  /** The way he walks it, as stored by `serializePath`; empty when he kept none. */
  path: string;
  updated_at: number;
};
export type StopWalk = {
  from_stop: string;
  to_stop: string;
  minutes: number;
  note: string;
  path: string;
  updated_at: number;
};
export type MapNote = Coordinates & {
  id: string;
  /** A button to press, a crossing that is usually slow, or any other note. */
  kind: 'button' | 'slow' | 'note';
  note: string;
  /** The wait he usually gets there, in seconds, when he noted one. */
  wait_min: number | null;
  wait_max: number | null;
  updated_at: number;
};
export type WalkPathTarget =
  | { kind: 'link'; placeId: string; stopId: string; direction: WalkLink['direction'] }
  | { kind: 'transfer'; fromStop: string; toStop: string };
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

/** How every list of places is ordered: by importance, 1 first, then the unranked, by name. */
export function sortPlaces(places: readonly Place[]): Place[] {
  return [...places].sort(
    (a, b) => (a.importance ?? 11) - (b.importance ?? 11) || a.name.localeCompare(b.name, 'es'),
  );
}

/** The place he is at, or the closest one to where he is (within maxMetres when given). */
export function nearestPlace(
  places: readonly Place[],
  point: Coordinates,
  maxMetres?: number,
): Place | null {
  let best: { place: Place; metres: number } | null = null;
  for (const place of places) {
    const metres = distanceMetres(point, place);
    if (maxMetres !== undefined && metres > maxMetres) continue;
    if (!best || metres < best.metres) best = { place, metres };
  }
  return best?.place ?? null;
}

/** "gym,  fit , ,gimnasio" is kept as "gym, fit, gimnasio". */
function cleanTags(tags: string): string {
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(', ');
}

/** An edit that leaves out optional fields keeps their saved values. */
export async function savePlace(
  db: SQLiteDatabase,
  input: {
    id?: string;
    name: string;
    address: string;
    icon?: PlaceIcon;
    tags?: string;
    category?: string;
    importance?: number | null;
  } & Coordinates,
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
  if (input.tags !== undefined && input.tags.length > 500) {
    throw new Error('Las etiquetas pasan de 500 letras.');
  }
  if (input.category !== undefined && cleanCategory(input.category).length > 80) {
    throw new Error('La categoría puede tener hasta 80 caracteres.');
  }
  if (
    input.importance != null &&
    (!Number.isInteger(input.importance) || input.importance < 1 || input.importance > 10)
  ) {
    throw new Error('La importancia va de 1 a 10, o se deja vacía.');
  }
  const tags = input.tags === undefined ? null : cleanTags(input.tags);
  const id = input.id ?? `place-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  await inTransaction(db, async () => {
    let category = input.category === undefined ? null : cleanCategory(input.category);
    if (category) {
      const saved = await db.getAllAsync<{ category: string }>(
        "SELECT DISTINCT category FROM transit_place WHERE category <> '' ORDER BY rowid;",
      );
      category =
        saved.find((p) => categoryKey(p.category) === categoryKey(category!))?.category ?? category;
    }
    if (input.id) {
      const existing = await db.getFirstAsync<{ importance: number | null }>(
        'SELECT importance FROM transit_place WHERE id = ?;',
        [id],
      );
      if (!existing) throw new Error('Ese lugar ya no existe. Vuelve a abrir Transit.');
      await db.runAsync(
        'UPDATE transit_place SET name = ?, address = ?, lat = ?, lng = ?, icon = COALESCE(?, icon), tags = COALESCE(?, tags), category = COALESCE(?, category), importance = ?, updated_at = ? WHERE id = ?;',
        [
          input.name.trim(),
          input.address.trim(),
          input.lat,
          input.lng,
          input.icon ?? null,
          tags,
          category,
          input.importance === undefined ? existing.importance : input.importance,
          Date.now(),
          id,
        ],
      );
    } else {
      await db.runAsync(
        'INSERT INTO transit_place (id, name, address, lat, lng, icon, tags, category, importance, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);',
        [
          id,
          input.name.trim(),
          input.address.trim(),
          input.lat,
          input.lng,
          input.icon ?? 'pin',
          tags ?? '',
          category ?? '',
          input.importance ?? null,
          Date.now(),
        ],
      );
    }
  });
  return id;
}

export async function listWalkLinks(db: SQLiteDatabase, placeId?: string): Promise<WalkLink[]> {
  await whenIdle(db);
  return db.getAllAsync<WalkLink>(
    `SELECT * FROM transit_walk_link ${placeId === undefined ? '' : 'WHERE place_id = ?'} ORDER BY place_id, stop_id, direction;`,
    placeId === undefined ? [] : [placeId],
  );
}

export async function saveWalkLink(
  db: SQLiteDatabase,
  link: Omit<WalkLink, 'updated_at' | 'path'>,
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
  walk: Omit<StopWalk, 'updated_at' | 'path'>,
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

/** Keeps a path on a walk he already gave minutes to (or seeds them from an accepted walk); an empty path clears it. */
export async function saveWalkPath(
  db: SQLiteDatabase,
  target: WalkPathTarget,
  path: readonly Coordinates[],
  seedMinutes?: number,
): Promise<void> {
  const content = serializePath(path);
  const validSeed =
    seedMinutes !== undefined &&
    Number.isInteger(seedMinutes) &&
    seedMinutes > 0 &&
    seedMinutes <= 60
      ? seedMinutes
      : undefined;
  await inTransaction(db, async () => {
    const now = Date.now();
    const result =
      target.kind === 'link'
        ? await db.runAsync(
            'UPDATE transit_walk_link SET path = ?, updated_at = ? WHERE place_id = ? AND stop_id = ? AND direction = ?;',
            [content, now, target.placeId, target.stopId, target.direction],
          )
        : await db.runAsync(
            'UPDATE transit_stop_walk SET path = ?, updated_at = ? WHERE from_stop = ? AND to_stop = ?;',
            [content, now, target.fromStop, target.toStop],
          );
    if (result.changes) return;
    if (validSeed !== undefined) {
      if (target.kind === 'link') {
        await db.runAsync(
          `INSERT INTO transit_walk_link (place_id, stop_id, direction, minutes, entrance, path, updated_at)
          VALUES (?, ?, ?, ?, '', ?, ?);`,
          [target.placeId, target.stopId, target.direction, validSeed, content, now],
        );
      } else {
        await db.runAsync(
          `INSERT INTO transit_stop_walk (from_stop, to_stop, minutes, note, path, updated_at)
          VALUES (?, ?, ?, '', ?, ?);`,
          [target.fromStop, target.toStop, validSeed, content, now],
        );
      }
      return;
    }
    throw new Error('Guarda primero los minutos de esa caminata; el camino va con ellos.');
  });
}

export async function listMapNotes(db: SQLiteDatabase): Promise<MapNote[]> {
  await whenIdle(db);
  return db.getAllAsync<MapNote>('SELECT * FROM transit_map_note ORDER BY updated_at;');
}

export async function saveMapNote(
  db: SQLiteDatabase,
  input: Omit<MapNote, 'id' | 'updated_at'> & { id?: string },
): Promise<string> {
  const waits = [input.wait_min, input.wait_max];
  if (
    !validCoordinates(input) ||
    !['button', 'slow', 'note'].includes(input.kind) ||
    input.note.length > 500 ||
    waits.some((w) => w !== null && (!Number.isInteger(w) || w < 0 || w > 600)) ||
    (input.wait_min !== null && input.wait_max !== null && input.wait_min > input.wait_max)
  )
    throw new Error(
      'Revisa la nota: hasta 500 letras y una espera de 0 a 600 s, la menor primero.',
    );
  const id = input.id ?? `note-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  await inTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO transit_map_note (id, lat, lng, kind, note, wait_min, wait_max, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET lat = excluded.lat,
      lng = excluded.lng, kind = excluded.kind, note = excluded.note, wait_min = excluded.wait_min,
      wait_max = excluded.wait_max, updated_at = excluded.updated_at;`,
      [
        id,
        input.lat,
        input.lng,
        input.kind,
        input.note.trim(),
        input.wait_min,
        input.wait_max,
        Date.now(),
      ],
    );
  });
  return id;
}

export async function deleteMapNote(db: SQLiteDatabase, id: string): Promise<void> {
  await inTransaction(db, async () => {
    await db.runAsync('DELETE FROM transit_map_note WHERE id = ?;', [id]);
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
