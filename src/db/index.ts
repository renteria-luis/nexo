import * as SQLite from 'expo-sqlite';

import { migrate } from './migrate.ts';
import { readDatabaseStatus } from './status.ts';

const DATABASE_NAME = 'nexo.db';

let database: SQLite.SQLiteDatabase | null = null;

/**
 * Opens the on-device database and brings it up to date. Safe to call more than
 * once; the second call gets the same handle without re-running migrations.
 */
export async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;

  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await migrate(db);
  database = db;
  return db;
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
  if (database) {
    await database.closeAsync();
    database = null;
  }
  await SQLite.deleteDatabaseAsync(DATABASE_NAME);
}
