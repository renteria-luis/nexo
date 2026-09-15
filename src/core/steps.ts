// Spec 14.2. The step target climbs in stages instead of starting at ten thousand,
// because a criterion that is failed from day one is noise in the score rather than
// a lever. A stage is earned, not set by hand and not advanced silently.

import { addDays, type IsoDate } from './dates.ts';
import type { CoreDailyLogRow } from '../db/types.ts';

/** Spec 14.2: his baseline is around 6,000, so the ladder starts one step above it. */
export const STEP_STAGES = [7000, 8500, 10000] as const;

/** Days out of seven that have to reach the target for a week to count. */
export const DAYS_PER_WEEK_REQUIRED = 5;
/** Consecutive weeks like that before the next stage is offered. */
export const WEEKS_REQUIRED = 3;

export function nextStepTarget(current: number): number | null {
  return STEP_STAGES.find((stage) => stage > current) ?? null;
}

/** Whole seven day blocks ending on the given day, most recent first. */
function weekBlocks(onDate: IsoDate, weeks: number): { from: IsoDate; to: IsoDate }[] {
  return Array.from({ length: weeks }, (_, index) => ({
    from: addDays(onDate, -7 * (index + 1) + 1),
    to: addDays(onDate, -7 * index),
  }));
}

export function daysMeetingTarget(
  logs: readonly CoreDailyLogRow[],
  target: number,
  block: { from: IsoDate; to: IsoDate },
): number {
  return logs.filter(
    (log) =>
      log.date >= block.from && log.date <= block.to && log.steps !== null && log.steps >= target,
  ).length;
}

export type StepsAdvice = {
  current: number;
  next: number;
  /** How many of the required weeks he has already met, for the sentence on screen. */
  weeksMet: number;
};

/**
 * Null until the rule is fully met: the target he has is the target he keeps. A day
 * with no step count is a day that did not reach the target, because the criterion
 * is scored on what was logged (spec 4.1) and not on what might have happened.
 */
export function stepsAdvice(
  logs: readonly CoreDailyLogRow[],
  currentTarget: number,
  onDate: IsoDate,
): StepsAdvice | null {
  const next = nextStepTarget(currentTarget);
  if (next === null) return null;

  const weeksMet = weekBlocks(onDate, WEEKS_REQUIRED).filter(
    (block) => daysMeetingTarget(logs, currentTarget, block) >= DAYS_PER_WEEK_REQUIRED,
  ).length;

  return weeksMet === WEEKS_REQUIRED ? { current: currentTarget, next, weeksMet } : null;
}
