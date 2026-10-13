import type { PlannedSet } from './routines.ts';
import {
  CONFIDENT_SESSIONS,
  remainingEstimate,
  type SessionTiming,
  type TimingExercise,
} from './timing.ts';

/** Public, read-only view of Training's existing remaining-work calculation. */
export type WorkoutFinish = {
  sessionId: string;
  gymId: string | null;
  endedAt: number | null;
  finishAt: number | null;
  remainingSets: number;
  evidence: 'none' | 'initial' | 'mixed' | 'limited' | 'learned' | 'complete';
  fewestSessions: number | null;
  overdue: boolean;
};

export function readWorkoutFinish(
  data: SessionTiming,
  plan: readonly PlannedSet[],
  catalog: readonly TimingExercise[],
  now: number,
  activeImplement?: { exerciseId: string; implement: string | null },
): WorkoutFinish {
  const identity = {
    sessionId: data.session.id,
    gymId: data.session.gym_id,
    endedAt: data.session.end_time,
  };
  if (data.session.end_time !== null)
    return {
      ...identity,
      finishAt: data.session.end_time,
      remainingSets: 0,
      evidence: 'complete',
      fewestSessions: null,
      overdue: false,
    };
  if (!plan.length || data.session.is_retroactive)
    return {
      ...identity,
      finishAt: null,
      remainingSets: 0,
      evidence: 'none',
      fewestSessions: null,
      overdue: false,
    };
  const remaining = remainingEstimate(data, plan, catalog, now, activeImplement);
  return {
    ...identity,
    finishAt: remaining.sets
      ? now + remaining.seconds * 1000
      : data.sets.reduce(
          (latest, set) => (set.timestamp <= now ? Math.max(latest, set.timestamp) : latest),
          data.session.start_time ?? 0,
        ) || now,
    remainingSets: remaining.sets,
    fewestSessions: remaining.fewestSessions,
    overdue: remaining.overdue,
    evidence: !remaining.sets
      ? 'complete'
      : !remaining.learnedSets
        ? 'initial'
        : remaining.learnedSets < remaining.sets
          ? 'mixed'
          : (remaining.fewestSessions ?? 0) < CONFIDENT_SESSIONS
            ? 'limited'
            : 'learned',
  };
}
