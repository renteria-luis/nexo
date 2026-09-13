import * as SQLite from 'expo-sqlite';

import { migrate } from './migrate';

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

export { migrate };
export type { Migration } from './migrations';
