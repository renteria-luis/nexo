// The eight criteria of spec 4.1, the alcohol scale of 4.2 and the missed training
// penalty of 4.3, built on the generic engine in scoring.ts.

import {
  dayScore,
  towardsTarget,
  withinBand,
  type DayScore,
  type ScoredCriterion,
} from './scoring.ts';
import { kcalBand, proteinBand, type TargetValues } from './targets.ts';

/** Spec 4.1. Weights are the evidence base, not preference, and they sum to 100. */
export const CRITERION_WEIGHTS = {
  trained: 22,
  sleep: 20,
  protein: 16,
  calories: 10,
  alcohol: 10,
  water: 8,
  steps: 8,
  creatine: 6,
} as const;

export type CriterionId = keyof typeof CRITERION_WEIGHTS;

/** Spec 3.5: zero below six hours, a straight line up to the target. */
const SLEEP_PARTIAL_FLOOR_MINUTES = 360;
/** Spec 3.4: partial from three quarters of the day's water target. */
const WATER_PARTIAL_SHARE = 0.75;
/** Spec 14.2: partial from seventy percent of the step target. */
const STEPS_PARTIAL_SHARE = 0.7;

/** Spec 4.2, points lost out of the ten the criterion is worth. */
function drinkScalePointsLost(drinks: number): number {
  if (drinks <= 0) return 0;
  if (drinks <= 2) return 2;
  if (drinks <= 4) return 5;
  if (drinks <= 7) return 8;
  return 10;
}

/**
 * Spec 4.2. Drinking inside the six hours after a session costs half again as much,
 * because that is the window the Parr data actually speaks to. Capped at the ten
 * points the criterion is worth.
 */
export function alcoholPointsLost(drinks: number, withinSixHoursAfterTraining: boolean): number {
  if (drinks < 0) throw new Error(`a day cannot have ${drinks} drinks`);
  const base = drinkScalePointsLost(drinks);
  const scaled = withinSixHoursAfterTraining ? base * 1.5 : base;
  return Math.min(CRITERION_WEIGHTS.alcohol, scaled);
}

/** Spec 4.3. Five sessions a week, rolling, not pinned to weekdays. */
export const WEEKLY_SESSION_TARGET = 5;

export function trainingDebt(sessionsLastSevenDays: number): number {
  return WEEKLY_SESSION_TARGET - sessionsLastSevenDays;
}

/** Debt means today is a scheduled day. No debt means today is optional either way. */
export function isScheduledToday(sessionsLastSevenDays: number): boolean {
  return trainingDebt(sessionsLastSevenDays) > 0;
}

const PENALTY_BY_CONSECUTIVE_MISSES = [0, -8, -18, -30, -45, -60];

/**
 * Spec 4.3, applied against the day score rather than merely forfeited. The
 * escalation is behavioural, from Lally 2010: one miss is noise, a run of them is
 * not. It does not level off after five, it repeats at sixty.
 */
export function missedTrainingPenalty(consecutiveMissed: number): number {
  if (!Number.isInteger(consecutiveMissed) || consecutiveMissed < 0) {
    throw new Error(`a run of missed days cannot be ${consecutiveMissed}`);
  }
  const capped = Math.min(consecutiveMissed, PENALTY_BY_CONSECUTIVE_MISSES.length - 1);
  return PENALTY_BY_CONSECUTIVE_MISSES[capped];
}

export type DisciplineDay = {
  /** Null until the day is over or a session is logged. */
  trained: boolean | null;
  sleepMinutes: number | null;
  proteinG: number | null;
  kcal: number | null;
  alcoholDrinks: number | null;
  /** Spec 4.2, only meaningful when there were drinks and a session that day. */
  alcoholWithinSixHoursAfterTraining: boolean;
  waterMl: number | null;
  steps: number | null;
  creatineTaken: boolean | null;
  /** Drives which water target applies, 2.8 L or 3.5 L. */
  isTrainingDay: boolean;
};

export type TrainingContext = {
  sessionsLastSevenDays: number;
  consecutiveMissed: number;
  /** Spec 4.3: a planned rest day is scored on everything else and penalised on nothing. */
  isScheduledRestDay: boolean;
  /** Spec 6.5: while readapting, the miss penalty is not applied. */
  reEntryActive: boolean;
};

function binary(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

export function scoreCriteria(day: DisciplineDay, targets: TargetValues): ScoredCriterion[] {
  const protein = proteinBand(targets);
  const water = day.isTrainingDay ? targets.waterMlTraining : targets.waterMlRest;

  return [
    { id: 'trained', weight: CRITERION_WEIGHTS.trained, fraction: binary(day.trained) },
    {
      id: 'sleep',
      weight: CRITERION_WEIGHTS.sleep,
      fraction:
        day.sleepMinutes === null
          ? null
          : towardsTarget(day.sleepMinutes, targets.sleepMinutes, SLEEP_PARTIAL_FLOOR_MINUTES),
    },
    {
      id: 'protein',
      weight: CRITERION_WEIGHTS.protein,
      // Spec 4.1 scores protein as in band or not; there is no partial shoulder.
      fraction:
        day.proteinG === null
          ? null
          : day.proteinG >= protein.from && day.proteinG <= protein.to
            ? 1
            : 0,
    },
    {
      id: 'calories',
      weight: CRITERION_WEIGHTS.calories,
      fraction: day.kcal === null ? null : withinBand(day.kcal, kcalBand(targets)),
    },
    {
      id: 'alcohol',
      weight: CRITERION_WEIGHTS.alcohol,
      fraction:
        day.alcoholDrinks === null
          ? null
          : 1 -
            alcoholPointsLost(day.alcoholDrinks, day.alcoholWithinSixHoursAfterTraining) /
              CRITERION_WEIGHTS.alcohol,
    },
    {
      id: 'water',
      weight: CRITERION_WEIGHTS.water,
      fraction:
        day.waterMl === null
          ? null
          : towardsTarget(day.waterMl, water, water * WATER_PARTIAL_SHARE),
    },
    {
      id: 'steps',
      weight: CRITERION_WEIGHTS.steps,
      fraction:
        day.steps === null
          ? null
          : towardsTarget(day.steps, targets.steps, targets.steps * STEPS_PARTIAL_SHARE),
    },
    { id: 'creatine', weight: CRITERION_WEIGHTS.creatine, fraction: binary(day.creatineTaken) },
  ];
}

export type DisciplineResult = DayScore & {
  criteria: ScoredCriterion[];
  /** True when the day counted as scheduled and no session was logged. */
  missedScheduledSession: boolean;
};

export function scoreDay(
  day: DisciplineDay,
  targets: TargetValues,
  training: TrainingContext,
): DisciplineResult {
  const criteria = scoreCriteria(day, targets);

  const missedScheduledSession =
    day.trained === false &&
    !training.isScheduledRestDay &&
    isScheduledToday(training.sessionsLastSevenDays);

  const penalty =
    missedScheduledSession && !training.reEntryActive
      ? missedTrainingPenalty(training.consecutiveMissed + 1)
      : 0;

  return { ...dayScore(criteria, penalty), criteria, missedScheduledSession };
}

/** Spec 4.3: the run resets on the first completed session. */
export function advanceConsecutiveMissed(current: number, result: DisciplineResult): number {
  if (result.missedScheduledSession) return current + 1;
  return 0;
}

/** Spec 4.4: a day counts towards the streak at seventy or better. */
export const STREAK_THRESHOLD = 70;

export function currentStreak(scores: readonly (number | null)[]): number {
  let streak = 0;
  for (let i = scores.length - 1; i >= 0; i -= 1) {
    const score = scores[i];
    if (score === null || score < STREAK_THRESHOLD) break;
    streak += 1;
  }
  return streak;
}

export function longestStreak(scores: readonly (number | null)[]): number {
  let longest = 0;
  let run = 0;
  for (const score of scores) {
    if (score !== null && score >= STREAK_THRESHOLD) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return longest;
}
