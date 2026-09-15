import * as SQLite from 'expo-sqlite';

import { migrate } from './migrate.ts';
import { readDatabaseStatus } from './status.ts';

const DATABASE_NAME = 'nexo.db';

// The promise, not the handle. Several screens ask for the database at the same
// moment, and a guard on the resolved handle lets all of them through while the
// first open is still in flight: two connections, two migration runs racing, and
// SQLite failing to finalize a statement underneath them.
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await migrate(db);
  return db;
}

/**
 * Opens the on-device database and brings it up to date. Safe to call from
 * anywhere and as often as needed: every caller waits on the same open.
 */
export function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) {
    opening = open().catch((error: unknown) => {
      // A failed open must not be remembered, or the app would keep handing out
      // the same failure for the rest of its life.
      opening = null;
      throw error;
    });
  }
  return opening;
}

export { migrate, readDatabaseStatus };
export type { Migration } from './migrations/index.ts';
export type { DatabaseStatus } from './status.ts';
export * from './types.ts';

/**
 * Deletes the database file and lets the next open rebuild it from the migrations.
 *
 * Needed while the schema is still moving: a migration that has already run is
 * never re-run, so editing one leaves a device on an older shape than the code
 * expects. Once this is pushed, a change means a new migration and this button is
 * only for a fresh start.
 */
export async function resetDatabase(): Promise<void> {
  const inFlight = opening;
  opening = null;
  if (inFlight) {
    const db = await inFlight.catch(() => null);
    if (db) await db.closeAsync();
  }
  await SQLite.deleteDatabaseAsync(DATABASE_NAME);
}
