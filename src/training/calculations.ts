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
