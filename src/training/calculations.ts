// Spec 6.1 to 6.3. Deterministic rules over the owner's own data: spec 11.2 is
// explicit that none of this goes through a model.
//
// Every formula has exactly one definition here. Aggregation happens in
// TypeScript rather than SQL for the same reason: one user's training history is
// small, and one copy of a formula cannot disagree with another.

import type { SessionEffort } from '../core/discipline.ts';
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
  /** Spec 5.5: el esfuerzo percibido, 0 a 10. Null cuando no lo anoto. */
  rpe?: number | null;
  /**
   * Lo que pesaba el ese dia, para los ejercicios que mueven el cuerpo. En una
   * dominada el peso escrito es el lastre, que casi siempre es cero: sin esto una
   * sesion entera de dominadas vale cero de volumen, que es justo lo contrario de
   * lo que paso.
   */
  bodyWeightKg?: number | null;
  /**
   * Cuantas veces cuenta el peso escrito. Con mancuernas el escribe lo que dice una
   * mancuerna, porque es lo que se lee en el hierro, pero levanto dos: ahi vale 2.
   * Ausente es 1, que es el caso de toda maquina, polea y barra.
   */
  loadFactor?: number;
};

/**
 * El peso que realmente movio esa serie: las dos mancuernas cuando toca, y su propio
 * cuerpo cuando el ejercicio es colgarse de una barra.
 */
export function setLoad(set: LoggedSet): number {
  return set.weightKg * (set.loadFactor ?? 1) + (set.bodyWeightKg ?? 0);
}

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
  return sets.reduce((total, set) => total + setLoad(set) * set.reps, 0);
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
    (set) => setLoad(set) * set.reps,
  );
}

export function volumeLoadBySession(sets: readonly LoggedSet[]): Map<string, number> {
  return groupSum(
    sets,
    (set) => set.sessionId,
    (set) => setLoad(set) * set.reps,
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
      const load = setLoad(set) * set.reps * share.contribution;
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

export type PlannedWork = {
  exerciseId: string;
  setsPlanned: number;
};

/**
 * Lo que movio una sesion, medido contra su plan.
 *
 * Las series se ponderan por lo que toca cada ejercicio, asi que un compuesto pesa
 * mas que un aislamiento sin tener que decirlo a mano: una serie de press inclinado
 * suma pecho entero mas medio hombro mas medio triceps, y una de elevaciones suma
 * un hombro.
 */
export function sessionEffort(
  sets: readonly LoggedSet[],
  plan: readonly PlannedWork[],
  muscles: ExerciseMuscles,
): SessionEffort {
  const weightOf = (exerciseId: string) =>
    sharesFor(muscles, exerciseId).reduce((total, share) => total + share.contribution, 0);

  const done = new Set<string>();
  let work = 0;
  for (const set of sets) {
    work += weightOf(set.exerciseId);
    for (const share of sharesFor(muscles, set.exerciseId)) done.add(share.muscle);
  }

  const planned = new Set<string>();
  let workPlanned = 0;
  let setsPlanned = 0;
  for (const entry of plan) {
    workPlanned += weightOf(entry.exerciseId) * entry.setsPlanned;
    setsPlanned += entry.setsPlanned;
    for (const share of sharesFor(muscles, entry.exerciseId)) planned.add(share.muscle);
  }

  return {
    sets: sets.length,
    setsPlanned,
    work,
    workPlanned,
    musclesDone: done.size,
    musclesPlanned: planned.size,
  };
}

export type E1rmMark = {
  set: LoggedSet;
  e1rm: number;
};

export function dailyEffort(
  sets: readonly LoggedSet[],
  plans: readonly (PlannedWork & { sessionId: string })[],
  muscles: ExerciseMuscles,
): SessionEffort {
  const grouped = new Map<string, LoggedSet[]>();
  for (const set of sets) {
    const group = grouped.get(set.sessionId) ?? [];
    group.push(set);
    grouped.set(set.sessionId, group);
  }
  const sessions = [...grouped].map(([id, entries]) =>
    sessionEffort(
      entries,
      plans.filter((entry) => entry.sessionId === id),
      muscles,
    ),
  );
  if (sessions.length === 1) return sessions[0];
  const sum = (key: Exclude<keyof SessionEffort, 'sessions'>) =>
    sessions.reduce((total, session) => total + session[key], 0);
  return {
    sets: sum('sets'),
    setsPlanned: sum('setsPlanned'),
    work: sum('work'),
    workPlanned: sum('workPlanned'),
    musclesDone: sum('musclesDone'),
    musclesPlanned: sum('musclesPlanned'),
    sessions,
  };
}

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
    // El mismo peso efectivo que el volumen: un 1RM de dominadas calculado sobre el
    // lastre da cero y no dice nada.
    const e1rm = epleyE1rm(setLoad(set), set.reps);
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
 * Desde cuando descansa: la ultima serie de la sesion, del ejercicio que sea.
 *
 * El reloj contaba desde la ultima serie del ejercicio abierto, y en el primero de cada
 * ejercicio, que es justo el descanso mas largo (cambiar de maquina), contaba desde que
 * empezo la sesion. Null antes de la primera serie.
 */
export function restingSince(sessionSets: readonly LoggedSet[]): number | null {
  const stamps = sessionSets.flatMap((set) => (set.timestamp === undefined ? [] : [set.timestamp]));
  return stamps.length === 0 ? null : Math.max(...stamps);
}

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
