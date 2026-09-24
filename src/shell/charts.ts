// Los datos que dibujan las graficas.
//
// Nada aqui calcula nada nuevo: son las mismas formulas del resto de la app leidas
// a lo largo del tiempo en vez de para un dia. Una grafica que no coincide con el
// numero de la pantalla de al lado es peor que no tenerla.

import type { SQLiteDatabase } from 'expo-sqlite';

import { listDailyLogs, toWeighIns } from '../core/daily-log.ts';
import { trailingDays, type IsoDate } from '../core/dates.ts';
import { targetsInForceOn } from '../core/snapshots.ts';
import { kcalBand, proteinBand, rollingWeightAverage } from '../core/targets.ts';
import { dailyTotals, listPortionsBetween } from '../nutrition/index.ts';
import {
  epleyE1rm,
  listWorkingSets,
  loadExerciseMuscles,
  setCountsByMuscle,
  setLoad,
} from '../training/index.ts';

import { SET_BAND } from './week.ts';

export type Point = { date: IsoDate; value: number };
export type Band = { from: number; to: number };

export type MuscleBar = { muscle: string; sets: number };

export type ExerciseTrend = {
  exerciseId: string;
  name: string;
  /** El mejor 1RM estimado de cada dia que lo entreno. */
  points: Point[];
};

export type ChartsData = {
  from: IsoDate;
  to: IsoDate;
  weight: Point[];
  /** La media de siete dias, que es la que dice algo: un dia suelto es agua. */
  weightAverage: Point[];
  score: Point[];
  protein: Point[];
  kcal: Point[];
  proteinBand: Band | null;
  kcalBand: Band | null;
  /** Series directas por musculo en los ultimos siete dias. */
  muscles: MuscleBar[];
  setBand: Band;
  trends: ExerciseTrend[];
};

/** Spec 6.2: por encima de doce repeticiones la formula infla y deja de servir. */
function bestE1rmOfDay(
  sets: { weightKg: number; reps: number; loadFactor?: number; bodyWeightKg?: number | null }[],
): number | null {
  let best: number | null = null;
  for (const set of sets) {
    const e1rm = epleyE1rm(setLoad(set as never), set.reps);
    if (e1rm === null) continue;
    if (best === null || e1rm > best) best = e1rm;
  }
  return best;
}

export async function loadCharts(
  db: SQLiteDatabase,
  today: IsoDate,
  days = 90,
): Promise<ChartsData> {
  const range = trailingDays(today, days);
  const week = trailingDays(today, 7);

  const [logs, portions, sets, weekSets, muscleMap, targets, names] = await Promise.all([
    listDailyLogs(db, range),
    listPortionsBetween(db, range),
    listWorkingSets(db, range),
    listWorkingSets(db, week),
    loadExerciseMuscles(db),
    targetsInForceOn(db, today),
    db.getAllAsync<{ id: string; name_es: string }>('SELECT id, name_es FROM training_exercise;'),
  ]);

  const weighIns = toWeighIns(logs);
  const weight: Point[] = [];
  const weightAverage: Point[] = [];
  for (const log of logs) {
    if (log.weight_kg !== null) weight.push({ date: log.date, value: log.weight_kg });
    // Dos pesadas bastan para dibujar la media: con cuatro, la linea no aparece
    // hasta el segundo mes y la grafica se ve vacia justo cuando mas se mira.
    const average = rollingWeightAverage(weighIns, log.date, 7, 2);
    if (average !== null) weightAverage.push({ date: log.date, value: average });
  }

  const score: Point[] = logs
    .filter((log) => log.score !== null)
    .map((log) => ({ date: log.date, value: log.score as number }));

  const protein: Point[] = [];
  const kcal: Point[] = [];
  for (const [date, eaten] of [...portions.entries()].sort()) {
    if (eaten.length === 0) continue;
    const totals = dailyTotals(eaten);
    protein.push({ date, value: totals.proteinG });
    kcal.push({ date, value: totals.kcal });
  }

  const counts = setCountsByMuscle(weekSets, muscleMap);
  const muscles: MuscleBar[] = [...counts.entries()]
    .map(([muscle, count]) => ({ muscle, sets: count.direct }))
    .filter((bar) => bar.sets > 0)
    .sort((a, b) => b.sets - a.sets);

  const nameOf = new Map(names.map((row) => [row.id, row.name_es]));
  const byExercise = new Map<string, Map<IsoDate, typeof sets>>();
  for (const set of sets) {
    const days = byExercise.get(set.exerciseId) ?? new Map();
    days.set(set.date, [...(days.get(set.date) ?? []), set]);
    byExercise.set(set.exerciseId, days);
  }

  const trends: ExerciseTrend[] = [];
  for (const [exerciseId, byDate] of byExercise) {
    const points: Point[] = [];
    for (const [date, daySets] of [...byDate.entries()].sort()) {
      const best = bestE1rmOfDay(daySets);
      if (best !== null) points.push({ date, value: best });
    }
    // Un solo punto no es una tendencia, es un punto.
    if (points.length >= 2) {
      trends.push({ exerciseId, name: nameOf.get(exerciseId) ?? exerciseId, points });
    }
  }
  trends.sort((a, b) => b.points.length - a.points.length);

  return {
    from: range.from,
    to: range.to,
    weight,
    weightAverage,
    score,
    protein,
    kcal,
    proteinBand: targets ? proteinBand(targets) : null,
    kcalBand: targets
      ? { from: Math.round(kcalBand(targets).fullFrom), to: Math.round(kcalBand(targets).fullTo) }
      : null,
    muscles,
    setBand: SET_BAND,
    trends,
  };
}
