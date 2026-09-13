import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from './migrations/index.ts';

type AppliedRow = { id: string };

/**
 * Applies every migration that has not run yet, in order, and returns the ids
 * it applied. Each migration runs inside its own transaction, so a failing
 * statement leaves the database on the last complete migration rather than
 * half way through one.
 */
export async function migrate(db: SQLiteDatabase): Promise<string[]> {
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
    if (applied.has(migration.id)) continue;

    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
      await db.runAsync('INSERT INTO core_migration (id, applied_at) VALUES (?, ?);', [
        migration.id,
        Date.now(),
      ]);
    });

    ran.push(migration.id);
  }

  return ran;
}
