// Los datos que dibujan las graficas.
//
// Nada aqui calcula nada nuevo: son las mismas formulas del resto de la app leidas
// a lo largo del tiempo en vez de para un dia. Una grafica que no coincide con el
// numero de la pantalla de al lado es peor que no tenerla.

import type { SQLiteDatabase } from 'expo-sqlite';

import { listDailyLogs, toWeighIns } from '../core/daily-log.ts';
import { isWithin, trailingDays, type IsoDate } from '../core/dates.ts';
import { SLEEP_FULL_MINUTES } from '../core/discipline.ts';
import { targetsInForceOn } from '../core/snapshots.ts';
import { kcalBand, proteinBand, rollingWeightAverage } from '../core/targets.ts';
import { dailyTotals, listPortionsBetween } from '../nutrition/index.ts';
import {
  epleyE1rm,
  listSessionTimes,
  listWorkingSets,
  loadExerciseMuscles,
  setCountsByMuscle,
  setLoad,
} from '../training/index.ts';

import { saturationSeries } from '../core/creatine.ts';

import { SET_BAND } from './week.ts';

/** Los recortes de tiempo, dichos como los eligio. */
const BUDGET_ES: Record<string, string> = {
  completo: 'completo',
  minus_25: '25% menos',
  minus_50: '50% menos',
  express: 'express',
};

export type Point = {
  date: IsoDate;
  value: number;
  /** Lo que el globito dice ademas del numero: de que fue ese dia. */
  note?: string;
};
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

/**
 * Las formas de mirar el progreso de un ejercicio. No sobran: cada una contesta una
 * pregunta distinta y las cuatro primeras se mueven por separado.
 *
 * - `volume` es el trabajo total del dia (peso por repeticiones, todas las series), que
 *   sube al meter otra serie aunque el peso no se mueva.
 * - `topWeight` es el peso mas alto que cargo, tal como lo escribio: con mancuernas, el
 *   de una. Es lo que contesta "¿ya subi de 90 a 95?".
 * - `e1rm` es lo que levantaria una sola vez, estimado sobre su mejor serie: compara
 *   dias con repeticiones distintas, que el peso suelto no puede.
 * - `intensity` es el peso medio por repeticion (volumen entre repeticiones): dice si el
 *   dia fue pesado o largo, que es la diferencia entre fuerza e hipertrofia.
 * - `reps` y `sets` son el trabajo contado, que es como se mide el volumen semanal por
 *   musculo en spec 13.2.
 */
export type ExerciseTrend = {
  exerciseId: string;
  name: string;
  volume: Point[];
  topWeight: Point[];
  e1rm: Point[];
  intensity: Point[];
  reps: Point[];
  sets: Point[];
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
  /**
   * Lo que duro cada dia en el gym, solo de las sesiones cuya hora marco como buena
   * (migracion 050). Sin ese filtro la grafica mide cuando se acordo de cerrar el
   * entreno, no cuanto entreno.
   */
  gymMinutes: Point[];
  /**
   * Cuanta creatina lleva el musculo, de 0 a 100, estimada dia a dia (`core/creatine.ts`).
   * Se calcula desde el primer dia que la anoto y no desde el principio de la ventana:
   * el deposito que tiene hoy viene de las semanas de antes.
   */
  creatine: Point[];
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

  const [logs, portions, sets, weekSets, muscleMap, targets, names, times, creatineLog] =
    await Promise.all([
      listDailyLogs(db, range),
      listPortionsBetween(db, range),
      listWorkingSets(db, range),
      listWorkingSets(db, week),
      loadExerciseMuscles(db),
      targetsInForceOn(db, today),
      db.getAllAsync<{ id: string; name_es: string }>('SELECT id, name_es FROM training_exercise;'),
      listSessionTimes(db),
      // Toda la historia, no la ventana: el deposito de hoy lo llenaron las semanas de
      // antes, y empezar la cuenta en el borde de la grafica lo pintaria vacio.
      db.getAllAsync<{ date: IsoDate; creatine_taken: number | null }>(
        `SELECT date, creatine_taken FROM core_daily_log
        WHERE creatine_taken IS NOT NULL ORDER BY date;`,
      ),
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
    const trend: Omit<ExerciseTrend, 'exerciseId' | 'name'> = {
      volume: [],
      topWeight: [],
      e1rm: [],
      intensity: [],
      reps: [],
      sets: [],
    };

    for (const [date, daySets] of [...byDate.entries()].sort()) {
      const totalReps = daySets.reduce((total, set) => total + set.reps, 0);
      // El volumen cuenta las dos mancuernas (`setLoad`), que es la convencion de toda
      // la app; el peso maximo es el numero que el escribio, que es el que lee en el
      // disco o en la maquina.
      const moved = daySets.reduce((total, set) => total + setLoad(set as never) * set.reps, 0);
      const heaviest = Math.max(...daySets.map((set) => set.weightKg));
      const note = `${daySets.length} ${daySets.length === 1 ? 'serie' : 'series'} · ${totalReps} reps`;

      const best = bestE1rmOfDay(daySets);
      if (best !== null) trend.e1rm.push({ date, value: best, note });
      if (moved > 0) trend.volume.push({ date, value: moved, note });
      if (heaviest > 0) trend.topWeight.push({ date, value: heaviest, note });
      if (moved > 0 && totalReps > 0) {
        trend.intensity.push({ date, value: moved / totalReps, note });
      }
      trend.reps.push({ date, value: totalReps, note });
      trend.sets.push({ date, value: daySets.length, note });
    }

    // Un solo punto no es una tendencia, es un punto.
    if (trend.sets.length >= 2) {
      trends.push({ exerciseId, name: nameOf.get(exerciseId) ?? exerciseId, ...trend });
    }
  }
  trends.sort((a, b) => b.sets.length - a.sets.length);

  const gymMinutes: Point[] = times
    .filter((session) => session.trusted && session.minutes > 0 && isWithin(session.date, range))
    .map((session) => ({
      date: session.date,
      value: session.minutes,
      note: [session.routineName ?? 'sin rutina', BUDGET_ES[session.budget] ?? session.budget]
        .filter(Boolean)
        .join(' · '),
    }));

  const creatine = saturationSeries(
    creatineLog.map((row) => ({ date: row.date, taken: row.creatine_taken === 1 })),
    today,
  )
    .filter((day) => isWithin(day.date, range))
    .map((day) => ({ date: day.date, value: Math.round(day.value * 100) }));

  return {
    from: range.from,
    to: range.to,
    creatine,
    gymMinutes,
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
