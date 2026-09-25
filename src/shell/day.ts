// The shell assembling a day out of the modules. Spec 17.1: the app is a shell
// hosting independent modules, and this is where they meet. It calls each module's
// public read interface and never reaches into their tables, which is the boundary
// rule in spec 17.4.

import type { SQLiteDatabase } from 'expo-sqlite';

import { readDailyLog, toDisciplineDay } from '../core/daily-log.ts';
import { addDays, type IsoDate } from '../core/dates.ts';
import { scoreDay, type DisciplineResult } from '../core/discipline.ts';
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
  marksWindow,
  sessionsInBestWeekAround,
  sessionsInTrailingWeek,
  trainedOn,
  volumeLoad,
  type CatalogExercise,
  type E1rmMark,
  type LoggedSet,
} from '../training/index.ts';

/** How far back the missed training run is allowed to reach. */
const HISTORY_DAYS = 60;

export type AssembledDay = {
  date: IsoDate;
  log: CoreDailyLogRow | null;
  targets: TargetValues | null;
  nutrition: NutritionTotals | null;
  portions: LoggedPortion[];
  /** Null when there are no targets yet, because nothing can be scored against nothing. */
  result: DisciplineResult | null;
  trained: boolean | null;
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
    todaySets: day.sessionSets.filter((set) => set.exerciseId === exerciseId),
    lastSets,
    marks: bestAndWorstE1rm(windowSets),
  };
}
