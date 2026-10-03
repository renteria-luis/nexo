import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from './migrations/index.ts';

type AppliedRow = { id: string };

/**
 * Applies every migration that has not run yet, in order, and returns the ids
 * it applied. Each migration runs inside its own transaction, so a failing
 * statement leaves the database on the last complete migration rather than
 * half way through one.
 *
 * `upTo` stops after that migration. Restoring an old backup needs the schema it was
 * written against first, so the rest can run over its rows afterwards.
 */
export async function migrate(db: SQLiteDatabase, upTo?: string): Promise<string[]> {
  if (upTo !== undefined && !migrations.some((migration) => migration.id === upTo)) {
    throw new Error(`there is no migration called ${upTo}`);
  }

  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS core_migration (
       id TEXT PRIMARY KEY,
       applied_at INTEGER NOT NULL
     ) STRICT;`,
  );

  const rows = await db.getAllAsync<AppliedRow>('SELECT id FROM core_migration;');
  const applied = new Set(rows.map((row) => row.id));
  const ran: string[] = [];

  for (const migration of migrations) {
    if (!applied.has(migration.id)) {
      await db.withTransactionAsync(async () => {
        await db.execAsync(migration.sql);
        await db.runAsync('INSERT INTO core_migration (id, applied_at) VALUES (?, ?);', [
          migration.id,
          Date.now(),
        ]);
      });
      ran.push(migration.id);
    }
    if (migration.id === upTo) break;
  }

  return ran;
}
