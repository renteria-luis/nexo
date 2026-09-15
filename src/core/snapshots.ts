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
  await writeTargetSnapshot(db, targets, onDate);
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
