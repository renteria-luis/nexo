// Spec 5.10. Targets drift as body weight does, so a day in the past has to be
// judged against the targets that were in force that day and never against today's.
// That is what makes an old score still mean what it meant when it was earned.

import type { SQLiteDatabase } from 'expo-sqlite';

import type { CoreTargetSnapshotRow } from '../db/types.ts';

import type { IsoDate } from './dates.ts';
import {
  computeTargets,
  needsRecalculation,
  rollingWeightAverage,
  type TargetProfile,
  type TargetValues,
  type WeighIn,
} from './targets.ts';

export function snapshotToTargets(row: CoreTargetSnapshotRow): TargetValues {
  return {
    weightBasisKg: row.weight_basis_kg,
    kcal: row.kcal,
    proteinG: row.protein_g,
    fatG: row.fat_g,
    carbsG: row.carbs_g,
    waterMlRest: row.water_ml_rest,
    waterMlTraining: row.water_ml_training,
    sleepMinutes: row.sleep_minutes,
    steps: row.steps,
  };
}

/** The snapshot that was in force on a day: the latest one that had already started. */
export async function targetsInForceOn(
  db: SQLiteDatabase,
  date: IsoDate,
): Promise<TargetValues | null> {
  const row = await db.getFirstAsync<CoreTargetSnapshotRow>(
    `SELECT * FROM core_target_snapshot
      WHERE effective_from <= ?
   ORDER BY effective_from DESC
      LIMIT 1;`,
    [date],
  );
  return row ? snapshotToTargets(row) : null;
}

/** El primer dia del que hay algo anotado, mirando donde puede haber quedado rastro. */
async function firstLoggedDate(db: SQLiteDatabase): Promise<IsoDate | null> {
  const row = await db.getFirstAsync<{ date: IsoDate | null }>(
    `SELECT min(date) AS date FROM (
       SELECT min(date) AS date FROM core_daily_log
       UNION ALL SELECT min(date) FROM training_session
       UNION ALL SELECT min(date) FROM nutrition_food_entry
     );`,
  );
  return row?.date ?? null;
}

export async function writeTargetSnapshot(
  db: SQLiteDatabase,
  targets: TargetValues,
  effectiveFrom: IsoDate,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO core_target_snapshot
       (id, effective_from, weight_basis_kg, kcal, protein_g, fat_g, carbs_g,
        water_ml_rest, water_ml_training, sleep_minutes, steps)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (effective_from) DO UPDATE SET
       weight_basis_kg = excluded.weight_basis_kg,
       kcal = excluded.kcal,
       protein_g = excluded.protein_g,
       fat_g = excluded.fat_g,
       carbs_g = excluded.carbs_g,
       water_ml_rest = excluded.water_ml_rest,
       water_ml_training = excluded.water_ml_training,
       sleep_minutes = excluded.sleep_minutes,
       steps = excluded.steps;`,
    [
      `snapshot-${effectiveFrom}`,
      effectiveFrom,
      targets.weightBasisKg,
      targets.kcal,
      targets.proteinG,
      targets.fatG,
      targets.carbsG,
      targets.waterMlRest,
      targets.waterMlTraining,
      targets.sleepMinutes,
      targets.steps,
    ],
  );
}

/**
 * The first snapshot, computed from a weight he types in rather than from a rolling
 * average. Spec 1.1 wants four weigh-ins before a trend means anything, but that
 * rule is about detecting drift; the opening targets have to come from somewhere,
 * and spec 3.1 works them out from a single current weight. Does nothing once a
 * snapshot exists, so drift stays the job of recalculateTargets.
 */
export async function setInitialTargets(
  db: SQLiteDatabase,
  weightKg: number,
  profile: TargetProfile,
  onDate: IsoDate,
): Promise<TargetValues | null> {
  if (await targetsInForceOn(db, onDate)) return null;

  const targets = computeTargets(weightKg, profile, onDate);

  // Empieza el dia del primer registro y no hoy. Casi siempre se llena el perfil
  // despues de haber estado anotando unos dias, y con la foto empezando hoy esos
  // dias se quedaban sin nada contra que medirse, o sea grises para siempre por
  // mucho que hubiera anotado. Estas son las unicas metas que ha tenido nunca, asi
  // que son tambien las suyas de esos dias: spec 5.10 sigue cumpliendose, porque lo
  // que prohibe es juzgar un dia con metas posteriores a las que regian, y aqui no
  // habia ninguna anterior.
  const first = await firstLoggedDate(db);
  await writeTargetSnapshot(db, targets, first !== null && first < onDate ? first : onDate);
  return targets;
}

export type TargetChange = {
  /** Null on the very first snapshot, when there is nothing to compare against. */
  from: TargetValues | null;
  to: TargetValues;
  effectiveFrom: IsoDate;
};

/**
 * Spec 3.6. Recalculates only when the seven day rolling average has moved a kilo
 * from the weight the current targets were built on, and returns what changed so
 * the Today screen can say so out loud. Null means nothing moved and nothing was
 * written: recalculation is visible, never silent.
 */
export async function recalculateTargets(
  db: SQLiteDatabase,
  weighIns: readonly WeighIn[],
  profile: TargetProfile,
  onDate: IsoDate,
): Promise<TargetChange | null> {
  const rolling = rollingWeightAverage(weighIns, onDate);
  if (rolling === null) return null;

  const current = await targetsInForceOn(db, onDate);
  if (current && !needsRecalculation(current.weightBasisKg, rolling)) return null;

  const next = computeTargets(rolling, profile, onDate);
  await writeTargetSnapshot(db, next, onDate);

  return { from: current, to: next, effectiveFrom: onDate };
}

/**
 * Spec 3.6 wants the change on Today until he has seen it. Every write refreshes the
 * app, and recalculateTargets only reports a change on the load that wrote it, so the
 * card reads the change back from the two newest snapshots instead. The very first
 * snapshot is not a change and returns null.
 */
export async function latestTargetChange(db: SQLiteDatabase): Promise<TargetChange | null> {
  const rows = await db.getAllAsync<CoreTargetSnapshotRow>(
    'SELECT * FROM core_target_snapshot ORDER BY effective_from DESC LIMIT 2;',
  );
  if (rows.length < 2) return null;
  return {
    from: snapshotToTargets(rows[1]),
    to: snapshotToTargets(rows[0]),
    effectiveFrom: rows[0].effective_from,
  };
}
