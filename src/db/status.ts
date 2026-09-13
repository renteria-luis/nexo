import type { SQLiteDatabase } from 'expo-sqlite';

export type DatabaseStatus = {
  appliedMigrations: string[];
  tableCount: number;
};

/**
 * What the database actually contains right now. Exists so the app can prove the
 * schema reached the device rather than assuming it did.
 */
export async function readDatabaseStatus(db: SQLiteDatabase): Promise<DatabaseStatus> {
  const applied = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM core_migration ORDER BY id;',
  );

  const tables = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%';`,
  );

  if (!tables) throw new Error('sqlite_master returned no row, the database is not readable');

  return {
    appliedMigrations: applied.map((row) => row.id),
    tableCount: tables.count,
  };
}
