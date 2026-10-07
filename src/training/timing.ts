import type { TrainingSessionRow } from '../db/types.ts';
import { median } from './pace.ts';
import {
  AVG_SET_SECONDS,
  TRANSITION_SECONDS,
  WARMUP_SECONDS,
  type PlannedSet,
} from './routines.ts';

export type TimingReview = 'auto' | 'keep' | 'exclude';
export type TimingSet = {
  id: string;
  exerciseId: string;
  implement: string;
  setIndex: number;
  timestamp: number;
  warmup: boolean;
  eligible: boolean;
  review: TimingReview;
  correctedSeconds: number | null;
};

export type TimingSample = {
  sessionId: string;
  date: string;
  exerciseId: string;
  implement: string;
  sets: number;
  samples: number;
  flagged: number;
  minutes: number | null;
};

export type IntervalReason =
  | 'first'
  | 'switch'
  | 'gap'
  | 'unrecorded'
  | 'excluded'
  | 'adjacent'
  | 'short'
  | 'long'
  | 'unusual'
  | null;
export type SetInterval = TimingSet & {
  rawSeconds: number | null;
  seconds: number | null;
  reason: IntervalReason;
};
export type ExerciseTiming = {
  exerciseId: string;
  implement: string;
  sets: number;
  samples: number;
  flagged: number;
  minutes: number | null;
  intervals: SetInterval[];
};
export type SessionTiming = {
  session: TrainingSessionRow;
  sets: TimingSet[];
  history: TimingSample[];
  exercises: ExerciseTiming[];
};

// Heuristic bounds flag taps for review; they are not limits on how he should train.
export function unusualInterval(seconds: number, reference: readonly number[]): IntervalReason {
  if (seconds < 20) return 'short';
  if (seconds > 15 * 60) return 'long';
  if (reference.length < 5) return null;
  const center = median(reference)!;
  const mad = median(reference.map((value) => Math.abs(value - center)))!;
  // The floor handles identical samples and avoids flagging ordinary small changes.
  return Math.abs(seconds - center) > Math.max(60, 0.5 * center, (3.5 * mad) / 0.6745)
    ? 'unusual'
    : null;
}

export function exerciseHistory(
  history: readonly TimingSample[],
  exerciseId: string,
  implement: string,
) {
  return history
    .filter(
      (sample) =>
        sample.exerciseId === exerciseId &&
        sample.implement === implement &&
        sample.minutes !== null &&
        sample.samples > 0,
    )
    .slice(-20);
}

export function historicalPace(
  history: readonly TimingSample[],
  exerciseId: string,
  implement: string,
): number | null {
  return median(
    exerciseHistory(history, exerciseId, implement).map(
      (sample) => (sample.minutes! * 60) / sample.sets,
    ),
  );
}

export function analyzeTiming(
  session: TrainingSessionRow,
  sets: readonly TimingSet[],
  history: readonly TimingSample[],
): ExerciseTiming[] {
  const ordered = [...sets].sort((a, b) => a.timestamp - b.timestamp);
  const groups = new Map<string, ExerciseTiming>();
  for (let i = 0; i < ordered.length; i++) {
    const set = ordered[i];
    if (set.warmup) continue;
    const key = JSON.stringify([set.exerciseId, set.implement]);
    const group = groups.get(key) ?? {
      exerciseId: set.exerciseId,
      implement: set.implement,
      sets: 0,
      samples: 0,
      flagged: 0,
      minutes: null,
      intervals: [],
    };
    groups.set(key, group);
    group.sets++;
    const previous = ordered[i - 1];
    let reason: IntervalReason = null;
    let rawSeconds: number | null = null;
    const withinSession = (item: TimingSet) =>
      item.eligible &&
      session.start_time !== null &&
      item.timestamp >= session.start_time &&
      (session.end_time === null || item.timestamp <= session.end_time);
    if (session.is_retroactive || !withinSession(set)) reason = 'unrecorded';
    else if (!previous) reason = 'first';
    else if (
      previous.warmup ||
      previous.exerciseId !== set.exerciseId ||
      previous.implement !== set.implement
    )
      reason = 'switch';
    else if (!withinSession(previous)) reason = 'unrecorded';
    else {
      rawSeconds = (set.timestamp - previous.timestamp) / 1000;
      if (set.setIndex !== previous.setIndex + 1) reason = 'gap';
    }
    if (set.review === 'exclude') reason = 'excluded';
    else if (rawSeconds !== null && previous?.review === 'exclude') reason = 'adjacent';

    let seconds: number | null = null;
    if (!session.is_retroactive && set.review !== 'exclude' && set.correctedSeconds !== null) {
      seconds = set.correctedSeconds;
      reason = null;
    } else if (rawSeconds !== null && reason === null) {
      const reference = exerciseHistory(history, set.exerciseId, set.implement).map(
        (sample) => (sample.minutes! * 60) / sample.sets,
      );
      reason =
        set.review === 'keep' && rawSeconds > 0 ? null : unusualInterval(rawSeconds, reference);
      if (reason === null) seconds = rawSeconds;
    }
    group.intervals.push({ ...set, rawSeconds, seconds, reason });
  }
  for (const group of groups.values()) {
    const seconds = group.intervals.flatMap((interval) =>
      interval.seconds === null ? [] : [interval.seconds],
    );
    group.samples = seconds.length;
    group.flagged = group.intervals.filter((interval) =>
      ['short', 'long', 'unusual', 'adjacent', 'gap'].includes(interval.reason ?? ''),
    ).length;
    // The missing first cycle and rejected intervals are inferred, never counted as observations.
    group.minutes = seconds.length
      ? ((seconds.reduce((sum, value) => sum + value, 0) / seconds.length) * group.sets) / 60
      : null;
  }
  return [...groups.values()];
}

export type TimingExercise = { id: string; equipment_type: string; unilateral: number };
export type RemainingEstimate = {
  seconds: number;
  sets: number;
  learnedSets: number;
  overdue: boolean;
};

export function remainingEstimate(
  data: SessionTiming,
  plan: readonly PlannedSet[],
  catalog: readonly TimingExercise[],
  now: number,
  activeImplement?: { exerciseId: string; implement: string | null },
): RemainingEstimate {
  const pending: {
    exerciseId: string;
    sets: number;
    cycle: number;
    learned: boolean;
    transition: number;
  }[] = [];
  const working = data.sets.filter((set) => !set.warmup);
  const latest = data.sets.at(-1);
  for (const entry of plan) {
    const done = working.filter((set) => set.exerciseId === entry.exerciseId);
    const left = Math.max(0, entry.sets - done.length);
    if (!left) continue;
    const exercise = catalog.find((item) => item.id === entry.exerciseId);
    const implement =
      (activeImplement?.exerciseId === entry.exerciseId ? activeImplement.implement : null) ??
      done.at(-1)?.implement ??
      exercise?.equipment_type ??
      '';
    const past = historicalPace(data.history, entry.exerciseId, implement);
    const current = data.exercises.find(
      (item) => item.exerciseId === entry.exerciseId && item.implement === implement,
    );
    const baseline = past ?? entry.restSeconds + AVG_SET_SECONDS * (exercise?.unilateral ? 2 : 1);
    const observed =
      current?.minutes === null || !current ? null : (current.minutes * 60) / current.sets;
    const weight = Math.min(0.75, (current?.samples ?? 0) / ((current?.samples ?? 0) + 2));
    const cycle = observed === null ? baseline : baseline * (1 - weight) + observed * weight;
    pending.push({
      exerciseId: entry.exerciseId,
      sets: left,
      cycle,
      learned: past !== null || observed !== null,
      transition: done.length === 0 ? TRANSITION_SECONDS : 0,
    });
  }
  const setsLeft = pending.reduce((sum, item) => sum + item.sets, 0);
  if (!setsLeft) return { seconds: 0, sets: 0, learnedSets: 0, overdue: false };
  let seconds = pending.reduce((sum, item) => sum + item.sets * item.cycle + item.transition, 0);
  let overdue = false;
  if (!latest) {
    seconds += Math.max(
      0,
      WARMUP_SECONDS - Math.max(0, (now - (data.session.start_time ?? now)) / 1000),
    );
  } else if (latest.eligible && latest.review !== 'exclude' && latest.timestamp <= now) {
    const elapsed = Math.max(0, (now - latest.timestamp) / 1000);
    const continuing = pending.find((item) => item.exerciseId === latest.exerciseId);
    // Credit only the next cycle, not the whole workout. An overdue tap cannot finish a set.
    const nextCycle = continuing?.cycle ?? pending[0].cycle + pending[0].transition;
    seconds -= Math.min(elapsed, Math.max(0, nextCycle - 30));
    overdue = elapsed > nextCycle;
  }
  return {
    seconds: Math.max(30, seconds),
    sets: setsLeft,
    learnedSets: pending.reduce((sum, item) => sum + (item.learned ? item.sets : 0), 0),
    overdue,
  };
}
