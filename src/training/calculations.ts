// Spec 6.1 to 6.3. Deterministic rules over the owner's own data: spec 11.2 is
// explicit that none of this goes through a model.
//
// Every formula has exactly one definition here. Aggregation happens in
// TypeScript rather than SQL for the same reason: one user's training history is
// small, and one copy of a formula cannot disagree with another.

import type { IsoDate } from '../core/dates.ts';

/** A working set, already joined to the day its session happened on. */
export type LoggedSet = {
  sessionId: string;
  date: IsoDate;
  exerciseId: string;
  setIndex: number;
  weightKg: number;
  reps: number;
  /** Spec 9: seconds since the previous set, measured, not timed by hand. */
  restBeforeSeconds?: number | null;
  /** When the set was recorded, epoch milliseconds. */
  timestamp?: number;
};

/** How much one set of an exercise counts towards a muscle: 1.0 primary, 0.5 secondary. */
export type MuscleShare = {
  muscle: string;
  contribution: number;
};

/** exercise id to the muscles it trains. */
export type ExerciseMuscles = ReadonlyMap<string, readonly MuscleShare[]>;

/**
 * Epley, spec 6.2. Null above 12 reps, where the formula degrades and volume
 * load is the honest comparison instead.
 */
export function epleyE1rm(weightKg: number, reps: number): number | null {
  if (!Number.isFinite(weightKg) || weightKg < 0) {
    throw new Error(`a set cannot weigh ${weightKg} kg`);
  }
  if (!Number.isInteger(reps) || reps < 1) {
    throw new Error(`a set cannot have ${reps} reps`);
  }
  if (reps > 12) return null;
  return weightKg * (1 + reps / 30);
}

/** Spec 6.1, the sum of weight times reps. */
export function volumeLoad(sets: readonly LoggedSet[]): number {
  return sets.reduce((total, set) => total + set.weightKg * set.reps, 0);
}

function groupSum<T>(
  items: readonly T[],
  key: (item: T) => string,
  value: (item: T) => number,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    totals.set(k, (totals.get(k) ?? 0) + value(item));
  }
  return totals;
}

export function volumeLoadByExercise(sets: readonly LoggedSet[]): Map<string, number> {
  return groupSum(
    sets,
    (set) => set.exerciseId,
    (set) => set.weightKg * set.reps,
  );
}

export function volumeLoadBySession(sets: readonly LoggedSet[]): Map<string, number> {
  return groupSum(
    sets,
    (set) => set.sessionId,
    (set) => set.weightKg * set.reps,
  );
}

function sharesFor(muscles: ExerciseMuscles, exerciseId: string): readonly MuscleShare[] {
  const shares = muscles.get(exerciseId);
  // An exercise with no muscles would vanish from every per-muscle total while
  // still counting towards the exercise totals, which is worse than failing.
  if (!shares) throw new Error(`exercise ${exerciseId} has no muscles recorded`);
  return shares;
}

/** Volume load per muscle, each set weighted by its contribution (spec 6.1). */
export function volumeLoadByMuscle(
  sets: readonly LoggedSet[],
  muscles: ExerciseMuscles,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const set of sets) {
    for (const share of sharesFor(muscles, set.exerciseId)) {
      const load = set.weightKg * set.reps * share.contribution;
      totals.set(share.muscle, (totals.get(share.muscle) ?? 0) + load);
    }
  }
  return totals;
}

export type MuscleSetCount = {
  /** Sets where this muscle is the primary. Spec 13.2 counts these. */
  direct: number;
  /** Direct sets plus half a set for every secondary appearance. */
  weighted: number;
};

/**
 * Spec 6.7 and 13.2. Direct and weighted are different questions and the 10 to 20
 * band in spec 12.5 is quoted against direct sets, so both are returned rather
 * than one being picked here.
 */
export function setCountsByMuscle(
  sets: readonly LoggedSet[],
  muscles: ExerciseMuscles,
): Map<string, MuscleSetCount> {
  const counts = new Map<string, MuscleSetCount>();
  for (const set of sets) {
    for (const share of sharesFor(muscles, set.exerciseId)) {
      const current = counts.get(share.muscle) ?? { direct: 0, weighted: 0 };
      counts.set(share.muscle, {
        direct: current.direct + (share.contribution === 1 ? 1 : 0),
        weighted: current.weighted + share.contribution,
      });
    }
  }
  return counts;
}

export type E1rmMark = {
  set: LoggedSet;
  e1rm: number;
};

/**
 * Best and worst estimated 1RM in the given sets, spec 6.3. Sets above 12 reps
 * are left out because spec 6.2 says the estimate does not hold there. Null when
 * nothing in the window qualifies, which is a real answer and not an error.
 */
export function bestAndWorstE1rm(
  sets: readonly LoggedSet[],
): { best: E1rmMark; worst: E1rmMark } | null {
  let best: E1rmMark | null = null;
  let worst: E1rmMark | null = null;

  for (const set of sets) {
    const e1rm = epleyE1rm(set.weightKg, set.reps);
    if (e1rm === null) continue;
    if (!best || e1rm > best.e1rm) best = { set, e1rm };
    if (!worst || e1rm < worst.e1rm) worst = { set, e1rm };
  }

  if (!best || !worst) return null;
  return { best, worst };
}

/** The highest estimated 1RM in the given sets, the top set. Null if none qualify. */
export function topSetE1rm(sets: readonly LoggedSet[]): number | null {
  return bestAndWorstE1rm(sets)?.best.e1rm ?? null;
}

/**
 * Spec 9: rest is measured, never enforced. A gap this long is not a rest interval,
 * it is a queue for the machine or a phone call, so it stays out of the averages.
 */
export const REST_OUTLIER_SECONDS = 900;

/** Spec 9's practical rule: rest long enough to keep 90% of the first set's reps. */
export const REP_HOLD_RATIO = 0.9;

/**
 * What one repetition costs in seconds. The app never sees the set itself, only the
 * gap between two logged sets, and that gap contains the set he just did. Three
 * seconds is the usual figure for a controlled rep with a real eccentric.
 */
export const SECONDS_PER_REP = 3;

/**
 * The gap between two sets minus the time the set itself took, which is roughly the
 * rest. It is an estimate and is labelled as one: the app has no way to know when he
 * racked the weight, only when he wrote the set down.
 */
export function estimatedRestSeconds(betweenSetsSeconds: number, reps: number): number {
  return Math.max(0, betweenSetsSeconds - reps * SECONDS_PER_REP);
}

export function averageRestSeconds(sets: readonly LoggedSet[]): number | null {
  const measured = sets
    .map((set) => set.restBeforeSeconds)
    .filter((rest): rest is number => typeof rest === 'number' && rest > 0)
    .filter((rest) => rest <= REST_OUTLIER_SECONDS);

  if (measured.length === 0) return null;
  return measured.reduce((total, rest) => total + rest, 0) / measured.length;
}

export type RepDropOff = {
  setIndex: number;
  reps: number;
  firstSetReps: number;
  restSeconds: number;
};

/**
 * Sets that fell below 90% of the first set's reps after resting less than this
 * exercise asks for. A drop after a full rest is fatigue doing its job and says
 * nothing about the rest, so it is not reported: spec 9 wants the target shown
 * faintly and never turned into a warning.
 */
export function repDropOffs(sets: readonly LoggedSet[], targetSeconds: number): RepDropOff[] {
  const first = sets.find((set) => set.setIndex === 1) ?? sets[0];
  if (!first) return [];

  return sets.flatMap((set) => {
    if (set === first || set.reps >= first.reps * REP_HOLD_RATIO) return [];
    const rest = set.restBeforeSeconds;
    if (typeof rest !== 'number' || rest >= targetSeconds || rest > REST_OUTLIER_SECONDS) return [];
    return [
      { setIndex: set.setIndex, reps: set.reps, firstSetReps: first.reps, restSeconds: rest },
    ];
  });
}
