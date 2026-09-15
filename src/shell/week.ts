// Spec 6.7, the weekly summary. It reads from every module, which is why it lives
// in the shell and calls each module's public interface (spec 17.4).
//
// The LLM paragraph spec 6.7 ends with belongs to the AI phase (spec 11.1) and is
// not here.

import type { SQLiteDatabase } from 'expo-sqlite';

import { listDailyLogs, toWeighIns } from '../core/daily-log.ts';
import {
  addDays,
  isWithin,
  trailingDays,
  weekRange,
  type DateRange,
  type IsoDate,
} from '../core/dates.ts';
import { rollingWeightAverage } from '../core/targets.ts';
import type { CoreDailyLogRow } from '../db/types.ts';
import { dailyTotals, listPortions } from '../nutrition/index.ts';
import {
  listWorkingSets,
  loadExerciseMuscles,
  setCountsByMuscle,
  volumeLoadByMuscle,
  type ExerciseMuscles,
  type LoggedSet,
} from '../training/index.ts';

/** Spec 12.5: the practical band for direct working sets per muscle per week. */
export const SET_BAND = { from: 10, to: 20 };

/** Spec 2.2 names this food as the largest single obstacle to fat loss. */
const JBC_FOOD_ID = 'wendys-jbc';

/** Spec 1.3 judges creatine over four weeks, the time it takes to saturate. */
const CREATINE_WINDOW_DAYS = 28;

const PRIOR_WEEKS = 4;

export type MuscleWeek = {
  muscle: string;
  directSets: number;
  weightedSets: number;
  band: 'below' | 'within' | 'above';
  volumeKg: number;
  /** Null without any sets in the four weeks before, rather than a zero that looks like a trend. */
  priorAverageVolumeKg: number | null;
};

export type Comparison = {
  thisWeek: number | null;
  previousWeek: number | null;
};

export type WeekSummary = {
  range: DateRange;
  muscles: MuscleWeek[];
  averages: {
    sleepMinutes: number | null;
    proteinG: number | null;
    kcal: number | null;
    steps: number | null;
    waterMl: number | null;
    /** Days that had food logged; the food averages are over these only. */
    foodDays: number;
  };
  /** Spec 1.1 rolling averages, null below four weigh-ins in the window. */
  weightKg: Comparison;
  alcohol: { drinks: number; daysWithDrinks: number };
  jbcCount: number;
  creatine: { taken: number; logged: number; windowDays: number };
  restingHr: Comparison;
  hrvMs: Comparison;
};

export type DayNutrition = {
  date: IsoDate;
  kcal: number;
  proteinG: number;
};

export type WeekInput = {
  range: DateRange;
  /** Must cover the 28 days ending on range.to, which also covers the previous week. */
  logs: readonly CoreDailyLogRow[];
  /** Only days with food logged: nothing eaten is not eating nothing. */
  nutrition: readonly DayNutrition[];
  weekSets: readonly LoggedSet[];
  /** The four weeks before range.from. */
  priorSets: readonly LoggedSet[];
  muscles: ExerciseMuscles;
  jbcCount: number;
};

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function present(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null);
}

function band(directSets: number): MuscleWeek['band'] {
  if (directSets < SET_BAND.from) return 'below';
  if (directSets > SET_BAND.to) return 'above';
  return 'within';
}

export function buildWeekSummary(input: WeekInput): WeekSummary {
  const { range } = input;
  const previous: DateRange = { from: addDays(range.from, -7), to: addDays(range.from, -1) };

  const inWeek = input.logs.filter((log) => isWithin(log.date, range));
  const inPrevious = input.logs.filter((log) => isWithin(log.date, previous));

  const counts = setCountsByMuscle(input.weekSets, input.muscles);
  const volume = volumeLoadByMuscle(input.weekSets, input.muscles);
  const priorVolume =
    input.priorSets.length > 0 ? volumeLoadByMuscle(input.priorSets, input.muscles) : null;

  const muscleNames = new Set([...counts.keys(), ...(priorVolume ? priorVolume.keys() : [])]);
  const muscles: MuscleWeek[] = [...muscleNames]
    .map((muscle) => {
      const count = counts.get(muscle) ?? { direct: 0, weighted: 0 };
      return {
        muscle,
        directSets: count.direct,
        weightedSets: count.weighted,
        band: band(count.direct),
        volumeKg: volume.get(muscle) ?? 0,
        priorAverageVolumeKg: priorVolume ? (priorVolume.get(muscle) ?? 0) / PRIOR_WEEKS : null,
      };
    })
    .sort((a, b) => b.directSets - a.directSets || a.muscle.localeCompare(b.muscle));

  const weighIns = toWeighIns(input.logs);
  const creatineWindow = trailingDays(range.to, CREATINE_WINDOW_DAYS);
  const creatineLogs = input.logs.filter(
    (log) => log.creatine_taken !== null && isWithin(log.date, creatineWindow),
  );

  return {
    range,
    muscles,
    averages: {
      sleepMinutes: mean(present(inWeek.map((log) => log.sleep_minutes))),
      proteinG: mean(input.nutrition.map((day) => day.proteinG)),
      kcal: mean(input.nutrition.map((day) => day.kcal)),
      steps: mean(present(inWeek.map((log) => log.steps))),
      waterMl: mean(present(inWeek.map((log) => log.water_ml))),
      foodDays: input.nutrition.length,
    },
    weightKg: {
      thisWeek: rollingWeightAverage(weighIns, range.to),
      previousWeek: rollingWeightAverage(weighIns, previous.to),
    },
    alcohol: {
      drinks: present(inWeek.map((log) => log.alcohol_drinks)).reduce((a, b) => a + b, 0),
      daysWithDrinks: inWeek.filter((log) => (log.alcohol_drinks ?? 0) > 0).length,
    },
    jbcCount: input.jbcCount,
    creatine: {
      taken: creatineLogs.filter((log) => log.creatine_taken === 1).length,
      logged: creatineLogs.length,
      windowDays: CREATINE_WINDOW_DAYS,
    },
    restingHr: {
      thisWeek: mean(present(inWeek.map((log) => log.resting_hr))),
      previousWeek: mean(present(inPrevious.map((log) => log.resting_hr))),
    },
    hrvMs: {
      thisWeek: mean(present(inWeek.map((log) => log.hrv_ms))),
      previousWeek: mean(present(inPrevious.map((log) => log.hrv_ms))),
    },
  };
}

/** The Monday to Sunday week containing `date`. */
export async function loadWeekSummary(db: SQLiteDatabase, date: IsoDate): Promise<WeekSummary> {
  const range = weekRange(date);

  const [logs, weekSets, priorSets, muscles] = await Promise.all([
    listDailyLogs(db, trailingDays(range.to, CREATINE_WINDOW_DAYS)),
    listWorkingSets(db, range),
    listWorkingSets(db, {
      from: addDays(range.from, -PRIOR_WEEKS * 7),
      to: addDays(range.from, -1),
    }),
    loadExerciseMuscles(db),
  ]);

  const nutrition: DayNutrition[] = [];
  let jbcCount = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const day = addDays(range.from, offset);
    const portions = await listPortions(db, day);
    if (portions.length === 0) continue;
    const totals = dailyTotals(portions);
    nutrition.push({ date: day, kcal: totals.kcal, proteinG: totals.proteinG });
    jbcCount += portions
      .filter((portion) => portion.food.id === JBC_FOOD_ID)
      .reduce((total, portion) => total + portion.quantity, 0);
  }

  return buildWeekSummary({ range, logs, nutrition, weekSets, priorSets, muscles, jbcCount });
}
