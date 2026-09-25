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

export type CurvePoint = {
  /** El valor medido: minutos dormidos, gramos por kilo, veces la meta. */
  at: number;
  /** Lo que se gana de ese criterio ahi, de 0 a 1. */
  fraction: number;
};

/**
 * Lo que vale un valor dentro de una curva dada por puntos, en linea recta entre
 * uno y el siguiente.
 *
 * Un umbral con cero debajo dice que dormir cinco horas es lo mismo que no dormir, y
 * eso no es lo que dice ningun estudio. Una curva por puntos deja escribir lo que si
 * dicen: cada tramo con su pendiente, y el salto donde la evidencia lo pone.
 *
 * Por debajo del primer punto y por encima del ultimo vale lo que valga ese extremo.
 */
export function alongCurve(value: number, curve: readonly CurvePoint[]): number {
  if (curve.length === 0) throw new Error('a curve needs at least one point');

  let previous: CurvePoint | null = null;
  for (const point of curve) {
    if (point.fraction < 0 || point.fraction > 1) {
      throw new Error(`a curve point at ${point.at} scores ${point.fraction}, outside 0 to 1`);
    }
    if (previous !== null && point.at <= previous.at) {
      throw new Error(`a curve has to climb: ${point.at} comes after ${previous.at}`);
    }
    previous = point;
  }

  const first = curve[0];
  if (value <= first.at) return first.fraction;

  for (let i = 1; i < curve.length; i += 1) {
    const to = curve[i];
    if (value > to.at) continue;
    const from = curve[i - 1];
    const share = (value - from.at) / (to.at - from.at);
    return from.fraction + share * (to.fraction - from.fraction);
  }

  return curve[curve.length - 1].fraction;
}

/** Spec 6.6: with nothing logged there is no day to judge, and one thing is enough. */
export const MINIMUM_CRITERIA_WITH_DATA = 1;

export type DayScore = {
  /** 0 to 100, or null when nothing at all was logged. */
  score: number | null;
  /** The score before the penalty, which is what the criteria alone earned. */
  base: number | null;
  penalty: number;
  criteriaWithData: number;
  /** Puntos que se quedaron sin ganar por no haber dato, no por no haber cumplido. */
  pointsWithoutData: number;
};

/**
 * Spec 6.6. Every criterion is worth its own weight of the day and nothing more, so
 * the score says how much of a whole day he reached. A criterion without data earns
 * nothing: a thing not logged cannot be counted, and one that was left out of the
 * sum used to make a single tick worth a hundred.
 */
export function dayScore(criteria: readonly ScoredCriterion[], penalty = 0): DayScore {
  if (penalty > 0) throw new Error(`a penalty is negative or zero, got ${penalty}`);

  let earned = 0;
  let total = 0;
  let withData = 0;
  let withoutData = 0;

  for (const criterion of criteria) {
    total += criterion.weight;
    if (criterion.fraction === null) {
      withoutData += criterion.weight;
      continue;
    }
    if (criterion.fraction < 0 || criterion.fraction > 1) {
      throw new Error(`criterion ${criterion.id} scored ${criterion.fraction}, outside 0 to 1`);
    }
    withData += 1;
    earned += criterion.weight * criterion.fraction;
  }

  // Dividir entre el total y no entre 100 a secas es lo que deja este motor servir a
  // otro modulo con otros pesos, que es lo que pide spec 17.2.
  const scale = total === 0 ? 0 : 100 / total;

  if (withData < MINIMUM_CRITERIA_WITH_DATA || total === 0) {
    return {
      score: null,
      base: null,
      penalty,
      criteriaWithData: withData,
      pointsWithoutData: withoutData * scale,
    };
  }

  const base = earned * scale;
  // La nota se queda con un decimal. Redondear hacia arriba convertia un 99.2 en un
  // cien, y el cien tiene que significar el dia entero.
  return {
    score: Math.max(0, Math.round((base + penalty) * 10) / 10),
    base,
    penalty,
    criteriaWithData: withData,
    pointsWithoutData: withoutData * scale,
  };
}
