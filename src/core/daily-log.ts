// Reading and writing the one row a day gets, and turning it into something the
// discipline grid can score.

import type { SQLiteDatabase } from 'expo-sqlite';

import type { CoreDailyLogRow, SleepSource, SqlBool } from '../db/types.ts';

import type { DateRange, IsoDate } from './dates.ts';
import type { DisciplineDay } from './discipline.ts';

export type DailyLogEntry = {
  date: IsoDate;
  waterMl?: number | null;
  creatineTaken?: boolean | null;
  alcoholDrinks?: number | null;
  alcoholAfterTraining?: boolean | null;
  cannabis?: boolean | null;
  sleepMinutes?: number | null;
  sleepSource?: SleepSource | null;
  restingHr?: number | null;
  hrvMs?: number | null;
  steps?: number | null;
  weightKg?: number | null;
};

function toSqlBool(value: boolean | null | undefined): SqlBool | null {
  if (value === null || value === undefined) return null;
  return value ? 1 : 0;
}

const MEASURED_FIELDS = [
  'water_ml',
  'creatine_taken',
  'alcohol_drinks',
  'cannabis',
  'sleep_minutes',
  'resting_hr',
  'hrv_ms',
  'steps',
  'weight_kg',
] as const;

/**
 * Sueno escrito como el lo dice: "7.5" en horas o "130" en minutos, o las dos casillas
 * a la vez. Devuelve null cuando no hay nada util que guardar, porque un cero aqui
 * significaria que no durmio.
 */
export function sleepMinutesFrom(hours: string, minutes: string): number | null {
  const h = hours.trim() === '' ? 0 : Number(hours.trim().replace(',', '.'));
  const m = minutes.trim() === '' ? 0 : Number(minutes.trim().replace(',', '.'));
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) return null;

  const total = Math.round(h * 60 + m);
  return total > 0 ? total : null;
}

/**
 * Writes the day, merging into whatever is already there so logging water in the
 * morning does not wipe the weight logged at breakfast. `has_data` is derived
 * rather than passed in, because a caller that gets it wrong makes a day silently
 * disappear from the grid.
 */
export async function upsertDailyLog(db: SQLiteDatabase, entry: DailyLogEntry): Promise<void> {
  await db.runAsync(
    `INSERT INTO core_daily_log
       (date, water_ml, creatine_taken, alcohol_drinks, alcohol_after_training, cannabis,
        sleep_minutes, sleep_source, resting_hr, hrv_ms, steps, weight_kg, has_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT (date) DO UPDATE SET
       water_ml       = coalesce(excluded.water_ml, water_ml),
       creatine_taken = coalesce(excluded.creatine_taken, creatine_taken),
       alcohol_drinks = coalesce(excluded.alcohol_drinks, alcohol_drinks),
       alcohol_after_training = coalesce(excluded.alcohol_after_training, alcohol_after_training),
       cannabis       = coalesce(excluded.cannabis, cannabis),
       sleep_minutes  = coalesce(excluded.sleep_minutes, sleep_minutes),
       sleep_source   = coalesce(excluded.sleep_source, sleep_source),
       resting_hr     = coalesce(excluded.resting_hr, resting_hr),
       hrv_ms         = coalesce(excluded.hrv_ms, hrv_ms),
       steps          = coalesce(excluded.steps, steps),
       weight_kg      = coalesce(excluded.weight_kg, weight_kg);`,
    [
      entry.date,
      entry.waterMl ?? null,
      toSqlBool(entry.creatineTaken),
      entry.alcoholDrinks ?? null,
      toSqlBool(entry.alcoholAfterTraining),
      toSqlBool(entry.cannabis),
      entry.sleepMinutes ?? null,
      entry.sleepSource ?? null,
      entry.restingHr ?? null,
      entry.hrvMs ?? null,
      entry.steps ?? null,
      entry.weightKg ?? null,
    ],
  );

  await db.runAsync(
    `UPDATE core_daily_log
        SET has_data = CASE WHEN ${MEASURED_FIELDS.map((f) => `${f} IS NOT NULL`).join(' OR ')}
                       THEN 1 ELSE 0 END
      WHERE date = ?;`,
    [entry.date],
  );
}

export async function readDailyLog(
  db: SQLiteDatabase,
  date: IsoDate,
): Promise<CoreDailyLogRow | null> {
  return db.getFirstAsync<CoreDailyLogRow>('SELECT * FROM core_daily_log WHERE date = ?;', [date]);
}

export async function listDailyLogs(
  db: SQLiteDatabase,
  range: DateRange,
): Promise<CoreDailyLogRow[]> {
  return db.getAllAsync<CoreDailyLogRow>(
    'SELECT * FROM core_daily_log WHERE date BETWEEN ? AND ? ORDER BY date;',
    [range.from, range.to],
  );
}

/** Spec 6.6: the score lives beside the day it belongs to, not recomputed on every read. */
export async function storeScore(
  db: SQLiteDatabase,
  date: IsoDate,
  score: number | null,
): Promise<void> {
  await db.runAsync('UPDATE core_daily_log SET score = ? WHERE date = ?;', [
    score === null ? null : Math.round(score),
    date,
  ]);
}

function fromSqlBool(value: SqlBool | null): boolean | null {
  return value === null ? null : value === 1;
}

export type DayFacts = {
  /** Null while the day is still open and no session has been logged. */
  trained: boolean | null;
  proteinG: number | null;
  kcal: number | null;
  isTrainingDay: boolean;
};

/**
 * Joins the stored row to the things that live elsewhere: what was eaten, and
 * whether a session happened. Those come from the Nutrition and Training modules
 * through their own read interfaces, never by reaching into their tables here.
 */
export function toDisciplineDay(log: CoreDailyLogRow | null, facts: DayFacts): DisciplineDay {
  return {
    trained: facts.trained,
    sleepMinutes: log?.sleep_minutes ?? null,
    proteinG: facts.proteinG,
    kcal: facts.kcal,
    alcoholDrinks: log?.alcohol_drinks ?? null,
    alcoholWithinSixHoursAfterTraining: log?.alcohol_after_training === 1,
    waterMl: log?.water_ml ?? null,
    steps: log?.steps ?? null,
    creatineTaken: fromSqlBool(log?.creatine_taken ?? null),
    isTrainingDay: facts.isTrainingDay,
  };
}

/** Spec 1.1: the weigh-ins the rolling average runs on. */
export function toWeighIns(logs: readonly CoreDailyLogRow[]) {
  return logs.map((log) => ({ date: log.date, weightKg: log.weight_kg }));
}
