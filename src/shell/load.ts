// Todo lo que la app necesita para pintarse, leido de la base.
//
// Vive aparte del proveedor para que un test pueda contar lo que cuesta: la regla de las
// recargas se midio en consultas, y por eso nunca se vio que cada botella traia las
// cuatrocientas ofertas y noventa dias de comidas que una botella no puede cambiar.

import type { SQLiteDatabase } from 'expo-sqlite';

import {
  listDailyLogs,
  listScoreHistory,
  readLastWeight,
  storeScore,
  toWeighIns,
  upsertDailyLog,
} from '../core/daily-log.ts';
import type { LastWeight } from '../core/daily-log.ts';
import { addDays, todayIso, trailingDays, weekStart, type IsoDate } from '../core/dates.ts';
import type { ScoredDay } from '../core/heatmap.ts';
import { GRID_VISIBLE_WEEKS } from '../core/grid-history.ts';
import { loadScorePeriod } from './score-days.ts';
import type { StreakDay } from '../core/discipline.ts';
import { reEntryBanner, startsOnItsOwn, type ReEntryBanner } from '../core/re-entry.ts';
import {
  dealBlocklistFrom,
  stepsAdviceDeclinedFrom,
  stepsTargetFrom,
  profileFrom,
  readSettings,
  reEntryFrom,
  targetsChangeSeenFrom,
  weightUnitFrom,
  writeSetting,
  type Settings,
} from '../core/settings.ts';
import { parseDraft, type SessionDraft } from '../core/session-draft.ts';
import { listHealthImports } from '../core/health-import.ts';
import {
  backdateFirstSnapshot,
  latestTargetChange,
  recalculateTargets,
  setInitialTargets,
  type TargetChange,
} from '../core/snapshots.ts';
import { stepsAdvice, type StepsAdvice } from '../core/steps.ts';
import type { GymLocation } from '../core/geo.ts';
import type { WeightUnit } from '../core/units.ts';
import {
  listDeals,
  listDiscounts,
  listSources,
  watchWords,
  type DealWithContext,
} from '../deals/index.ts';
import type {
  CoreHealthImportRow,
  DealsDiscountRow,
  DealsSourceRow,
  NutritionBatchRow,
  NutritionContainerRow,
  NutritionFoodRow,
  TrainingRoutineRow,
} from '../db/types.ts';
import {
  listContainers,
  listFoods,
  listOpenBatches,
  loadFoodHistory,
  portionMacros,
  spoilageWarning,
  type FoodHistory,
  type PortionMacros,
  type SpoilageWarning,
} from '../nutrition/index.ts';
import {
  consecutiveMissedBefore,
  listGyms,
  listRoutines,
  listSessionDates,
  loadSessionPlan,
  OPEN_SESSION_CARRIES_MS,
  openSessionSince,
  parsePlannerDraft,
  trainingWeekStreak,
  type PlannedSet,
  type PlannerDraft,
} from '../training/index.ts';

import {
  assembleDay,
  exerciseContext,
  HISTORY_DAYS,
  type AssembledDay,
  type ExerciseContext,
} from './day.ts';
import { rescoreMissing, rescoreSettling } from './records.ts';

export const WEEKS_SHOWN = GRID_VISIBLE_WEEKS;

export type OpenBatch = {
  batch: NutritionBatchRow;
  food: NutritionFoodRow;
  macros: PortionMacros;
  spoilage: SpoilageWarning | null;
};

export type Loaded = {
  days: ScoredDay[];
  scoreHistory: StreakDay[];
  settings: Settings;
  unit: WeightUnit;
  readapting: ReEntryBanner | null;
  today: AssembledDay;
  containers: NutritionContainerRow[];
  foods: NutritionFoodRow[];
  /** Lo que ya anoto, que es lo que ordena la lista de alimentos. */
  foodHistory: FoodHistory;
  exercise: ExerciseContext;
  /** Spec 3.6: a recalculation he has not dismissed yet. */
  targetChange: TargetChange | null;
  batches: OpenBatch[];
  /** Spec 14.2: the next step stage, once three weeks have earned it. */
  steps: StepsAdvice | null;
  routines: TrainingRoutineRow[];
  gyms: GymLocation[];
  /** Spec 16.2: read from what is stored, so the tab works with no signal. */
  deals: DealWithContext[];
  discounts: DealsDiscountRow[];
  /** Spec 16.7: el estado se ve aunque no haya una sola oferta. */
  dealSources: DealsSourceRow[];
  /** Spec 8.3 rule 8: what today's session was approved to be, empty before it starts. */
  plan: PlannedSet[];
  /** El ultimo peso anotado, de cuando sea: no se pesa todos los dias. */
  lastWeight: LastWeight | null;
  /** Lo que quedo a medio escribir en el entreno de hoy, si la app se cerro. */
  sessionDraft: SessionDraft | null;
  /** Lo que eligio hoy antes de empezar, para que cerrar la app no se lo quite. */
  plannerDraft: PlannerDraft;
  /** Lo que llego hoy por el Atajo, para decir de donde salio el sueno y los pasos. */
  healthImports: CoreHealthImportRow[];
  /** Spec 4.4: semanas seguidas con las cinco sesiones, contando la de ahora si ya llego. */
  trainingStreak: number;
};

type DealSlice = Pick<Loaded, 'deals' | 'discounts' | 'dealSources'>;
type FoodSlice = Pick<Loaded, 'foods' | 'foodHistory'>;

/**
 * Lo que una recarga vuelve a leer ademas del dia.
 *
 * Las ofertas solo cambian al bajar la recoleccion, y lo comido solo al anotar comida:
 * ni una botella ni una serie los mueve, y releerlos era la mitad de las filas de cada
 * toque. Un dia nuevo los relee siempre, porque los dos dependen de que dia es hoy.
 */
export type Reread = { deals: boolean; foods: boolean };

export const REREAD_NOTHING: Reread = { deals: false, foods: false };
export const REREAD_FOODS: Reread = { deals: false, foods: true };
export const REREAD_DEALS: Reread = { deals: true, foods: false };
export const REREAD_ALL: Reread = { deals: true, foods: true };

/** Lo leido en una carga: las dos partes que no releyo vienen en null. */
export type Fresh = Omit<Loaded, keyof DealSlice | keyof FoodSlice> & {
  dealSlice: DealSlice | null;
  foodSlice: FoodSlice | null;
};

/**
 * Todo lo que la app necesita para pintarse, leido de una vez.
 *
 * `settle` es el trabajo de fondo que rehace notas de dias que no son hoy: cuesta
 * cientos de consultas y solo cambia algo cuando cambia una sesion, un descanso
 * marcado, el perfil o un dia pasado. Anotar una serie o un vaso de agua no lo
 * necesita, y pagarlo en cada tecla es lo que hacia que el numero tardara en salir.
 *
 * `shownDate` es el dia de lo que hay en pantalla, o null si no hay nada todavia.
 */
export async function load(
  db: SQLiteDatabase,
  exerciseId: string | null,
  settle: boolean,
  reread: Reread,
  shownDate: IsoDate | null,
): Promise<Fresh> {
  const today = todayIso();
  const from = weekStart(addDays(today, -(WEEKS_SHOWN - 1) * 7));
  const everything = shownDate !== today;

  let settings = await readSettings(db);
  const profile = profileFrom(settings);

  // Spec 6.5: una semana de dias con entreno pendiente sin ninguno enciende la
  // readaptacion. Antes de puntuar, para que hoy ya no cargue la falta.
  if (settle) {
    const sessionDates = await listSessionDates(db, {
      from: addDays(today, -HISTORY_DAYS),
      to: today,
    });
    const missed = consecutiveMissedBefore(sessionDates, today, HISTORY_DAYS);
    if (startsOnItsOwn(reEntryFrom(settings), today, sessionDates.at(-1) ?? null, missed)) {
      await writeSetting(db, 're_entry_started_on', today);
      settings = await readSettings(db);
    }
  }

  // Targets are settled before the day is scored, so today is judged against any
  // snapshot this load has just written rather than the one before it.
  if (profile) {
    const recent = await listDailyLogs(db, trailingDays(today, 7));
    const todayWeight = recent.find((log) => log.date === today)?.weight_kg;
    // Spec 3.1: the opening targets come from a weight he typed in.
    if (todayWeight) await setInitialTargets(db, todayWeight, profile, today);
    // Spec 3.6: after that, a kilo of drift in the rolling average moves them.
    await recalculateTargets(db, toWeighIns(recent), profile, today);
  }

  // Las metas tienen que cubrir tambien lo que ya estaba anotado cuando se lleno el
  // perfil, o esos dias no se pueden puntuar nunca.
  await backdateFirstSnapshot(db);

  const scored = await assembleDay(db, today, today);

  // Spec 6.6: the score is stored beside the day, so the grid reads it back rather
  // than recomputing every cell on every render.
  // Spec 4.1 da 22 de los 100 puntos a entrenar, asi que un dia que entreno es un
  // dia con datos aunque no haya registrado nada mas. Sin esto el cuadrito quedaba
  // vacio despues de una sesion de verdad, que es justo lo que le paso.
  const hasTodayData = scored.log !== null || scored.trained === true || scored.nutrition !== null;
  if (hasTodayData && !scored.log) {
    await upsertDailyLog(db, { date: today });
  }
  if (hasTodayData) {
    await storeScore(db, today, scored.result?.score ?? null);
  }

  // Una sesion de anoche que sigue abierta se sigue viendo y anotando en Entreno. Sus
  // series son de su dia y se puntuan ahi: hoy solo presta lo que se pinta.
  const assembled = await withOpenSession(db, scored, today);

  if (settle) {
    // Rellenar el perfil hoy tiene que arreglar los dias de antes tambien: hasta que
    // hubo metas, todo lo anotado se guardo sin nota y la cuadricula los pintaba grises.
    await rescoreMissing(db, { to: today }, today);
    // Y los ultimos siete se rehacen aunque ya tengan nota: un descanso marcado gana los
    // puntos del entreno cuando la semana que lo rodea llega a las cinco sesiones, y eso
    // pasa dias despues de ese dia.
    await rescoreSettling(db, today);
  }

  const [{ days, logs }, scoreHistory, containers, exercise, change, openBatches, routines, plan] =
    await Promise.all([
      loadScorePeriod(db, { from, to: today }),
      listScoreHistory(db, today),
      listContainers(db),
      exerciseContext(db, assembled, exerciseId),
      latestTargetChange(db),
      listOpenBatches(db),
      listRoutines(db),
      assembled.session ? loadSessionPlan(db, assembled.session.id) : Promise.resolve([]),
    ]);

  const foodSlice: FoodSlice | null =
    everything || reread.foods
      ? { foods: await listFoods(db), foodHistory: await loadFoodHistory(db, today) }
      : null;

  const gyms = await listGyms(db);
  const lastWeight = await readLastWeight(db);
  const healthImports = await listHealthImports(db, today);
  // Toda la historia, porque la racha no tiene tope; son solo las fechas con sesion.
  const trainingStreak = trainingWeekStreak(
    await listSessionDates(db, { from: '0000-01-01', to: today }),
    today,
  );
  const dealSlice: DealSlice | null =
    everything || reread.deals
      ? {
          deals: await listDeals(db, today, watchWords(dealBlocklistFrom(settings))),
          discounts: await listDiscounts(db),
          dealSources: await listSources(db),
        }
      : null;

  const batches: OpenBatch[] = openBatches.map(({ batch, food }) => ({
    batch,
    food,
    macros: portionMacros(batch, food),
    spoilage: spoilageWarning(batch, today),
  }));

  return {
    scoreHistory,
    days,
    settings,
    unit: weightUnitFrom(settings),
    readapting: reEntryBanner(reEntryFrom(settings), today),
    today: assembled,
    containers,
    exercise,
    targetChange:
      change && change.effectiveFrom !== targetsChangeSeenFrom(settings) ? change : null,
    steps: (() => {
      const advice = stepsAdvice(logs, stepsTargetFrom(settings), today);
      return advice && advice.next !== stepsAdviceDeclinedFrom(settings) ? advice : null;
    })(),
    batches,
    routines,
    gyms,
    plan,
    lastWeight,
    sessionDraft: parseDraft(settings.get('session_draft'), assembled.session?.id ?? null),
    plannerDraft: parsePlannerDraft(settings.get('planner_draft'), today),
    healthImports,
    trainingStreak,
    dealSlice,
    foodSlice,
  };
}

async function withOpenSession(
  db: SQLiteDatabase,
  day: AssembledDay,
  today: IsoDate,
): Promise<AssembledDay> {
  if (day.session !== null) return day;
  const open = await openSessionSince(db, Date.now() - OPEN_SESSION_CARRIES_MS);
  if (open === null || open.date === today) return day;
  const itsDay = await assembleDay(db, open.date, today);
  return {
    ...day,
    session: itsDay.session,
    sessionSets: itsDay.sessionSets,
    sessionVolume: itsDay.sessionVolume,
  };
}

/**
 * Lo recien leido sobre lo que hay en pantalla en el momento de pintarlo, no en el de
 * empezar a leer: las ofertas que bajaron mientras tanto no se pisan con las de antes.
 */
export function withFresh(current: Loaded | null, fresh: Fresh): Loaded {
  const { dealSlice, foodSlice, ...day } = fresh;
  const deals = dealSlice ?? current;
  const foods = foodSlice ?? current;
  // Solo se salta una parte cuando habia algo en pantalla; si no lo hay, la carga se
  // decidio con otra pantalla y lo que se pintara estaria incompleto.
  if (deals === null || foods === null) {
    throw new Error('a reload skipped the deals or the meals with nothing on screen to keep');
  }
  return {
    ...day,
    deals: deals.deals,
    discounts: deals.discounts,
    dealSources: deals.dealSources,
    foods: foods.foods,
    foodHistory: foods.foodHistory,
  };
}
