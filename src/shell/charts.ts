// Los datos que dibujan las graficas.
//
// Nada aqui calcula nada nuevo: son las mismas formulas del resto de la app leidas
// a lo largo del tiempo en vez de para un dia. Una grafica que no coincide con el
// numero de la pantalla de al lado es peor que no tenerla.

import type { SQLiteDatabase } from 'expo-sqlite';

import { listDailyLogs, toWeighIns } from '../core/daily-log.ts';
import { trailingDays, type IsoDate } from '../core/dates.ts';
import { SLEEP_FULL_MINUTES } from '../core/discipline.ts';
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

export type MuscleSource = {
  exercise: string;
  sets: number;
  /** Los dias en que lo entreno, para poder decir cuando y no solo cuanto. */
  days: IsoDate[];
};

export type MuscleBar = {
  muscle: string;
  sets: number;
  /** Que ejercicios sumaron esas series directas, de mas a menos. */
  sources: MuscleSource[];
};

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
  /** Los minutos de cada noche y los pasos de cada dia, que tambien son nota. */
  sleep: Point[];
  steps: Point[];
  proteinBand: Band | null;
  kcalBand: Band | null;
  /**
   * Las tres con la de proteina son bandas con suelo y sin techo de verdad: dormir,
   * caminar o comer proteina de mas no esta fuera de sitio, asi que el techo es el mejor
   * dia, solo para pintar la zona.
   */
  sleepBand: Band | null;
  stepsBand: Band | null;
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

  const sleep: Point[] = logs
    .filter((log) => log.sleep_minutes !== null)
    .map((log) => ({ date: log.date, value: log.sleep_minutes as number }));

  const steps: Point[] = logs
    .filter((log) => log.steps !== null)
    .map((log) => ({ date: log.date, value: log.steps as number }));

  /** Del suelo para arriba esta bien, asi que el techo es solo lo que hay que pintar. */
  const floorBand = (from: number, points: Point[]): Band => ({
    from,
    to: Math.max(from, ...points.map((point) => point.value)),
  });

  const protein: Point[] = [];
  const kcal: Point[] = [];
  for (const [date, eaten] of [...portions.entries()].sort()) {
    if (eaten.length === 0) continue;
    const totals = dailyTotals(eaten);
    protein.push({ date, value: totals.proteinG });
    kcal.push({ date, value: totals.kcal });
  }

  const nameOf = new Map(names.map((row) => [row.id, row.name_es]));

  // Las series directas de cada musculo, repartidas por ejercicio y por dia: la barra
  // dice cuanto y esto dice de donde salio, que es lo que se pregunta despues.
  const sourcesByMuscle = new Map<string, Map<string, { sets: number; days: Set<IsoDate> }>>();
  for (const set of weekSets) {
    for (const share of muscleMap.get(set.exerciseId) ?? []) {
      if (share.contribution !== 1) continue;
      const byExercise = sourcesByMuscle.get(share.muscle) ?? new Map();
      const current = byExercise.get(set.exerciseId) ?? { sets: 0, days: new Set<IsoDate>() };
      current.sets += 1;
      current.days.add(set.date);
      byExercise.set(set.exerciseId, current);
      sourcesByMuscle.set(share.muscle, byExercise);
    }
  }

  const counts = setCountsByMuscle(weekSets, muscleMap);
  const muscles: MuscleBar[] = [...counts.entries()]
    .map(([muscle, count]) => ({
      muscle,
      sets: count.direct,
      sources: [...(sourcesByMuscle.get(muscle)?.entries() ?? [])]
        .map(([exerciseId, source]) => ({
          exercise: nameOf.get(exerciseId) ?? exerciseId,
          sets: source.sets,
          days: [...source.days].sort(),
        }))
        .sort((a, b) => b.sets - a.sets),
    }))
    .filter((bar) => bar.sets > 0)
    .sort((a, b) => b.sets - a.sets);
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
    sleep,
    steps,
    // La nota del sueno llega a los veinte puntos en ocho horas (spec 4.1) y su meta
    // personal es el suelo: entre las dos esta la franja que de verdad busca.
    sleepBand: targets
      ? floorBand(Math.min(targets.sleepMinutes, SLEEP_FULL_MINUTES), sleep)
      : null,
    stepsBand: targets ? floorBand(targets.steps, steps) : null,
    // Con suelo y sin techo, como el sueno y los pasos: comerse 180 g de proteina no
    // esta fuera de sitio, y una banda cerrada lo pintaba como si lo estuviera.
    proteinBand: targets ? floorBand(proteinBand(targets).from, protein) : null,
    kcalBand: targets
      ? { from: Math.round(kcalBand(targets).from), to: Math.round(kcalBand(targets).to) }
      : null,
    muscles,
    setBand: SET_BAND,
    trends,
  };
}
