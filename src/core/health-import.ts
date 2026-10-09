// Sueno y pasos que llegan de Salud y de AutoSleep por un Atajo de iOS.
//
// Nexo no puede leer Salud por su cuenta: la firma gratuita de SideStore no deja pasar el
// permiso de HealthKit. La app Atajos si puede, y AutoSleep le entrega su propio numero
// de sueno. El Atajo junta los dos en un enlace y abre Nexo con el:
//
//   nexo://salud?fecha=2026-10-09&sueno=7.75&fin=2026-10-09T07:25:00-04:00&pasos=8123
//
// - fecha: AAAA-MM-DD, el dia de los pasos. Si falta, hoy.
// - sueno: el "Sleep" de AutoSleep, horas con decimales: 7.75 son 7 h 45 min, no 7 h 75.
// - inicio, fin: el "Start" y el "Until" de AutoSleep en ISO 8601. El sueno cuenta para el
//   dia en que termino, que es el de fin; sin fin, el de fecha.
// - pasos: el total del dia que da Salud.
//
// Todo es opcional menos traer sueno o pasos. Vacio o en cero es "no llego nada" y no se
// escribe: nunca se guarda un cero que nadie midio. Cualquier otra cosa mal escrita
// rechaza el enlace entero y dice que, para arreglar el Atajo sin guardar medio dato.

import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  CoreDailyLogRow,
  CoreHealthImportRow,
  EpochMs,
  HealthMetric,
  HealthSource,
} from '../db/types.ts';
import { inTransaction } from '../db/transaction.ts';

import { number, plain, steps } from './commands.ts';
import { readDailyLog, upsertDailyLog } from './daily-log.ts';
import { addDays, isRealDate, todayIso, type IsoDate } from './dates.ts';

export type HealthReading = {
  metric: HealthMetric;
  source: HealthSource;
  date: IsoDate;
  /** Minutos de sueno o pasos; null cuando el Atajo no trajo nada. */
  value: number | null;
  startedAt: EpochMs | null;
  endedAt: EpochMs | null;
};

export type HealthLink = { ok: true; readings: HealthReading[] } | { ok: false; problem: string };

export const HEALTH_SOURCE_LABEL: Record<HealthSource, string> = {
  autosleep: 'AutoSleep',
  apple_health: 'Salud',
};

/**
 * Lo mas atras que puede apuntar un enlace. El Atajo manda hoy; una fecha de hace semanas
 * casi siempre es el formato de fecha al reves, y escribiria en el dia equivocado.
 */
const OLDEST_DAYS = 7;
const MAX_SLEEP_HOURS = 20;
const MAX_STEPS = 100_000;
/** Lo que se tolera entre el reloj del telefono y la hora que manda AutoSleep. */
const CLOCK_SKEW_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
const KEYS = new Set(['fecha', 'sueno', 'inicio', 'fin', 'pasos']);

class Refusal extends Error {}

function refuse(problem: string): never {
  throw new Refusal(problem);
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return refuse(`"${text}" trae caracteres que no se entienden.`);
  }
}

/** Sin tildes en las claves: "sueño" y "sueno" son la misma. */
function readQuery(raw: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of raw.split('&')) {
    if (part === '') continue;
    const at = part.indexOf('=');
    const key = plain(decode(at === -1 ? part : part.slice(0, at)));
    if (!KEYS.has(key)) {
      refuse(`El enlace trae "${key}", y solo se entienden fecha, sueno, inicio, fin y pasos.`);
    }
    values.set(key, decode(at === -1 ? '' : part.slice(at + 1)).trim());
  }
  return values;
}

function inRange(date: IsoDate, today: IsoDate): IsoDate {
  if (date > today) refuse(`El ${date} todavía no llega.`);
  if (date < addDays(today, -OLDEST_DAYS)) {
    refuse(`El ${date} es de hace más de una semana: revisa el formato de fecha del Atajo.`);
  }
  return date;
}

/**
 * La forma ISO 8601 antes de leerla: cada motor de JavaScript adivina distinto con lo
 * demas, y "9 oct 7:25" salia como el 9 de octubre de 2001.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function instant(raw: string | undefined, name: string, now: EpochMs): EpochMs | null {
  if (raw === undefined || raw === '') return null;
  // El desfase sin dos puntos (-0400) es ISO tambien, pero no todos los motores lo leen.
  const ms = ISO_INSTANT.test(raw) ? Date.parse(raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : NaN;
  if (!Number.isFinite(ms)) {
    refuse(
      `La hora de ${name} "${raw}" no se entiende: en el Atajo, Formatear fecha con ISO 8601.`,
    );
  }
  if (ms > now + CLOCK_SKEW_MS) refuse(`La hora de ${name} está en el futuro.`);
  return ms;
}

/**
 * Lo que dice un enlace del Atajo, o null si el enlace no es de Nexo: la app tambien
 * recibe el suyo propio al abrirse en el navegador, y eso no es un error de nadie.
 */
export function parseHealthLink(url: string, now: Date): HealthLink | null {
  const trimmed = url.trim();
  if (!/^nexo:/i.test(trimmed)) return null;
  try {
    const match = /^nexo:\/\/salud\/?(?:\?([^#]*))?(?:#.*)?$/i.exec(trimmed);
    if (!match) refuse('El enlace no es de importar salud: se esperaba nexo://salud?…');
    const query = readQuery(match[1] ?? '');
    if (!query.has('sueno') && !query.has('pasos')) refuse('El enlace no trae ni sueno ni pasos.');

    const today = todayIso(now);
    const fecha = query.get('fecha') ?? '';
    if (fecha !== '' && !isRealDate(fecha)) {
      refuse(
        `La fecha "${fecha}" no es AAAA-MM-DD: en el Atajo, formato personalizado yyyy-MM-dd.`,
      );
    }
    const date = fecha === '' ? today : inRange(fecha, today);
    const readings: HealthReading[] = [];

    const sueno = query.get('sueno');
    if (sueno !== undefined) {
      const hours = sueno === '' ? 0 : number(sueno);
      if (hours === null || hours < 0 || hours > MAX_SLEEP_HOURS) {
        refuse(`El sueño "${sueno}" no son horas: se esperaba algo como 7.75.`);
      }
      const startedAt = instant(query.get('inicio'), 'inicio', now.getTime());
      const endedAt = instant(query.get('fin'), 'fin', now.getTime());
      if (startedAt !== null && endedAt !== null) {
        if (startedAt >= endedAt)
          refuse('El sueño empieza después de terminar: revisa inicio y fin.');
        if (endedAt - startedAt > DAY_MS) refuse('Entre inicio y fin hay más de un día.');
      }
      const minutes = Math.round(hours * 60);
      readings.push({
        metric: 'sleep',
        source: 'autosleep',
        date: endedAt === null ? date : inRange(todayIso(new Date(endedAt)), today),
        value: minutes > 0 ? minutes : null,
        startedAt,
        endedAt,
      });
    }

    const pasos = query.get('pasos');
    if (pasos !== undefined) {
      // Con el separador de miles que ponga el idioma del telefono, espacios incluidos.
      const count = pasos === '' ? 0 : steps(pasos.replace(/[\s  ']/g, ''));
      if (count === null || count > MAX_STEPS) {
        refuse(`Los pasos "${pasos}" no son un número de pasos.`);
      }
      readings.push({
        metric: 'steps',
        source: 'apple_health',
        date,
        value: count > 0 ? count : null,
        startedAt: null,
        endedAt: null,
      });
    }

    return { ok: true, readings };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, problem: error.message };
    throw error;
  }
}

/**
 * Lo que paso con cada dato. `kept` no sale de aqui: es la respuesta de el a un choque,
 * cuando decide quedarse con lo que habia escrito.
 */
export type HealthOutcome = 'saved' | 'empty' | 'conflict' | 'kept';

export type HealthResult = {
  reading: HealthReading;
  outcome: HealthOutcome;
  /** Lo que tenia el dia antes de importar, para decirle que se pisa o que se quedo. */
  current: number | null;
};

function valueOf(log: CoreDailyLogRow | null, metric: HealthMetric): number | null {
  return (metric === 'sleep' ? log?.sleep_minutes : log?.steps) ?? null;
}

async function lastImport(
  db: SQLiteDatabase,
  date: IsoDate,
  metric: HealthMetric,
): Promise<CoreHealthImportRow | null> {
  return db.getFirstAsync<CoreHealthImportRow>(
    `SELECT * FROM core_health_import WHERE date = ? AND metric = ?
      ORDER BY imported_at DESC LIMIT 1;`,
    [date, metric],
  );
}

/**
 * Guarda lo que trajo el enlace en su dia, cada dato con su comprobante.
 *
 * Lo que habia puesto la importacion anterior se reemplaza sin preguntar: volver a importar
 * corrige, aunque baje, y los pasos de la manana se quedan cortos a proposito. Lo que el
 * escribio a mano no se pisa salvo con `replace`: queda como choque para que el decida. Un
 * dato que no llego no escribe nada. Todo junto o nada: el valor y su comprobante a la vez.
 */
export async function saveHealthReadings(
  db: SQLiteDatabase,
  readings: readonly HealthReading[],
  importedAt: EpochMs,
  replace = false,
): Promise<HealthResult[]> {
  const results: HealthResult[] = [];
  await inTransaction(db, async () => {
    for (const reading of readings) {
      const { date, metric, source, value } = reading;
      if (value === null) {
        results.push({ reading, outcome: 'empty', current: null });
        continue;
      }
      const current = valueOf(await readDailyLog(db, date), metric);
      const imported = (await lastImport(db, date, metric))?.value ?? null;
      if (!replace && current !== null && current !== imported && current !== value) {
        results.push({ reading, outcome: 'conflict', current });
        continue;
      }
      await db.runAsync(
        `INSERT INTO core_health_import
           (date, metric, source, value, started_at, ended_at, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (date, metric, source) DO UPDATE SET
           value = excluded.value,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           imported_at = excluded.imported_at;`,
        [date, metric, source, value, reading.startedAt, reading.endedAt, importedAt],
      );
      await upsertDailyLog(
        db,
        metric === 'sleep'
          ? { date, sleepMinutes: value, sleepSource: source }
          : { date, steps: value },
      );
      results.push({ reading, outcome: 'saved', current });
    }
  });
  return results;
}

export async function listHealthImports(
  db: SQLiteDatabase,
  date: IsoDate,
): Promise<CoreHealthImportRow[]> {
  return db.getAllAsync<CoreHealthImportRow>(
    'SELECT * FROM core_health_import WHERE date = ? ORDER BY imported_at DESC;',
    [date],
  );
}

export type HealthOrigin =
  { kind: 'imported'; source: HealthSource; importedAt: EpochMs } | { kind: 'manual' };

/**
 * De donde salio el dato que tiene el dia: de la ultima importacion si es justo lo que
 * mando, y si no, de su mano. Null cuando el dia no tiene ese dato.
 */
export function originOf(
  log: CoreDailyLogRow | null,
  imports: readonly CoreHealthImportRow[],
  metric: HealthMetric,
): HealthOrigin | null {
  const value = valueOf(log, metric);
  if (value === null) return null;
  const last = imports
    .filter((row) => row.date === log?.date && row.metric === metric)
    .reduce<CoreHealthImportRow | null>(
      (latest, row) => (latest === null || row.imported_at > latest.imported_at ? row : latest),
      null,
    );
  return last !== null && last.value === value
    ? { kind: 'imported', source: last.source, importedAt: last.imported_at }
    : { kind: 'manual' };
}
