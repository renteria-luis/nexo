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
 * Deletes the database file and opens it again, rebuilt from the migrations.
 *
 * Needed while the schema is still moving: a migration that has already run is
 * never re-run, so editing one leaves a device on an older shape than the code
 * expects. Once this is pushed, a change means a new migration and this button is
 * only for a fresh start.
 */
export async function resetDatabase(): Promise<void> {
  // The reset is the open every caller waits on. Clearing `opening` before the close
  // let any screen that asked in between open the file again; expo-sqlite hands that
  // caller the same cached connection with one more reference, so the close only
  // dropped a reference and the delete refused a file that was still open.
  const previous = opening;
  const reset = (async () => {
    const db = await previous?.catch(() => null);
    if (db) await db.closeAsync();
    await SQLite.deleteDatabaseAsync(DATABASE_NAME);
    return open();
  })();
  opening = reset.catch((error: unknown) => {
    opening = null;
    throw error;
  });
  await opening;
}
