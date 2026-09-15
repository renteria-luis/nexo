// The generic half of the discipline grid. Spec 17.2: a set of criteria, each with
// a weight, a band or a threshold, and a points function. Nothing here knows about
// training, food or sleep, so a budget criterion in the Finance module can reuse it.

/** How much of a criterion was earned, 0 to 1, or null when the day has no data for it. */
export type Fraction = number | null;

export type ScoredCriterion = {
  id: string;
  weight: number;
  fraction: Fraction;
};

export type Band = {
  /** Full points inside these bounds. */
  fullFrom: number;
  fullTo: number;
  /** Points fall away linearly out to here, and are zero beyond. */
  partialFrom: number;
  partialTo: number;
};

/**
 * Full at the target or above, nothing below `partialFrom`, and a straight line
 * between the two. Spec 3.5 spells this shape out for sleep and spec 3.4 and 14.2
 * use it for water and steps.
 */
export function towardsTarget(value: number, target: number, partialFrom: number): number {
  if (partialFrom >= target) {
    throw new Error(`partial threshold ${partialFrom} must sit below the target ${target}`);
  }
  if (value >= target) return 1;
  if (value <= partialFrom) return 0;
  return (value - partialFrom) / (target - partialFrom);
}

/**
 * Full inside the band, a straight line down through each partial shoulder, zero
 * outside. Spec 3.2: under-eating is a miss too, so both shoulders count.
 */
export function withinBand(value: number, band: Band): number {
  if (band.partialFrom > band.fullFrom || band.partialTo < band.fullTo) {
    throw new Error('the partial bounds of a band have to sit outside the full bounds');
  }
  if (value >= band.fullFrom && value <= band.fullTo) return 1;
  if (value <= band.partialFrom || value >= band.partialTo) return 0;
  if (value < band.fullFrom) {
    return (value - band.partialFrom) / (band.fullFrom - band.partialFrom);
  }
  return (band.partialTo - value) / (band.partialTo - band.fullTo);
}

/** Spec 6.6: below this many criteria with data the day has no score at all. */
export const MINIMUM_CRITERIA_WITH_DATA = 3;

export type DayScore = {
  /** 0 to 100, or null when too little of the day was logged to judge it. */
  score: number | null;
  /** The score before the penalty, which is what the criteria alone earned. */
  base: number | null;
  penalty: number;
  criteriaWithData: number;
};

/**
 * Spec 6.6. Criteria without data leave both sides of the fraction, so a day with
 * three things logged is judged on those three rather than punished for the rest.
 */
export function dayScore(criteria: readonly ScoredCriterion[], penalty = 0): DayScore {
  if (penalty > 0) throw new Error(`a penalty is negative or zero, got ${penalty}`);

  let earned = 0;
  let possible = 0;
  let withData = 0;

  for (const criterion of criteria) {
    if (criterion.fraction === null) continue;
    if (criterion.fraction < 0 || criterion.fraction > 1) {
      throw new Error(`criterion ${criterion.id} scored ${criterion.fraction}, outside 0 to 1`);
    }
    withData += 1;
    earned += criterion.weight * criterion.fraction;
    possible += criterion.weight;
  }

  if (withData < MINIMUM_CRITERIA_WITH_DATA || possible === 0) {
    return { score: null, base: null, penalty, criteriaWithData: withData };
  }

  const base = (earned / possible) * 100;
  return {
    score: Math.max(0, base + penalty),
    base,
    penalty,
    criteriaWithData: withData,
  };
}
