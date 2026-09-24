// Un dia abierto en detalle, y la lista de todos los dias.
//
// La lista no pasa por assembleDay una vez por dia: serian cuatro consultas por cada
// cuadrito y noventa dias son trescientas sesenta. Lee los tres rangos de golpe y
// agrupa en memoria, que para un solo usuario es inmediato.

import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays, type DateRange, type IsoDate } from '../core/dates.ts';
import { storeScore, upsertDailyLog } from '../core/daily-log.ts';
import { reportDay, type DayReport } from '../core/day-report.ts';
import { dailyTotals, listPortionsBetween } from '../nutrition/index.ts';
import {
  averageRestSeconds,
  epleyE1rm,
  listSessionDates,
  listWorkingSets,
  loadSessionPlan,
  volumeLoad,
  type LoggedSet,
} from '../training/index.ts';
import type { CoreDailyLogRow, TrainingExerciseRow, TrainingSessionRow } from '../db/types.ts';

import { assembleDay, type AssembledDay } from './day.ts';

export type DayExercise = {
  exerciseId: string;
  name: string;
  /** El peso escrito es el de una mancuerna. */
  perSide: boolean;
  plannedSets: number | null;
  sets: LoggedSet[];
  volume: number;
  averageRestSeconds: number | null;
};

export type DayDetail = {
  day: AssembledDay;
  report: DayReport;
  exercises: DayExercise[];
  routineName: string | null;
  gymName: string | null;
  /** Minutos entre la primera serie y el final, cuando la sesion esta cerrada. */
  sessionMinutes: number | null;
};

async function sessionContext(
  db: SQLiteDatabase,
  session: TrainingSessionRow | null,
): Promise<{ routineName: string | null; gymName: string | null }> {
  if (session === null) return { routineName: null, gymName: null };

  const [routine, gym] = await Promise.all([
    session.routine_id
      ? db.getFirstAsync<{ name: string }>('SELECT name FROM training_routine WHERE id = ?;', [
          session.routine_id,
        ])
      : Promise.resolve(null),
    session.gym_id
      ? db.getFirstAsync<{ name: string }>('SELECT name FROM training_gym WHERE id = ?;', [
          session.gym_id,
        ])
      : Promise.resolve(null),
  ]);

  return { routineName: routine?.name ?? null, gymName: gym?.name ?? null };
}

export async function loadDayDetail(
  db: SQLiteDatabase,
  date: IsoDate,
  today: IsoDate,
): Promise<DayDetail> {
  const day = await assembleDay(db, date, today);

  const [names, plan, context] = await Promise.all([
    db.getAllAsync<Pick<TrainingExerciseRow, 'id' | 'name_es' | 'equipment_type'>>(
      'SELECT id, name_es, equipment_type FROM training_exercise;',
    ),
    day.session ? loadSessionPlan(db, day.session.id) : Promise.resolve([]),
    sessionContext(db, day.session),
  ]);

  const nameOf = new Map(names.map((row) => [row.id, row.name_es]));
  const plannedOf = new Map(plan.map((entry) => [entry.exerciseId, entry.sets]));

  // El orden es el de la sesion: el primer ejercicio que toco va primero.
  const order: string[] = [];
  const byExercise = new Map<string, LoggedSet[]>();
  for (const set of day.sessionSets) {
    const existing = byExercise.get(set.exerciseId);
    if (existing) existing.push(set);
    else {
      byExercise.set(set.exerciseId, [set]);
      order.push(set.exerciseId);
    }
  }

  const exercises: DayExercise[] = order.map((exerciseId) => {
    const sets = byExercise.get(exerciseId) ?? [];
    return {
      exerciseId,
      name: nameOf.get(exerciseId) ?? exerciseId,
      perSide: (sets[0]?.loadFactor ?? 1) > 1,
      plannedSets: plannedOf.get(exerciseId) ?? null,
      sets,
      volume: volumeLoad(sets),
      averageRestSeconds: averageRestSeconds(sets),
    };
  });

  const start = day.session?.start_time ?? null;
  const end = day.session?.end_time ?? null;

  return {
    day,
    report: reportDay({
      result: day.result,
      log: day.log,
      targets: day.targets,
      nutrition: day.nutrition,
      trained: day.trained,
      isTrainingDay: day.trained === true,
    }),
    exercises,
    ...context,
    sessionMinutes: start !== null && end !== null ? Math.round((end - start) / 60000) : null,
  };
}

export type DayRow = {
  date: IsoDate;
  score: number | null;
  hasData: boolean;
  trained: boolean;
  restDay: boolean;
  /** Carga total del dia, con las mancuernas contadas por las dos. */
  volume: number;
  proteinG: number | null;
  kcal: number | null;
};

/**
 * Un renglon por cada dia que dejo rastro, del mas nuevo al mas viejo. Un dia sin
 * nada no aparece: la lista es de lo que hizo, no del calendario.
 */
export async function listDayRows(db: SQLiteDatabase, range: DateRange): Promise<DayRow[]> {
  const [logs, sets, portions, sessionDates] = await Promise.all([
    db.getAllAsync<CoreDailyLogRow>(
      'SELECT * FROM core_daily_log WHERE date BETWEEN ? AND ? ORDER BY date;',
      [range.from, range.to],
    ),
    listWorkingSets(db, range),
    listPortionsBetween(db, range),
    listSessionDates(db, range),
  ]);

  const volumeByDate = new Map<IsoDate, number>();
  for (const set of sets) {
    volumeByDate.set(set.date, (volumeByDate.get(set.date) ?? 0) + volumeLoad([set]));
  }

  const trained = new Set(sessionDates);
  const dates = new Set<IsoDate>([
    ...logs.filter((log) => log.has_data === 1 || log.score !== null).map((log) => log.date),
    ...trained,
    ...portions.keys(),
  ]);

  const byDate = new Map(logs.map((log) => [log.date, log]));

  return [...dates]
    .sort()
    .reverse()
    .map((date) => {
      const log = byDate.get(date) ?? null;
      const eaten = portions.get(date);
      const totals = eaten && eaten.length > 0 ? dailyTotals(eaten) : null;
      return {
        date,
        score: log?.score ?? null,
        hasData: log?.has_data === 1 || trained.has(date) || totals !== null,
        trained: trained.has(date),
        restDay: log?.rest_day === 1,
        volume: volumeByDate.get(date) ?? 0,
        proteinG: totals?.proteinG ?? null,
        kcal: totals?.kcal ?? null,
      };
    });
}

export type RecordSort = 'recent' | 'score' | 'volume' | 'protein';

export const RECORD_SORTS: { id: RecordSort; label: string }[] = [
  { id: 'recent', label: 'reciente' },
  { id: 'score', label: 'mejor nota' },
  { id: 'volume', label: 'más carga' },
  { id: 'protein', label: 'más proteína' },
];

/**
 * Un dia sin ese dato nunca encabeza la lista: ordenar por proteina y ver arriba los
 * dias en los que no anoto nada seria justo al reves de lo que pidio.
 */
export function sortDayRows(rows: readonly DayRow[], sort: RecordSort): DayRow[] {
  const value = (row: DayRow): number | null => {
    if (sort === 'score') return row.score;
    if (sort === 'volume') return row.volume > 0 ? row.volume : null;
    if (sort === 'protein') return row.proteinG;
    return null;
  };

  const byDateDesc = (a: DayRow, b: DayRow) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  if (sort === 'recent') return [...rows].sort(byDateDesc);

  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null && right === null) return byDateDesc(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left || byDateDesc(a, b);
  });
}

export type RecordWindow = 'week' | 'month' | 'quarter' | 'all';

export const RECORD_WINDOWS: { id: RecordWindow; label: string; days: number | null }[] = [
  { id: 'week', label: '7 días', days: 7 },
  { id: 'month', label: '30 días', days: 30 },
  { id: 'quarter', label: '90 días', days: 90 },
  { id: 'all', label: 'todo', days: null },
];

/** El rango de una ventana, contando hoy como el ultimo dia. */
export function windowRange(window: RecordWindow, today: IsoDate): DateRange {
  const days = RECORD_WINDOWS.find((option) => option.id === window)?.days ?? null;
  // "Todo" empieza antes de que existiera la app, que es tan lejos como puede haber algo.
  return { from: days === null ? '2000-01-01' : addDays(today, -(days - 1)), to: today };
}

export type DayExport = {
  date: IsoDate;
  score: number | null;
  scoreBase: number | null;
  penalty: number;
  criteria: {
    id: string;
    weight: number;
    earned: number | null;
    value: string;
    target: string | null;
  }[];
  trained: boolean | null;
  restDay: boolean;
  log: CoreDailyLogRow | null;
  targets: unknown;
  training: unknown;
  nutrition: unknown;
};

/**
 * El dia entero desarmado, para el archivo que se exporta.
 *
 * El volcado de tablas ya tiene todo, pero tenerlo en crudo obliga a rehacer las
 * uniones y las formulas fuera de aqui, y ahi es donde dos copias de la misma regla
 * empiezan a no coincidir. Esto deja el dia ya resuelto: la nota y de donde sale,
 * las series con su 1RM estimado y su descanso, y los macros con su comida.
 */
export async function buildDayExports(db: SQLiteDatabase, today: IsoDate): Promise<DayExport[]> {
  const rows = await db.getAllAsync<{ date: IsoDate }>(
    `SELECT date FROM core_daily_log
      UNION SELECT date FROM training_session
      UNION SELECT date FROM nutrition_food_entry
      ORDER BY date;`,
  );

  const days: DayExport[] = [];
  for (const { date } of rows) {
    const detail = await loadDayDetail(db, date, today);
    const { day, report } = detail;

    days.push({
      date,
      score: report.score,
      scoreBase: report.base,
      penalty: report.penalty,
      criteria: report.lines.map((line) => ({
        id: line.id,
        weight: line.weight,
        earned: line.earned,
        value: line.value,
        target: line.target,
      })),
      trained: day.trained,
      restDay: day.log?.rest_day === 1,
      log: day.log,
      targets: day.targets,
      training:
        day.session === null
          ? null
          : {
              sessionId: day.session.id,
              routineId: day.session.routine_id,
              routineName: detail.routineName,
              gymId: day.session.gym_id,
              gymName: detail.gymName,
              timeBudget: day.session.time_budget,
              aloneOrPartner: day.session.alone_or_partner,
              crowding: day.session.crowding,
              retroactive: day.session.is_retroactive === 1,
              startTime: day.session.start_time,
              endTime: day.session.end_time,
              minutes: detail.sessionMinutes,
              volumeKg: day.sessionVolume,
              exercises: detail.exercises.map((exercise) => ({
                exerciseId: exercise.exerciseId,
                name: exercise.name,
                perSide: exercise.perSide,
                plannedSets: exercise.plannedSets,
                volumeKg: exercise.volume,
                averageRestSeconds: exercise.averageRestSeconds,
                sets: exercise.sets.map((set) => ({
                  setIndex: set.setIndex,
                  weightKg: set.weightKg,
                  loadFactor: set.loadFactor ?? 1,
                  reps: set.reps,
                  restBeforeSeconds: set.restBeforeSeconds ?? null,
                  timestamp: set.timestamp ?? null,
                  e1rmKg: epleyE1rm(set.weightKg, set.reps),
                })),
              })),
            },
      nutrition:
        day.nutrition === null
          ? null
          : {
              ...day.nutrition,
              entries: day.portions.map((portion) => ({
                entryId: portion.entryId,
                foodId: portion.food.id,
                name: portion.food.name,
                brand: portion.food.brand,
                quantity: portion.quantity,
                unit: portion.food.base_unit,
                mealSlot: portion.mealSlot,
                // La misma suma que el total del dia, aplicada a una sola entrada:
                // dos formulas para lo mismo terminan dando dos numeros distintos.
                macros: dailyTotals([portion]),
              })),
            },
    });
  }

  return days;
}

/**
 * Vuelve a puntuar los dias que quedaron sin nota.
 *
 * Un dia se puntua cuando se escribe, y hasta que no hay perfil no hay metas contra
 * las que medirlo, asi que todo lo anotado antes de llenar Ajustes quedaba gris para
 * siempre. Esto los recupera en el siguiente arranque. Los que siguen sin poder
 * puntuarse se vuelven a intentar, que es barato y son pocos: la ventana es la que
 * se ve en la cuadricula.
 */
export async function rescoreMissing(
  db: SQLiteDatabase,
  range: DateRange,
  today: IsoDate,
): Promise<number> {
  // Un dia dejo rastro en cualquiera de los tres sitios: el registro diario, un
  // entreno o algo que comio. Mirando solo el primero, un dia de puro entreno y
  // comida se quedaba gris para siempre.
  const pending = await db.getAllAsync<{ date: IsoDate }>(
    `SELECT DISTINCT date FROM (
       SELECT date FROM core_daily_log WHERE has_data = 1 AND score IS NULL
       UNION SELECT date FROM training_session
       UNION SELECT date FROM nutrition_food_entry
     )
     WHERE date BETWEEN ? AND ?
     ORDER BY date;`,
    [range.from, range.to],
  );

  let scored = 0;
  for (const { date } of pending) {
    const day = await assembleDay(db, date, today);
    if (day.result?.score == null) continue;
    // La nota vive en la fila del dia, asi que un dia sin fila necesita una.
    if (day.log === null) await upsertDailyLog(db, { date });
    await storeScore(db, date, day.result.score);
    scored += 1;
  }
  return scored;
}
