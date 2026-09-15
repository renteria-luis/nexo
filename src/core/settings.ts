// Typed reading and writing over the key and value table.
//
// Defaults live here rather than in the table, so changing one never needs a
// migration. Two settings deliberately have no default: height and birth date are
// the owner's own figures, and guessing them would put wrong numbers into the BMR
// instead of asking. The profile simply does not exist until he enters them.

import type { SQLiteDatabase } from 'expo-sqlite';

import type { IsoDate } from './dates.ts';
import type { PaletteId } from './palettes.ts';
import type { WeightUnit } from './units.ts';
import type { Phase, TargetProfile } from './targets.ts';

export type SettingKey =
  | 'palette'
  | 'height_cm'
  | 'birth_date'
  | 'activity_factor'
  | 'phase'
  | 'sleep_target_minutes'
  | 'steps_target'
  | 'treat_missing_sleep_as_zero'
  | 're_entry_started_on'
  | 're_entry_weeks'
  | 'weight_unit';

export type Settings = ReadonlyMap<string, string>;

/** Spec 3.1, 3.5, 4.5, 6.5 and 14.2. Nothing personal, only the shipped starting points. */
const DEFAULTS: Partial<Record<SettingKey, string>> = {
  palette: 'deutan',
  // Spec 3.1 puts the range at 1.55 to 1.60 and works from a maintenance figure of
  // 2,600 kcal, which is what 1.58 gives. Editable, as spec 3.6 requires.
  activity_factor: '1.58',
  phase: 'recomp',
  sleep_target_minutes: '420',
  steps_target: '7000',
  treat_missing_sleep_as_zero: 'false',
  re_entry_weeks: '3',
  // His main gym is imperial. Storage stays metric either way.
  weight_unit: 'lb',
};

export async function readSettings(db: SQLiteDatabase): Promise<Settings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM core_setting;',
  );
  return new Map(rows.map((row) => [row.key, row.value]));
}

export async function writeSetting(
  db: SQLiteDatabase,
  key: SettingKey,
  value: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO core_setting (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value;`,
    [key, value],
  );
}

export async function clearSetting(db: SQLiteDatabase, key: SettingKey): Promise<void> {
  await db.runAsync('DELETE FROM core_setting WHERE key = ?;', [key]);
}

function raw(settings: Settings, key: SettingKey): string | null {
  return settings.get(key) ?? DEFAULTS[key] ?? null;
}

function asNumber(settings: Settings, key: SettingKey): number | null {
  const value = raw(settings, key);
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new Error(`setting ${key} holds ${value}, which is not a number`);
  return parsed;
}

const PALETTES = new Set<string>(['deutan', 'standard', 'tritan']);
const PHASES = new Set<string>(['recomp', 'cut', 'maintain', 'bulk']);
const WEIGHT_UNITS = new Set<string>(['lb', 'kg']);

export function paletteFrom(settings: Settings): PaletteId {
  const value = raw(settings, 'palette');
  if (value === null || !PALETTES.has(value)) {
    throw new Error(`setting palette holds ${value}, which is not one of the three palettes`);
  }
  return value as PaletteId;
}

export function weightUnitFrom(settings: Settings): WeightUnit {
  const value = raw(settings, 'weight_unit');
  if (value === null || !WEIGHT_UNITS.has(value)) {
    throw new Error(`setting weight_unit holds ${value}, which is not lb or kg`);
  }
  return value as WeightUnit;
}

export function treatMissingSleepAsZero(settings: Settings): boolean {
  return raw(settings, 'treat_missing_sleep_as_zero') === 'true';
}

/**
 * Null until height and birth date are entered. Everything downstream of the BMR
 * depends on them, so an absent profile has to stop the calculation rather than
 * quietly run on a placeholder.
 */
export function profileFrom(settings: Settings): TargetProfile | null {
  const heightCm = asNumber(settings, 'height_cm');
  const birthDate = raw(settings, 'birth_date');
  if (heightCm === null || birthDate === null) return null;

  const phase = raw(settings, 'phase');
  if (phase === null || !PHASES.has(phase)) {
    throw new Error(`setting phase holds ${phase}, which is not a phase`);
  }

  return {
    heightCm,
    birthDate,
    activityFactor: asNumber(settings, 'activity_factor') as number,
    phase: phase as Phase,
    sleepMinutes: asNumber(settings, 'sleep_target_minutes') as number,
    steps: asNumber(settings, 'steps_target') as number,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks a value before it is stored, so a typo is refused at the form rather than
 * discovered later by a reader that throws. Null means the value is fine.
 */
export function settingProblem(key: SettingKey, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return 'no puede quedar vacío';

  switch (key) {
    case 'palette':
      return PALETTES.has(trimmed) ? null : 'no es una de las tres paletas';
    case 'weight_unit':
      return WEIGHT_UNITS.has(trimmed) ? null : 'solo lb o kg';
    case 'phase':
      return PHASES.has(trimmed) ? null : 'no es una fase válida';
    case 'birth_date':
    case 're_entry_started_on':
      return ISO_DATE.test(trimmed) ? null : 'usa el formato AAAA-MM-DD';
    case 'treat_missing_sleep_as_zero':
      return trimmed === 'true' || trimmed === 'false' ? null : 'solo true o false';
    case 'height_cm':
      return inRange(trimmed, 100, 250, 'una estatura en centímetros');
    case 'activity_factor':
      return inRange(trimmed, 1.0, 2.5, 'un factor entre 1.0 y 2.5');
    case 'sleep_target_minutes':
      return inRange(trimmed, 240, 720, 'minutos de sueño entre 240 y 720');
    case 'steps_target':
      return inRange(trimmed, 1000, 40000, 'una meta de pasos entre 1000 y 40000');
    case 're_entry_weeks':
      return inRange(trimmed, 1, 12, 'semanas entre 1 y 12');
  }
}

function inRange(value: string, low: number, high: number, expected: string): string | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return `se esperaba ${expected}`;
  if (parsed < low || parsed > high) return `se esperaba ${expected}`;
  return null;
}

export type ReEntryState = {
  /** Null when re-entry has never been started. */
  startedOn: IsoDate | null;
  weeks: number;
};

export function reEntryFrom(settings: Settings): ReEntryState {
  return {
    startedOn: raw(settings, 're_entry_started_on'),
    weeks: asNumber(settings, 're_entry_weeks') as number,
  };
}
