// Por que ese dia salio de ese color.
//
// La cuadricula solo puede pintar un numero, y un numero sin explicacion no se
// corrige: no dice si el dia fue malo o si simplemente no anoto nada. Esto desarma
// la nota en las ocho lineas de spec 4.1, cada una con lo que hizo, lo que pedia y
// los puntos que saco, y nombra la razon cuando no hay nota que dar.

import type { CoreDailyLogRow } from '../db/types.ts';

import {
  CRITERION_WEIGHTS,
  SLEEP_FULL_MINUTES,
  type CriterionId,
  type DisciplineResult,
} from './discipline.ts';
import { kcalBand, proteinBand, type TargetValues } from './targets.ts';

export const CRITERION_LABELS: Record<CriterionId, string> = {
  trained: 'entreno',
  sleep: 'sueño',
  protein: 'proteína',
  calories: 'calorías',
  alcohol: 'alcohol',
  water: 'agua',
  steps: 'pasos',
  creatine: 'creatina',
};

/** Lo que falta para poder puntuar, dicho con el nombre del boton que lo arregla. */
export type NoScoreReason = 'sin-metas' | 'pocos-datos';

export type CriterionLine = {
  id: CriterionId;
  label: string;
  weight: number;
  /** Puntos ganados de los que vale, null cuando no hay dato. */
  earned: number | null;
  /** Lo que hizo ese dia. */
  value: string;
  /** Contra que se midio, o null cuando la frase ya lo dice todo. */
  target: string | null;
};

export type DayReport = {
  score: number | null;
  base: number | null;
  penalty: number;
  criteriaWithData: number;
  /** Puntos del dia que nadie anoto, que es distinto de puntos que no se cumplieron. */
  pointsWithoutData: number;
  missedScheduledSession: boolean;
  noScore: NoScoreReason | null;
  lines: CriterionLine[];
};

const MISSING = '—';

export function hoursAndMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${String(Math.round(minutes % 60)).padStart(2, '0')}`;
}

/** La nota con su decimal cuando lo tiene: 99.2, pero 100. */
export function scoreText(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

export function litres(ml: number): string {
  return `${(ml / 1000).toFixed(2)} L`;
}

/** Miles con espacio fino, que es lo que se lee de un vistazo en una columna. */
export function thousands(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export type ReportInput = {
  result: DisciplineResult | null;
  log: CoreDailyLogRow | null;
  targets: TargetValues | null;
  nutrition: { kcal: number; proteinG: number } | null;
  trained: boolean | null;
  isTrainingDay: boolean;
};

function lines(input: ReportInput): CriterionLine[] {
  const { log, targets, nutrition, trained } = input;
  const fractions = new Map(
    (input.result?.criteria ?? []).map((criterion) => [criterion.id, criterion.fraction]),
  );

  const earned = (id: CriterionId): number | null => {
    const fraction = fractions.get(id);
    return fraction === null || fraction === undefined ? null : CRITERION_WEIGHTS[id] * fraction;
  };

  const protein = targets ? proteinBand(targets) : null;
  const kcal = targets ? kcalBand(targets) : null;
  const water = targets
    ? input.isTrainingDay
      ? targets.waterMlTraining
      : targets.waterMlRest
    : null;

  return [
    {
      id: 'trained',
      label: CRITERION_LABELS.trained,
      weight: CRITERION_WEIGHTS.trained,
      earned: earned('trained'),
      // Un descanso marcado con la semana cumplida gana los puntos, asi que la linea
      // tiene que decir por que estan ahi sin haber entrenado.
      value:
        log?.rest_day === 1 && earned('trained') === CRITERION_WEIGHTS.trained
          ? 'descanso planeado'
          : trained === null
            ? 'el día no terminó'
            : trained
              ? 'entrenó'
              : 'no entrenó',
      target: null,
    },
    {
      id: 'sleep',
      label: CRITERION_LABELS.sleep,
      weight: CRITERION_WEIGHTS.sleep,
      earned: earned('sleep'),
      value: log?.sleep_minutes == null ? MISSING : hoursAndMinutes(log.sleep_minutes),
      // Los veinte puntos estan en las ocho horas, que es donde la curva de spec 4.1
      // deja de subir. Su meta personal de Ajustes es otra cosa y vive en Hoy.
      target: hoursAndMinutes(SLEEP_FULL_MINUTES),
    },
    {
      id: 'protein',
      label: CRITERION_LABELS.protein,
      weight: CRITERION_WEIGHTS.protein,
      earned: earned('protein'),
      value: nutrition === null ? MISSING : `${Math.round(nutrition.proteinG)} g`,
      target: protein === null ? MISSING : `${protein.from} a ${protein.to} g`,
    },
    {
      id: 'calories',
      label: CRITERION_LABELS.calories,
      weight: CRITERION_WEIGHTS.calories,
      earned: earned('calories'),
      value: nutrition === null ? MISSING : `${Math.round(nutrition.kcal)} kcal`,
      target: kcal === null ? MISSING : `${Math.round(kcal.from)} a ${Math.round(kcal.to)}`,
    },
    {
      id: 'alcohol',
      label: CRITERION_LABELS.alcohol,
      weight: CRITERION_WEIGHTS.alcohol,
      earned: earned('alcohol'),
      value:
        log?.alcohol_drinks == null
          ? MISSING
          : log.alcohol_drinks === 0
            ? 'ninguno'
            : `${log.alcohol_drinks} tragos${log.alcohol_after_training === 1 ? ', post entreno' : ''}`,
      target: null,
    },
    {
      id: 'water',
      label: CRITERION_LABELS.water,
      weight: CRITERION_WEIGHTS.water,
      earned: earned('water'),
      value: log?.water_ml == null ? MISSING : litres(log.water_ml),
      target: water === null ? MISSING : litres(water),
    },
    {
      id: 'steps',
      label: CRITERION_LABELS.steps,
      weight: CRITERION_WEIGHTS.steps,
      earned: earned('steps'),
      value: log?.steps == null ? MISSING : thousands(log.steps),
      target: targets ? thousands(targets.steps) : MISSING,
    },
    {
      id: 'creatine',
      label: CRITERION_LABELS.creatine,
      weight: CRITERION_WEIGHTS.creatine,
      earned: earned('creatine'),
      value: log?.creatine_taken == null ? MISSING : log.creatine_taken === 1 ? 'sí' : 'no',
      target: null,
    },
  ];
}

export function reportDay(input: ReportInput): DayReport {
  const all = lines(input);
  const withData = all.filter((line) => line.earned !== null).length;

  // Sin metas no hay contra que medir, y es un problema distinto de no haber
  // anotado nada: uno se arregla en Ajustes y el otro anotando el dia.
  const noScore =
    input.result?.score != null ? null : input.targets === null ? 'sin-metas' : 'pocos-datos';

  return {
    score: input.result?.score ?? null,
    base: input.result?.base ?? null,
    penalty: input.result?.penalty ?? 0,
    criteriaWithData: withData,
    pointsWithoutData:
      input.result?.pointsWithoutData ??
      all.reduce((sum, line) => (line.earned === null ? sum + line.weight : sum), 0),
    missedScheduledSession: input.result?.missedScheduledSession ?? false,
    noScore,
    lines: all,
  };
}
