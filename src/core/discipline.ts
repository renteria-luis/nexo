// The eight criteria of spec 4.1, the alcohol scale of 4.2 and the missed training
// penalty of 4.3, built on the generic engine in scoring.ts.

import {
  alongCurve,
  dayScore,
  type CurvePoint,
  type DayScore,
  type ScoredCriterion,
} from './scoring.ts';
import type { TargetValues } from './targets.ts';

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

/**
 * Spec 3.5 y 4.1. La curva del sueno, en minutos, tal como la fijo el dueno a partir
 * de Saner 2020 (cinco noches de cuatro horas bajan la sintesis de proteina
 * miofibrilar) y de los estudios que ya cita spec 1.5.
 *
 * Antes eran cero puntos por debajo de seis horas, y eso decia que dormir cinco es lo
 * mismo que no dormir. No lo es: la perdida es fuerte pero gradual, y el salto de
 * verdad esta entre las cinco y las siete. De ocho para arriba ya no suma.
 */
const SLEEP_CURVE: readonly CurvePoint[] = [
  { at: 0, fraction: 0 },
  { at: 60, fraction: 0 },
  { at: 90, fraction: 1 / 20 },
  { at: 120, fraction: 1 / 20 },
  { at: 150, fraction: 2 / 20 },
  { at: 180, fraction: 3 / 20 },
  { at: 210, fraction: 4 / 20 },
  { at: 240, fraction: 5 / 20 },
  { at: 270, fraction: 6 / 20 },
  { at: 300, fraction: 7 / 20 },
  { at: 330, fraction: 9 / 20 },
  { at: 360, fraction: 11 / 20 },
  { at: 390, fraction: 14 / 20 },
  { at: 420, fraction: 17 / 20 },
  { at: 450, fraction: 19 / 20 },
  { at: 480, fraction: 1 },
];

/** Donde la curva del sueno llega a los veinte puntos, para poder decirlo en pantalla. */
export const SLEEP_FULL_MINUTES = 480;

/**
 * Spec 4.1. La proteina en gramos por kilo de peso.
 *
 * Morton 2018 pone la meseta de ganancia de masa magra en 1.62 g/kg (IC 95% 1.03 a
 * 2.20), asi que la banda 1.8 a 2.2 de spec 3.6 esta dentro del intervalo y vale los
 * dieciseis puntos enteros. Por debajo no se cae a plomo: 1.2 g/kg sigue construyendo
 * bastante y 0.8 es la recomendacion general, que mantiene pero no construye. Por
 * encima de 2.2 no aporta mas y solo le quita sitio a los otros macros, asi que baja
 * despacio en vez de castigar.
 */
const PROTEIN_CURVE: readonly CurvePoint[] = [
  { at: 0, fraction: 0 },
  { at: 0.8, fraction: 0.2 },
  { at: 1.2, fraction: 0.5 },
  { at: 1.6, fraction: 0.875 },
  { at: 1.8, fraction: 1 },
  { at: 2.2, fraction: 1 },
  { at: 3, fraction: 0.875 },
  { at: 4, fraction: 0.75 },
];

/**
 * Spec 4.1. Las calorias como fraccion de la meta del dia.
 *
 * Diez dias al 80% de lo que necesita bajan la sintesis de proteina en reposo un 16%
 * (Areta 2014), el meta-analisis de Murphy 2022 confirma que el deficit frena la
 * ganancia de masa magra aunque no la fuerza, y Garthe 2011 muestra que bajando de
 * peso despacio (0.7% por semana) se gana masa magra mientras que bajando rapido
 * (1.4%) no. Eso describe una pendiente, no un acantilado: comer 1 180 de 2 425 es
 * medio dia de comida y vale un tercio de los puntos, no cero. Cero es no comer.
 * Por arriba no se pierde musculo, se gana grasa, que es la meta 4 del dueno: a la
 * misma distancia de la meta las dos caras valen casi lo mismo, con la de abajo un
 * pelo mejor tratada porque va en la direccion de esa meta.
 */
const KCAL_CURVE: readonly CurvePoint[] = [
  { at: 0, fraction: 0 },
  { at: 0.3, fraction: 0.15 },
  { at: 0.5, fraction: 0.35 },
  { at: 0.7, fraction: 0.6 },
  { at: 0.8, fraction: 0.8 },
  { at: 0.88, fraction: 0.92 },
  { at: 0.94, fraction: 1 },
  { at: 1.06, fraction: 1 },
  { at: 1.15, fraction: 0.8 },
  { at: 1.3, fraction: 0.55 },
  { at: 1.5, fraction: 0.35 },
  { at: 2, fraction: 0 },
];
/**
 * Spec 3.4 y 4.1. El agua como fraccion de la meta del dia, que ya es mayor los dias
 * que entrena (2.8 L de descanso contra 3.5 L de entreno).
 *
 * Antes no daba nada por debajo del 75% de la meta, asi que 2.23 L de 2.8 L salian
 * 1.5 de 8 y 2.09 L salian cero. La deshidratacion no funciona asi: los efectos
 * medidos aparecen alrededor del 2% del peso corporal perdido y crecen con el
 * deficit, sin ningun escalon. Por eso la curva es casi proporcional, con una caida
 * algo mas rapida en la mitad de abajo, que es donde ya se nota.
 */
const WATER_CURVE: readonly CurvePoint[] = [
  { at: 0, fraction: 0 },
  { at: 0.25, fraction: 0.18 },
  { at: 0.5, fraction: 0.45 },
  { at: 0.75, fraction: 0.72 },
  { at: 0.9, fraction: 0.9 },
  { at: 1, fraction: 1 },
];

/**
 * Spec 14.2. Los pasos, tambien como fraccion de su meta. Mismo motivo que el agua:
 * caminar 3 000 de 5 000 no es lo mismo que no salir de casa, y el gasto del dia sube
 * con cada paso sin ningun umbral.
 */
const STEPS_CURVE: readonly CurvePoint[] = [
  { at: 0, fraction: 0 },
  { at: 0.4, fraction: 0.3 },
  { at: 0.7, fraction: 0.62 },
  { at: 0.9, fraction: 0.88 },
  { at: 1, fraction: 1 },
];

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
  /** Spec 4.3: la mejor semana de siete dias que contiene este dia, mire hacia donde mire. */
  bestWeekSessions: number;
  consecutiveMissed: number;
  /** Spec 4.3: a planned rest day is scored on everything else and penalised on nothing. */
  isScheduledRestDay: boolean;
  /** Spec 6.5: while readapting, the miss penalty is not applied. */
  reEntryActive: boolean;
};

function binary(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

/**
 * Spec 4.3. Cinco sesiones en una semana dejan los otros dos dias libres, y un
 * descanso marcado en uno de esos dias vale como haber entrenado: descansar cuando
 * cumpliste es parte del plan, no un dia perdido. Con sesiones pendientes no vale, o
 * marcar descanso todos los dias seria la forma mas facil de sacar cien.
 *
 * La semana que cuenta es la mejor que contiene ese dia y no la que quedo detras: un
 * descanso el jueves con el entreno del viernes, sabado y domingo por delante es
 * exactamente el caso, y solo el domingo se sabe.
 */
export function restCountsAsTrained(training: TrainingContext): boolean {
  return training.isScheduledRestDay && training.bestWeekSessions >= WEEKLY_SESSION_TARGET;
}

export function scoreCriteria(
  day: DisciplineDay,
  targets: TargetValues,
  training: TrainingContext,
): ScoredCriterion[] {
  const water = day.isTrainingDay ? targets.waterMlTraining : targets.waterMlRest;

  return [
    {
      id: 'trained',
      weight: CRITERION_WEIGHTS.trained,
      fraction: restCountsAsTrained(training) ? 1 : binary(day.trained),
    },
    {
      id: 'sleep',
      weight: CRITERION_WEIGHTS.sleep,
      fraction: day.sleepMinutes === null ? null : alongCurve(day.sleepMinutes, SLEEP_CURVE),
    },
    {
      id: 'protein',
      weight: CRITERION_WEIGHTS.protein,
      fraction:
        day.proteinG === null
          ? null
          : alongCurve(day.proteinG / targets.weightBasisKg, PROTEIN_CURVE),
    },
    {
      id: 'calories',
      weight: CRITERION_WEIGHTS.calories,
      fraction: day.kcal === null ? null : alongCurve(day.kcal / targets.kcal, KCAL_CURVE),
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
      fraction: day.waterMl === null ? null : alongCurve(day.waterMl / water, WATER_CURVE),
    },
    {
      id: 'steps',
      weight: CRITERION_WEIGHTS.steps,
      fraction: day.steps === null ? null : alongCurve(day.steps / targets.steps, STEPS_CURVE),
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
  const criteria = scoreCriteria(day, targets, training);

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
