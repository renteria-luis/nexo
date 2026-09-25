// Spec 3. Deterministic rules over the owner's own data; spec 11.2 keeps all of
// this out of a model.
//
// Nothing personal is hardcoded here. Height, birth date, activity factor and
// phase are inputs, because this repository is public and the spec that holds
// those figures deliberately is not.

import type { IsoDate } from './dates.ts';
import type { Band } from './scoring.ts';
import { daysBetween, trailingDays } from './dates.ts';

export type Phase = 'recomp' | 'cut' | 'maintain' | 'bulk';

/** Spec 3.6. Editable in settings. */
export const PHASE_MULTIPLIER: Record<Phase, number> = {
  recomp: 0.92,
  cut: 0.8,
  maintain: 1.0,
  bulk: 1.1,
};

export type TargetProfile = {
  heightCm: number;
  birthDate: IsoDate;
  /** Spec 3.1. Desk job plus five resistance sessions a week sits at 1.55 to 1.60. */
  activityFactor: number;
  phase: Phase;
  /** Spec 3.5. The bottom of the healthy range, not an aspirational figure. */
  sleepMinutes: number;
  /** Spec 14.2. Raised in stages, not set to a number that fails by default. */
  steps: number;
};

/** What a TargetSnapshot stores, and everything the bands and the grid need. */
export type TargetValues = {
  weightBasisKg: number;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  waterMlRest: number;
  waterMlTraining: number;
  sleepMinutes: number;
  steps: number;
};

/** A fresh calculation, which also carries the two intermediate figures. */
export type Targets = TargetValues & {
  bmr: number;
  tdee: number;
};

/** Whole years completed on the given day. Spec 3.6: age rolls over on the birthday. */
export function ageOn(birthDate: IsoDate, onDate: IsoDate): number {
  const elapsed = daysBetween(birthDate, onDate);
  if (elapsed < 0) throw new Error(`${onDate} is before the birth date ${birthDate}`);

  const [birthYear, birthMonthDay] = splitYear(birthDate);
  const [onYear, onMonthDay] = splitYear(onDate);
  const hadBirthday = onMonthDay >= birthMonthDay;
  return onYear - birthYear - (hadBirthday ? 0 : 1);
}

function splitYear(date: IsoDate): [number, string] {
  return [Number(date.slice(0, 4)), date.slice(5)];
}

const WATER_ML_REST = 2800;
const WATER_ML_TRAINING_EXTRA = 700;

/** Spec 3.6, in the order the spec writes it. */
export function computeTargets(
  weightBasisKg: number,
  profile: TargetProfile,
  onDate: IsoDate,
): Targets {
  if (!Number.isFinite(weightBasisKg) || weightBasisKg <= 0) {
    throw new Error(`a body weight of ${weightBasisKg} kg is not a number to compute from`);
  }

  const age = ageOn(profile.birthDate, onDate);
  const bmr = 10 * weightBasisKg + 6.25 * profile.heightCm - 5 * age + 5;
  const tdee = bmr * profile.activityFactor;
  const kcal = tdee * PHASE_MULTIPLIER[profile.phase];
  const proteinG = weightBasisKg * 2.0;
  const fatG = (kcal * 0.28) / 9;
  const carbsG = (kcal - proteinG * 4 - fatG * 9) / 4;

  return {
    weightBasisKg,
    bmr,
    tdee,
    kcal: Math.round(kcal),
    proteinG: Math.round(proteinG),
    fatG: Math.round(fatG),
    carbsG: Math.round(carbsG),
    waterMlRest: WATER_ML_REST,
    waterMlTraining: WATER_ML_REST + WATER_ML_TRAINING_EXTRA,
    sleepMinutes: profile.sleepMinutes,
    steps: profile.steps,
  };
}

// Spec 3.2 quotes 2,250 to 2,550 full and 2,100 to 2,700 partial against a 2,400
// target, which is the target plus or minus 150 and plus or minus 300. Expressed
// as offsets so the band follows the target when spec 3.6 recomputes it.
const KCAL_FULL_MARGIN = 150;
const KCAL_PARTIAL_MARGIN = 300;

export function kcalBand(targets: TargetValues): Band {
  return {
    fullFrom: targets.kcal - KCAL_FULL_MARGIN,
    fullTo: targets.kcal + KCAL_FULL_MARGIN,
    partialFrom: targets.kcal - KCAL_PARTIAL_MARGIN,
    partialTo: targets.kcal + KCAL_PARTIAL_MARGIN,
  };
}

/**
 * Spec 3.6: weight times 1.8 to weight times 2.2. Bounds are floored, which is
 * what produces the 133 to 163 in the spec 3.6 worked example at 74.2 kg.
 */
export function proteinBand(targets: TargetValues): { from: number; to: number } {
  return {
    from: Math.floor(targets.weightBasisKg * 1.8),
    to: Math.floor(targets.weightBasisKg * 2.2),
  };
}

/**
 * Spec 4.1. La proteina se pondera en vez de ser todo o nada: 123 g contra una banda
 * de 131 a 160 perdia los 16 puntos enteros por ocho gramos, y eso no es lo que dice
 * la evidencia. Dentro de la banda vale todo, porque la banda es la evidencia (Morton
 * 2018, 1.6 a 2.2 g/kg, y spec 3.6 la pone en 1.8 a 2.2). Por debajo baja en linea
 * hasta cero en 1.2 g/kg, que es donde la respuesta ya esta claramente comprometida;
 * por encima, hasta 3.0 g/kg, donde empieza a quitarle sitio a los otros macros.
 */
export function proteinScoringBand(targets: TargetValues): Band {
  const band = proteinBand(targets);
  return {
    fullFrom: band.from,
    fullTo: band.to,
    partialFrom: Math.floor(targets.weightBasisKg * 1.2),
    partialTo: Math.ceil(targets.weightBasisKg * 3),
  };
}

/**
 * Spec 3.3: 25% to 33% of energy, with a hard floor of 0.8 g per kg. Below roughly
 * 20% of calories is where the testosterone decline in Whittaker and Wu appears,
 * so the floor wins when it is the higher of the two.
 */
export function fatBand(targets: TargetValues): {
  from: number;
  to: number;
  hardFloor: number;
} {
  const hardFloor = Math.round(targets.weightBasisKg * 0.8);
  const fromEnergy = Math.floor((targets.kcal * 0.25) / 9);
  return {
    from: Math.max(fromEnergy, hardFloor),
    to: Math.floor((targets.kcal * 0.33) / 9),
    hardFloor,
  };
}

export type WeighIn = {
  date: IsoDate;
  weightKg: number | null;
};

/**
 * Spec 1.1. A 5 kg same-day range is water and gut content, so the rolling average
 * is the number that means something. Null below four weigh-ins in the window,
 * which is the spec's own threshold for drawing a trend at all.
 */
export function rollingWeightAverage(
  weighIns: readonly WeighIn[],
  onDate: IsoDate,
  windowDays = 7,
  minimumWeighIns = 4,
): number | null {
  const window = trailingDays(onDate, windowDays);
  const inWindow = weighIns.filter(
    (entry) =>
      entry.weightKg !== null &&
      daysBetween(window.from, entry.date) >= 0 &&
      daysBetween(entry.date, window.to) >= 0,
  );

  if (inWindow.length < minimumWeighIns) return null;

  const total = inWindow.reduce((sum, entry) => sum + (entry.weightKg as number), 0);
  return total / inWindow.length;
}

/** Spec 3.6 trigger: the rolling average has moved a kilo from what the targets were built on. */
export const RECALCULATION_THRESHOLD_KG = 1.0;

export function needsRecalculation(
  currentBasisKg: number,
  rollingAverageKg: number | null,
): boolean {
  if (rollingAverageKg === null) return false;
  return Math.abs(rollingAverageKg - currentBasisKg) >= RECALCULATION_THRESHOLD_KG;
}
