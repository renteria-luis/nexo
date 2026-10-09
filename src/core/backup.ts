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

import { migrate } from '../db/migrate.ts';
import { migrations } from '../db/migrations/index.ts';
import { inTransaction } from '../db/transaction.ts';

export const BACKUP_FORMAT = 'nexo-backup';
export const BACKUP_VERSION = 1;

/** La tabla del runner de migraciones: se firma con ella, nunca se sobreescribe. */
const MIGRATION_TABLE = 'core_migration';

/**
 * Las ofertas no son suyas y no entran.
 *
 * Son una copia de lo que publica Flipp, se vuelven a bajar solas y cada una guarda
 * la respuesta cruda del buscador entera: doscientas ofertas pesaban mas que todo lo
 * que el ha registrado en su vida. El respaldo es de sus datos, y lo que el contesto
 * sobre una oferta (spec 16.5) si lo es.
 */
function isHisData(table: string): boolean {
  if (table === 'deals_match_verdict') return true;
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

/** Borra y vuelve a escribir cada tabla suya que trae el respaldo y que existe en `db`. */
async function writeTables(db: SQLiteDatabase, tables: Backup['tables']): Promise<ImportResult> {
  const present = new Set(await userTables(db));
  const result: ImportResult = { tables: 0, rows: 0, skipped: [] };

  for (const [table, rows] of Object.entries(tables)) {
    if (!isHisData(table)) continue;
    if (!present.has(table)) {
      result.skipped.push(table);
      continue;
    }

    const columns = new Set(await columnsOf(db, table));
    await db.runAsync(`DELETE FROM ${table};`);
    result.tables += 1;

    for (const row of rows) {
      const keys = Object.keys(row).filter((key) => columns.has(key));
      if (keys.length === 0) continue;
      const placeholders = keys.map(() => '?').join(', ');
      await db.runAsync(
        `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders});`,
        keys.map((key) => row[key] as string | number | null),
      );
      result.rows += 1;
    }
  }

  return result;
}

/**
 * Un respaldo de una version anterior, puesto al dia en `scratch`.
 *
 * Escrito tal cual sobre este telefono, las migraciones que vinieron despues de el ya
 * cuentan como hechas pero nunca le llegan: sus rellenos no tocan sus filas (las sesiones
 * vuelven sin hora de fiar), sus semillas se pierden (la leche sin su peso, el estudio de
 * la creatina) y las tablas nuevas se quedan con filas que apuntan a un catalogo que el
 * respaldo no tiene, asi que la comprobacion lo rechazaba entero. Aqui se arma su mismo
 * esquema, se cargan sus filas y se le pasan las migraciones que le faltan, como le
 * habrian pasado en el telefono. Lo que sale es lo que entra.
 */
async function caughtUp(scratch: SQLiteDatabase, backup: Backup): Promise<Backup['tables']> {
  const order = migrations.map((migration) => migration.id);
  const had = new Set(backup.migrations);
  const last = order.filter((id) => had.has(id)).at(-1);
  // Las migraciones corren siempre en orden, asi que un respaldo de verdad trae el
  // principio de la lista y nada suelto.
  const prefix = last === undefined ? [] : order.slice(0, order.indexOf(last) + 1);
  if (last === undefined || prefix.length !== had.size) {
    throw new Error(
      'el respaldo no dice bien con que version se hizo, asi que no se puede poner al dia',
    );
  }

  await migrate(scratch, last);
  await scratch.execAsync('PRAGMA foreign_keys = OFF;');
  const loaded = await writeTables(scratch, backup.tables);
  if (loaded.skipped.length > 0) {
    throw new Error(
      `el respaldo trae tablas que su version no tenia: ${loaded.skipped.join(', ')}`,
    );
  }
  // El resto de las migraciones, con sus rellenos, semillas y notas borradas, sobre sus filas.
  await migrate(scratch);

  const tables: Backup['tables'] = {};
  for (const table of await userTables(scratch)) {
    if (!isHisData(table)) continue;
    tables[table] = await scratch.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${table};`);
  }
  return tables;
}

/**
 * Reemplaza el contenido del telefono por el del respaldo.
 *
 * Las claves foraneas se apagan durante la carga porque las tablas se escriben en
 * orden alfabetico y una sesion puede entrar antes que su gimnasio. La comprobacion se
 * hace de golpe al final y **dentro de la misma transaccion**: asi un respaldo
 * inconsistente la tumba entera y el telefono se queda con lo que tenia. Comprobar
 * despues de confirmar dejaba la base rota y solo avisaba de ello.
 *
 * Un respaldo de una version anterior se pone al dia primero en `scratch`, una base
 * aparte y vacia, y lo que entra es el resultado (ver `caughtUp`). Uno de esta misma
 * version entra tal cual.
 */
export async function importBackup(
  db: SQLiteDatabase,
  backup: Backup,
  scratch?: SQLiteDatabase,
): Promise<ImportResult> {
  const applied = await db.getAllAsync<{ id: string }>(`SELECT id FROM ${MIGRATION_TABLE};`);
  const here = new Set(applied.map((row) => row.id));
  const ahead = backup.migrations.filter((id) => !here.has(id));
  if (ahead.length > 0) {
    throw new Error(
      `el respaldo viene de una version mas nueva de la app (le falta a este telefono: ${ahead.join(', ')})`,
    );
  }

  const behind = [...here].some((id) => !backup.migrations.includes(id));
  let tables = backup.tables;
  if (behind) {
    if (scratch === undefined) {
      throw new Error(
        'un respaldo de una version anterior necesita una base aparte donde ponerse al dia',
      );
    }
    tables = await caughtUp(scratch, backup);
  }

  let result: ImportResult = { tables: 0, rows: 0, skipped: [] };
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    await inTransaction(db, async () => {
      result = await writeTables(db, tables);

      const broken = await db.getAllAsync<{ table: string }>('PRAGMA foreign_key_check;');
      if (broken.length > 0) {
        // Con el nombre de la tabla: casi siempre es un respaldo viejo restaurado sobre
        // datos nuevos que apuntaban a algo que ese respaldo no tiene.
        const where = [...new Set(broken.map((row) => row.table))].join(', ');
        throw new Error(
          `el respaldo dejaria ${broken.length} referencias rotas en ${where}, asi que no se aplico`,
        );
      }
    });
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }

  return result;
}
