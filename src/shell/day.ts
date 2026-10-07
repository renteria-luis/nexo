// The shell assembling a day out of the modules. Spec 17.1: the app is a shell
// hosting independent modules, and this is where they meet. It calls each module's
// public read interface and never reaches into their tables, which is the boundary
// rule in spec 17.4.

import type { SQLiteDatabase } from 'expo-sqlite';

import { readDailyLog, toDisciplineDay } from '../core/daily-log.ts';
import { addDays, type IsoDate } from '../core/dates.ts';
import { scoreDay, type DisciplineResult, type SessionEffort } from '../core/discipline.ts';
import { comparisonFloor, isReEntryActive } from '../core/re-entry.ts';
import { readSettings, reEntryFrom } from '../core/settings.ts';
import { targetsInForceOn } from '../core/snapshots.ts';
import type { TargetValues } from '../core/targets.ts';
import type { CoreDailyLogRow, TrainingSessionRow } from '../db/types.ts';
import {
  dailyTotals,
  listPortions,
  type LoggedPortion,
  type NutritionTotals,
} from '../nutrition/index.ts';
import {
  bestAndWorstE1rm,
  consecutiveMissedBefore,
  getSessionOn,
  lastSessionSets,
  listExercises,
  listSessionDates,
  listWorkingSets,
  loadExerciseMuscles,
  loadSessionPlan,
  marksWindow,
  sessionEffort,
  sessionsInBestWeekAround,
  sessionsInTrailingWeek,
  trainedOn,
  volumeLoad,
  type CatalogExercise,
  type E1rmMark,
  type LoggedSet,
} from '../training/index.ts';

/** How far back the missed training run is allowed to reach. */
export const HISTORY_DAYS = 60;

export type AssembledDay = {
  date: IsoDate;
  log: CoreDailyLogRow | null;
  targets: TargetValues | null;
  nutrition: NutritionTotals | null;
  portions: LoggedPortion[];
  /** Null when there are no targets yet, because nothing can be scored against nothing. */
  result: DisciplineResult | null;
  trained: boolean | null;
  /** Lo que movio la sesion de ese dia, o null si no hubo. */
  effort: SessionEffort | null;
  /** Spec 4.3: la mejor semana que contiene el dia, que es la que decide si un descanso marcado gana sus puntos. */
  bestWeekSessions: number;
  reEntryActive: boolean;
  session: TrainingSessionRow | null;
  sessionSets: LoggedSet[];
  sessionVolume: number;
};

export async function assembleDay(
  db: SQLiteDatabase,
  date: IsoDate,
  today: IsoDate,
): Promise<AssembledDay> {
  const [log, targets, settings, portions, sessionDates, session] = await Promise.all([
    readDailyLog(db, date),
    targetsInForceOn(db, date),
    readSettings(db),
    listPortions(db, date),
    // Hasta seis dias despues: un descanso marcado gana sus puntos cuando la semana
    // llega a las cinco sesiones, y esas sesiones pueden ser posteriores al dia.
    listSessionDates(db, { from: addDays(date, -HISTORY_DAYS), to: addDays(date, 6) }),
    getSessionOn(db, date),
  ]);

  const sessionSets = session ? await listWorkingSets(db, { from: date, to: date }) : [];
  // Spec 4.1: los 22 puntos del entreno salen de lo que movio contra lo que tocaba,
  // asi que hace falta el plan de esa sesion y a que musculos toca cada ejercicio.
  const [plan, muscles] = session
    ? await Promise.all([loadSessionPlan(db, session.id), loadExerciseMuscles(db)])
    : [[], new Map()];
  const effort = session
    ? sessionEffort(
        sessionSets,
        plan.map((entry) => ({ exerciseId: entry.exerciseId, setsPlanned: entry.sets })),
        muscles,
      )
    : null;

  // A day still open has not failed to train yet; a day already past did.
  const trained = trainedOn(sessionDates, date) ? true : date < today ? false : null;

  // Nothing eaten is not the same as eating nothing. An empty log leaves the two
  // food criteria without data rather than scoring them as a zero gram day.
  const nutrition = portions.length > 0 ? dailyTotals(portions) : null;

  const reEntryActive = isReEntryActive(reEntryFrom(settings), date);
  const sessionsLastSevenDays = sessionsInTrailingWeek(sessionDates, date);
  const bestWeekSessions = sessionsInBestWeekAround(sessionDates, date);

  const result = targets
    ? scoreDay(
        toDisciplineDay(log, {
          trained,
          effort,
          proteinG: nutrition?.proteinG ?? null,
          kcal: nutrition?.kcal ?? null,
          isTrainingDay: trained === true,
        }),
        targets,
        {
          sessionsLastSevenDays,
          bestWeekSessions,
          consecutiveMissed: consecutiveMissedBefore(sessionDates, date, HISTORY_DAYS),
          isScheduledRestDay: log?.rest_day === 1,
          reEntryActive,
        },
      )
    : null;

  return {
    date,
    log,
    targets,
    nutrition,
    portions,
    result,
    trained,
    effort,
    bestWeekSessions,
    reEntryActive,
    session,
    sessionSets,
    sessionVolume: volumeLoad(sessionSets),
  };
}

export type ExerciseContext = {
  exercises: CatalogExercise[];
  todaySets: LoggedSet[];
  lastSets: LoggedSet[];
  marks: { best: E1rmMark; worst: E1rmMark } | null;
};

/**
 * What spec 6.4 puts in front of him for one exercise: what he did last time, and
 * the best and worst estimated 1RM of the last eight weeks. While re-entry is on,
 * spec 6.5 pulls that window forward to the day he came back, so a deliberate 70%
 * deload is never measured against pre-layoff marks.
 */
export async function exerciseContext(
  db: SQLiteDatabase,
  day: AssembledDay,
  exerciseId: string | null,
  fallbackGymId = 'fanshawe',
): Promise<ExerciseContext> {
  // Spec 5.1: the weight step is the one on the machine in front of him, so the
  // catalogue is read for the gym this session is actually at.
  const exercises = await listExercises(db, day.session?.gym_id ?? fallbackGymId);
  if (!exerciseId) return { exercises, todaySets: [], lastSets: [], marks: null };

  const settings = await readSettings(db);
  const window = marksWindow(day.date, comparisonFloor(reEntryFrom(settings), day.date));

  const [lastSets, windowSets] = await Promise.all([
    lastSessionSets(db, exerciseId, day.session?.id ?? null),
    listWorkingSets(db, window, exerciseId),
  ]);

  return {
    exercises,
    todaySets: day.sessionSets.filter(
      (set) => set.exerciseId === exerciseId && set.sessionId === day.session?.id,
    ),
    lastSets,
    marks: bestAndWorstE1rm(windowSets),
  };
}

/** Lo que se sabe de una serie en el momento de tocar "Serie", antes de que la base conteste. */
export type TappedSet = Pick<LoggedSet, 'sessionId' | 'exerciseId' | 'weightKg' | 'reps'> & {
  rpe: number | null;
  timestamp: number;
};

/**
 * La serie recien tocada, puesta ya en lo cargado.
 *
 * Hasta que llegaba la recarga, la lista seguia sin ella: los campos volvian a proponer la
 * serie de antes, el boton seguia encendido, y un segundo toque anotaba una serie que no
 * hizo, con los numeros de la anterior. Con la serie puesta, la cuenta, la lista y lo que
 * proponen los campos para la siguiente salen de aqui; la recarga trae despues lo que la
 * base calculo (el descanso, el volumen con las dos mancuernas).
 */
export function withTappedSet<T extends { today: AssembledDay; exercise: ExerciseContext }>(
  loaded: T,
  set: TappedSet,
): T {
  const sameExercise = loaded.today.sessionSets.filter(
    (logged) => logged.sessionId === set.sessionId && logged.exerciseId === set.exerciseId,
  );
  const logged: LoggedSet = {
    sessionId: set.sessionId,
    // La de anoche, si es la sesion que sigue abierta despues de medianoche.
    date: loaded.today.session?.date ?? loaded.today.date,
    exerciseId: set.exerciseId,
    setIndex: Math.max(0, ...sameExercise.map((one) => one.setIndex)) + 1,
    weightKg: set.weightKg,
    reps: set.reps,
    rpe: set.rpe,
    timestamp: set.timestamp,
    restBeforeSeconds: null,
  };
  // Las series de hoy del ejercicio abierto: si las que hay son de otro, este no es el abierto.
  const open = loaded.exercise.todaySets.every((one) => one.exerciseId === set.exerciseId);
  return {
    ...loaded,
    today: { ...loaded.today, sessionSets: [...loaded.today.sessionSets, logged] },
    exercise: open
      ? { ...loaded.exercise, todaySets: [...loaded.exercise.todaySets, logged] }
      : loaded.exercise,
  };
}
