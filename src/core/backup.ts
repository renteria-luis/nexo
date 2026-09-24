// Todo lo que hay en el telefono, en un archivo JSON, y de vuelta.
//
// Sirve para dos cosas a la vez y por eso el formato es plano y aburrido: es el
// respaldo por si se borra la app o cambia de telefono, y es el material para
// entrenar un modelo mas adelante. Un volcado tabla por tabla se lee igual de bien
// desde pandas que desde este archivo, y no inventa una estructura intermedia que
// habria que mantener al dia con el esquema.
//
// El esquema se mueve, asi que el archivo se firma con la lista de migraciones
// aplicadas. Importar un respaldo hecho por una version mas nueva de la app se
// rechaza en vez de meter filas en tablas que aqui todavia no existen.

import type { SQLiteDatabase } from 'expo-sqlite';

export const BACKUP_FORMAT = 'nexo-backup';
export const BACKUP_VERSION = 1;

/** La tabla del runner de migraciones: se firma con ella, nunca se sobreescribe. */
const MIGRATION_TABLE = 'core_migration';

/**
 * Las ofertas no son suyas y no entran.
 *
 * Son una copia de lo que publica Flipp, se vuelven a bajar solas y cada una guarda
 * la respuesta cruda del buscador entera: doscientas ofertas pesaban mas que todo lo
 * que el ha registrado en su vida. El respaldo es de sus datos.
 */
function isHisData(table: string): boolean {
  return table !== MIGRATION_TABLE && !table.startsWith('deals_');
}

/** Lo que hay que saber para leer el archivo sin tener el codigo al lado. */
export const BACKUP_NOTES = {
  weights: 'kilogramos, siempre, aunque la app los muestre en libras',
  dumbbells: 'weightKg es lo que dice una mancuerna; loadFactor 2 significa que se levantaron dos',
  money: 'centavos de dolar canadiense, enteros',
  timestamps: 'milisegundos desde 1970, hora local del telefono',
  dates: 'AAAA-MM-DD, el dia del calendario local',
  score: '0 a 100 segun spec 4.1; null cuando el dia no tiene con que puntuarse',
  tables: 'el volcado crudo de la base, que es la fuente para restaurar',
  deals: 'las ofertas no estan: son una copia de Flipp que se vuelve a bajar sola',
  days: 'lo mismo ya resuelto por dia, que es lo que sirve para graficas y modelos',
};

export type Backup = {
  format: string;
  version: number;
  exportedAt: number;
  migrations: string[];
  notes: typeof BACKUP_NOTES;
  tables: Record<string, Record<string, unknown>[]>;
  /** Un objeto por dia, con la nota desglosada, el entreno y la comida ya unidos. */
  days: unknown[];
};

async function userTables(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name;`,
  );
  return rows.map((row) => row.name);
}

async function columnsOf(db: SQLiteDatabase, table: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table});`);
  return rows.map((row) => row.name);
}

export async function exportBackup(db: SQLiteDatabase, days: unknown[] = []): Promise<Backup> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const names = await userTables(db);

  for (const table of names) {
    if (!isHisData(table)) continue;
    tables[table] = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${table};`);
  }

  const migrations = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM ${MIGRATION_TABLE} ORDER BY id;`,
  );

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    migrations: migrations.map((row) => row.id),
    notes: BACKUP_NOTES,
    tables,
    days,
  };
}

/** Rechaza con un motivo legible en vez de devolver a medias. */
export function parseBackup(raw: unknown): Backup {
  if (typeof raw !== 'object' || raw === null) throw new Error('el archivo no es un objeto JSON');
  const body = raw as Record<string, unknown>;

  if (body.format !== BACKUP_FORMAT) {
    throw new Error(`el archivo dice ser "${String(body.format)}" y no un respaldo de nexo`);
  }
  if (body.version !== BACKUP_VERSION) {
    throw new Error(
      `el respaldo es version ${String(body.version)} y esta app lee la ${BACKUP_VERSION}`,
    );
  }
  if (typeof body.tables !== 'object' || body.tables === null) {
    throw new Error('el respaldo no trae tablas');
  }
  if (!Array.isArray(body.migrations)) {
    throw new Error('el respaldo no dice con que esquema fue hecho');
  }

  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const [table, rows] of Object.entries(body.tables as Record<string, unknown>)) {
    if (!Array.isArray(rows)) throw new Error(`la tabla ${table} no es una lista de filas`);
    tables[table] = rows as Record<string, unknown>[];
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: typeof body.exportedAt === 'number' ? body.exportedAt : 0,
    migrations: (body.migrations as unknown[]).map(String),
    notes: BACKUP_NOTES,
    tables,
    // Al restaurar no se mira: las tablas mandan y esto se vuelve a calcular solo.
    days: Array.isArray(body.days) ? body.days : [],
  };
}

export type ImportResult = { tables: number; rows: number; skipped: string[] };

/**
 * Reemplaza el contenido del telefono por el del respaldo.
 *
 * Las claves foraneas se apagan durante la carga porque las tablas se escriben en
 * orden alfabetico y una sesion puede entrar antes que su gimnasio; al final se
 * vuelven a encender y se comprueba todo de golpe, asi que un respaldo inconsistente
 * falla en voz alta y no deja la base a medio camino.
 */
export async function importBackup(db: SQLiteDatabase, backup: Backup): Promise<ImportResult> {
  const applied = await db.getAllAsync<{ id: string }>(`SELECT id FROM ${MIGRATION_TABLE};`);
  const here = new Set(applied.map((row) => row.id));
  const ahead = backup.migrations.filter((id) => !here.has(id));
  if (ahead.length > 0) {
    throw new Error(
      `el respaldo viene de una version mas nueva de la app (le falta a este telefono: ${ahead.join(', ')})`,
    );
  }

  const present = new Set(await userTables(db));
  const skipped: string[] = [];
  let writtenTables = 0;
  let writtenRows = 0;

  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    await db.withTransactionAsync(async () => {
      for (const [table, rows] of Object.entries(backup.tables)) {
        if (!isHisData(table)) continue;
        if (!present.has(table)) {
          skipped.push(table);
          continue;
        }

        const columns = new Set(await columnsOf(db, table));
        await db.runAsync(`DELETE FROM ${table};`);
        writtenTables += 1;

        for (const row of rows) {
          const keys = Object.keys(row).filter((key) => columns.has(key));
          if (keys.length === 0) continue;
          const placeholders = keys.map(() => '?').join(', ');
          await db.runAsync(
            `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders});`,
            keys.map((key) => row[key] as string | number | null),
          );
          writtenRows += 1;
        }
      }
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }

  const broken = await db.getAllAsync<{ table: string }>('PRAGMA foreign_key_check;');
  if (broken.length > 0) {
    throw new Error(`el respaldo dejo ${broken.length} referencias rotas`);
  }

  return { tables: writtenTables, rows: writtenRows, skipped };
}
