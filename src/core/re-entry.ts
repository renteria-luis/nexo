// Spec 6.5. Coming back from a layoff at seventy percent of previous loads, every
// comparison against pre-layoff marks is misleading. The point of the mode is data
// accuracy, not encouragement: while it is on, PRs are suppressed, comparisons are
// drawn only against sessions inside the period, and the missed training penalty
// does not apply.

import { addDays, daysBetween, type IsoDate } from './dates.ts';
import type { ReEntryState } from './settings.ts';

/** Spec 6.5: a week of scheduled days going by without a session starts it. */
export const TRIGGER_MISSED_SCHEDULED_DAYS = 7;

export function shouldStartReEntry(consecutiveMissed: number): boolean {
  return consecutiveMissed >= TRIGGER_MISSED_SCHEDULED_DAYS;
}

export function isReEntryActive(state: ReEntryState, onDate: IsoDate): boolean {
  if (state.startedOn === null) return false;
  const elapsed = daysBetween(state.startedOn, onDate);
  return elapsed >= 0 && elapsed < state.weeks * 7;
}

export type ReEntryBanner = {
  week: number;
  of: number;
  endsOn: IsoDate;
};

/** The banner in spec 6.5: "Readaptación — semana 1 de 3". Null when not active. */
export function reEntryBanner(state: ReEntryState, onDate: IsoDate): ReEntryBanner | null {
  if (!isReEntryActive(state, onDate) || state.startedOn === null) return null;

  const elapsed = daysBetween(state.startedOn, onDate);
  return {
    week: Math.floor(elapsed / 7) + 1,
    of: state.weeks,
    endsOn: addDays(state.startedOn, state.weeks * 7 - 1),
  };
}

/**
 * Spec 6.5: while readapting, comparisons are drawn only against sessions inside
 * the period. Outside it, the caller's own window applies unchanged.
 */
export function comparisonFloor(state: ReEntryState, onDate: IsoDate): IsoDate | null {
  return isReEntryActive(state, onDate) ? state.startedOn : null;
}
