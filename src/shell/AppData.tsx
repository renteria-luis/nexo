// One place that owns the loaded day and the writes against it, so every screen
// reads the same thing and a write from any of them refreshes all of them.
//
// The shell composes the modules here (spec 17.1). Screens never touch the
// database directly, which is what keeps the boundary rules of spec 17.4 true in
// practice rather than only on paper.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import {
  listDailyLogs,
  readDailyLog,
  readLastWeight,
  storeScore,
  toWeighIns,
  upsertDailyLog,
  type DailyLogEntry,
  type LastWeight,
} from '../core/daily-log.ts';
import { addDays, todayIso, trailingDays, weekStart, type IsoDate } from '../core/dates.ts';
import type { ScoredDay } from '../core/heatmap.ts';
import type { PaletteId } from '../core/palettes.ts';
import { reEntryBanner, type ReEntryBanner } from '../core/re-entry.ts';
import {
  clearSetting,
  paletteFrom,
  stepsAdviceDeclinedFrom,
  stepsTargetFrom,
  profileFrom,
  readSettings,
  reEntryFrom,
  targetsChangeSeenFrom,
  weightUnitFrom,
  writeSetting,
  type SettingKey,
  type Settings,
} from '../core/settings.ts';
import {
  addReading,
  endExperiment,
  listExperiments,
  startExperiment,
  type ExperimentWithReadings,
  type NewExperiment,
} from '../core/experiments.ts';
import type { GymLocation } from '../core/geo.ts';
import { listDeals, listDiscounts, listSources, type DealWithContext } from '../deals/index.ts';
import { stepsAdvice, type StepsAdvice } from '../core/steps.ts';
import { listStudies } from '../core/studies.ts';
import {
  backdateFirstSnapshot,
  latestTargetChange,
  recalculateTargets,
  setInitialTargets,
  type TargetChange,
} from '../core/snapshots.ts';
import type { ImportResult } from '../core/backup.ts';
import { parseDraft, serializeDraft, type SessionDraft } from '../core/session-draft.ts';
import type { WeightUnit } from '../core/units.ts';
import { openDatabase, resetDatabase } from '../db/index.ts';
import type {
  Company,
  CoreStudyRow,
  DealsDiscountRow,
  DealsSourceRow,
  TrainingRoutineRow,
  NutritionBatchRow,
  NutritionContainerRow,
  NutritionFoodRow,
} from '../db/types.ts';
import {
  addFoodEntry,
  addFood as addFoodToCatalog,
  addFoodFromLabel,
  datesWithFood,
  loadFoodHistory,
  updateFood,
  consumeBatchPortion,
  createBatch,
  deleteFoodEntry,
  listContainers,
  listFoods,
  listOpenBatches,
  portionMacros,
  spoilageWarning,
  type LabelFood,
  type FoodEdit,
  type FoodHistory,
  type LastMeal,
  type NewFood,
  type NewFoodEntry,
  type PortionMacros,
  type SpoilageWarning,
} from '../nutrition/index.ts';
import {
  addSet,
  deleteSet,
  finishSession,
  listGyms,
  listRoutines,
  listSessionDates,
  loadRoutinePlan,
  loadSessionPlan,
  saveSessionPlan,
  getSessionOn,
  setSessionDetails,
  setSessionRoutine,
  startSession,
  type SessionDetails,
  type PlannedExercise,
  type PlannedSet,
  type RoutinePlan,
  type TimeBudget,
} from '../training/index.ts';

import { exportToFile, importFromFile, type ExportOutcome } from './backup-file.ts';
import { WATER_ACTION_ML } from '../core/nudges.ts';
import { listenToNudges, syncNudges } from './notifications.ts';
import { recordNudgeAction } from './nudges.ts';
import { loadCharts as loadChartsData, type ChartsData } from './charts.ts';
import {
  listDayRows,
  loadDayDetail,
  rescoreDays,
  rescoreMissing,
  rescoreSettling,
  windowRange,
  type DayDetail,
  type DayRow,
  type RecordWindow,
} from './records.ts';
import { assembleDay, exerciseContext, type AssembledDay, type ExerciseContext } from './day.ts';
import { syncDeals, type SyncOutcome } from './deals.ts';
import { locateGym, type LocationOutcome } from './location.ts';
import { loadWeekSummary, type WeekSummary } from './week.ts';

export const WEEKS_SHOWN = 12;

export type OpenBatch = {
  batch: NutritionBatchRow;
  food: NutritionFoodRow;
  macros: PortionMacros;
  spoilage: SpoilageWarning | null;
};

export type BatchStart = {
  /** A food already in the catalogue, or one typed in from its package label. */
  food: { foodId: string } | { label: LabelFood };
  rawWeightG: number;
  portionsCount: number;
  fatDrained: boolean;
};

export type Loaded = {
  days: ScoredDay[];
  settings: Settings;
  palette: PaletteId;
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
};

export type AppState =
  { phase: 'opening' } | { phase: 'ready'; loaded: Loaded } | { phase: 'failed'; message: string };

async function load(exerciseId: string | null): Promise<Loaded> {
  const db = await openDatabase();
  const today = todayIso();
  const from = weekStart(addDays(today, -(WEEKS_SHOWN - 1) * 7));

  const settings = await readSettings(db);
  const profile = profileFrom(settings);

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

  const assembled = await assembleDay(db, today, today);

  // Spec 6.6: the score is stored beside the day, so the grid reads it back rather
  // than recomputing every cell on every render.
  // Spec 4.1 da 22 de los 100 puntos a entrenar, asi que un dia que entreno es un
  // dia con datos aunque no haya registrado nada mas. Sin esto el cuadrito quedaba
  // vacio despues de una sesion de verdad, que es justo lo que le paso.
  if (assembled.trained === true && !assembled.log) {
    await upsertDailyLog(db, { date: today });
  }
  if (assembled.log || assembled.trained === true) {
    await storeScore(db, today, assembled.result?.score ?? null);
  }

  // Rellenar el perfil hoy tiene que arreglar los dias de antes tambien: hasta que
  // hubo metas, todo lo anotado se guardo sin nota y la cuadricula los pintaba grises.
  await rescoreMissing(db, { from, to: today }, today);
  // Y los ultimos siete se rehacen aunque ya tengan nota: un descanso marcado gana los
  // puntos del entreno cuando la semana que lo rodea llega a las cinco sesiones, y eso
  // pasa dias despues de ese dia.
  await rescoreSettling(db, today);

  const [logs, containers, foods, foodHistory, exercise, change, openBatches, routines, plan] =
    await Promise.all([
      listDailyLogs(db, { from, to: today }),
      listContainers(db),
      listFoods(db),
      loadFoodHistory(db, today),
      exerciseContext(db, assembled, exerciseId),
      latestTargetChange(db),
      listOpenBatches(db),
      listRoutines(db),
      assembled.session ? loadSessionPlan(db, assembled.session.id) : Promise.resolve([]),
    ]);

  // Los avisos de los proximos dias se rehacen con lo que acaba de anotar. No se
  // espera: programar en iOS no tiene por que retrasar lo que ya se puede pintar.
  void syncNudges(db, today).catch((error: unknown) => console.error(error));

  const gyms = await listGyms(db);
  const lastWeight = await readLastWeight(db);
  const trainedDates = new Set(await listSessionDates(db, { from, to: today }));
  const [deals, discounts, dealSources] = await Promise.all([
    listDeals(db, today),
    listDiscounts(db),
    listSources(db),
  ]);

  const batches: OpenBatch[] = openBatches.map((batch) => {
    const food = foods.find((item) => item.id === batch.food_id);
    if (!food) throw new Error(`batch ${batch.id} points at food ${batch.food_id}, which is gone`);
    return {
      batch,
      food,
      macros: portionMacros(batch, food),
      spoilage: spoilageWarning(batch, today),
    };
  });

  return {
    days: (() => {
      const byDate = new Map(logs.map((log) => [log.date, log]));
      const dates = [...new Set([...byDate.keys(), ...trainedDates])].sort();
      return dates.map((date) => {
        const log = byDate.get(date);
        return {
          date,
          score: log?.score ?? null,
          hasData: log?.has_data === 1 || trainedDates.has(date),
        };
      });
    })(),
    settings,
    palette: paletteFrom(settings),
    unit: weightUnitFrom(settings),
    readapting: reEntryBanner(reEntryFrom(settings), today),
    today: assembled,
    containers,
    foods,
    foodHistory,
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
    deals,
    discounts,
    dealSources,
    plan,
    lastWeight,
    sessionDraft: parseDraft(settings.get('session_draft'), assembled.session?.id ?? null),
  };
}

export type AppData = {
  state: AppState;
  exerciseId: string | null;
  selectExercise: (exerciseId: string) => void;
  saveSetting: (key: SettingKey, value: string) => void;
  removeSetting: (key: SettingKey) => void;
  logDay: (entry: Omit<DailyLogEntry, 'date'>) => void;
  addFood: (entry: Omit<NewFoodEntry, 'date'>) => void;
  /** Un alimento nuevo copiado de su envase, que queda en su catalogo y en su respaldo. */
  createFood: (food: NewFood) => void;
  /** Corrige la ficha de un alimento y rehace la nota de los dias que lo comieron. */
  editFood: (id: string, food: FoodEdit) => void;
  /** Vuelve a anotar una comida entera de otro dia, en el espacio que se elija. */
  repeatMeal: (meal: LastMeal, mealSlot: string) => void;
  removeFood: (entryId: string) => void;
  beginSession: (
    routineId: string,
    budget: TimeBudget,
    plan: PlannedExercise[],
    company?: Company,
    gymId?: string,
  ) => void;
  /** Spec 5.2: asked for once, by him, never watched. */
  whereAmI: () => Promise<LocationOutcome>;
  /** The trimmed plan for a routine at a budget, for the screen that asks approval. */
  loadPlan: (routineId: string, budget: TimeBudget) => Promise<RoutinePlan>;
  logSet: (
    weightKg: number,
    reps: number,
    extra?: { isWarmup?: boolean; rpe?: number | null },
  ) => void;
  describeSession: (details: SessionDetails) => void;
  /** Writes the end time. Spec 6: the session is over when he says it is. */
  endSession: () => void;
  /** Corrects a routine picked by mistake, replanning at the budget already chosen. */
  switchRoutine: (routineId: string) => void;
  loadExperiments: () => Promise<ExperimentWithReadings[]>;
  beginExperiment: (experiment: NewExperiment) => Promise<void>;
  logExperimentReading: (id: string, date: IsoDate, value: number, note?: string) => void;
  finishExperiment: (id: string, endDate: IsoDate) => void;
  removeSet: (setIndex: number) => void;
  resetDatabase: () => void;
  dismissTargetChange: (effectiveFrom: IsoDate) => void;
  raiseStepsTarget: (next: number) => void;
  declineStepsTarget: (next: number) => void;
  /** Rejects with a readable message, so the form can show why it was refused. */
  startBatch: (start: BatchStart) => Promise<void>;
  eatBatchPortion: (batchId: string, mealSlot: string) => void;
  loadWeek: (date: IsoDate) => Promise<WeekSummary>;
  loadStudies: () => Promise<CoreStudyRow[]>;
  /** Spec 16.7: the outcome is returned so the screen can say what happened. */
  refreshDeals: () => Promise<SyncOutcome>;
  /**
   * Guarda lo que esta escribiendo sin recargar nada: esto se llama en cada tecla y
   * un refresco por tecla dejaria la pantalla inservible.
   */
  saveDraft: (draft: SessionDraft) => void;
  /** Un dia cualquiera abierto entero, con el desglose de su nota. */
  loadDay: (date: IsoDate) => Promise<DayDetail>;
  /** Todo lo guardado a lo largo del tiempo, listo para dibujar. */
  loadCharts: (days: number) => Promise<ChartsData>;
  /** Todos los dias con rastro dentro de la ventana, del mas nuevo al mas viejo. */
  loadRecords: (window: RecordWindow) => Promise<DayRow[]>;
  /** Escribe el registro de cualquier dia, no solo el de hoy. */
  editDay: (date: IsoDate, entry: Omit<DailyLogEntry, 'date'>) => Promise<void>;
  addFoodOn: (date: IsoDate, entry: Omit<NewFoodEntry, 'date'>) => Promise<void>;
  /**
   * El id de la sesion de ese dia, creandola si no existe. Spec 5.4: una sesion
   * escrita despues queda marcada como tal y no entra en las estadisticas de gentio.
   */
  openSessionOn: (date: IsoDate, routineId: string | null) => Promise<string>;
  addSetOn: (
    sessionId: string,
    exerciseId: string,
    weightKg: number,
    reps: number,
    extra?: { isWarmup?: boolean; rpe?: number | null; restBeforeSeconds?: number | null },
  ) => Promise<void>;
  removeSetOn: (sessionId: string, exerciseId: string, setIndex: number) => Promise<void>;
  /** El volcado completo a un archivo, para respaldo y para entrenar modelos despues. */
  exportData: () => Promise<ExportOutcome>;
  /** Rechaza con el motivo cuando el archivo no sirve, y recarga la app cuando si. */
  importData: () => Promise<ImportResult | null>;
};

const Context = createContext<AppData | null>(null);

export function useAppData(): AppData {
  const data = useContext(Context);
  // A screen rendered outside the provider would read stale nothing and look fine,
  // so it is an error rather than a default.
  if (!data) throw new Error('a screen was rendered outside the app data provider');
  return data;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({ phase: 'opening' });
  const [exerciseId, setExerciseId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    load(exerciseId)
      .then((loaded) => setState({ phase: 'ready', loaded }))
      .catch((error: unknown) => {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        setState({ phase: 'failed', message });
      });
  }, [exerciseId]);

  useEffect(refresh, [refresh]);

  // Spec 18: los botones del aviso anotan sin abrir nada, y siempre queda escrito
  // que hizo caso, que es lo que decide si ese tipo de aviso sigue saliendo.
  useEffect(
    () =>
      listenToNudges(({ nudgeId, action }) => {
        openDatabase()
          .then(async (db) => {
            const date = todayIso();
            await recordNudgeAction(db, nudgeId);
            if (action === 'descanso') await upsertDailyLog(db, { date, restDay: true });
            if (action === 'agua') {
              const log = await readDailyLog(db, date);
              await upsertDailyLog(db, { date, waterMl: (log?.water_ml ?? 0) + WATER_ACTION_ML });
            }
          })
          .then(refresh)
          .catch((error: unknown) => console.error(error));
      }),
    [refresh],
  );

  const run = useCallback(
    (work: (db: Awaited<ReturnType<typeof openDatabase>>) => Promise<unknown>) => {
      openDatabase()
        .then(work)
        .then(refresh)
        .catch((error: unknown) => console.error(error));
    },
    [refresh],
  );

  // Igual que run pero se puede esperar, porque la pantalla de un dia pasado tiene
  // que volver a leer ese dia justo despues de escribirlo.
  const write = useCallback(
    async (work: (db: Awaited<ReturnType<typeof openDatabase>>) => Promise<unknown>) => {
      const db = await openDatabase();
      await work(db);
      refresh();
    },
    [refresh],
  );

  // Stable identity: the weekly summary screen loads in an effect keyed on this.
  const loadWeek = useCallback(
    (date: IsoDate) => openDatabase().then((db) => loadWeekSummary(db, date)),
    [],
  );

  const loadStudies = useCallback(() => openDatabase().then(listStudies), []);

  const loaded = state.phase === 'ready' ? state.loaded : null;

  const value: AppData = {
    state,
    exerciseId,
    selectExercise: setExerciseId,
    saveSetting: (key, val) => run((db) => writeSetting(db, key, val)),
    removeSetting: (key) => run((db) => clearSetting(db, key)),
    logDay: (entry) => run((db) => upsertDailyLog(db, { date: todayIso(), ...entry })),
    addFood: (entry) => run((db) => addFoodEntry(db, { ...entry, date: todayIso() })),
    createFood: (food) => run((db) => addFoodToCatalog(db, food)),
    editFood: (id, food) =>
      run(async (db) => {
        await updateFood(db, id, food);
        // Corregir una ficha corrige todos los dias en que la comio, asi que sus
        // notas guardadas dejan de coincidir con lo que ahora dicen los totales.
        await rescoreDays(db, await datesWithFood(db, id), todayIso());
      }),
    repeatMeal: (meal, mealSlot) =>
      run(async (db) => {
        for (const portion of meal.entries) {
          await addFoodEntry(db, { ...portion, date: todayIso(), mealSlot });
        }
      }),
    removeFood: (entryId) => run((db) => deleteFoodEntry(db, entryId)),
    beginSession: (routineId, budget, plan, company, gymId) =>
      run(async (db) => {
        const sessionId = await startSession(db, {
          date: todayIso(),
          timeBudget: budget,
          routineId,
          gymId: gymId ?? null,
          aloneOrPartner: company ?? null,
        });
        // Spec 8.3 rule 7: nothing starts until he has approved the plan, so the
        // approved plan and the session are written together.
        await saveSessionPlan(db, sessionId, plan);
      }),
    whereAmI: () => locateGym(loaded?.gyms ?? []),
    loadPlan: (routineId, budget) =>
      openDatabase().then((db) => loadRoutinePlan(db, routineId, budget)),
    logSet: (weightKg, reps, extra) => {
      const sessionId = loaded?.today.session?.id;
      if (!sessionId || !exerciseId) return;
      run((db) => addSet(db, { sessionId, exerciseId, weightKg, reps, ...extra }));
    },
    describeSession: (details) => {
      const sessionId = loaded?.today.session?.id;
      if (!sessionId) return;
      run((db) => setSessionDetails(db, sessionId, details));
    },
    endSession: () => {
      const sessionId = loaded?.today.session?.id;
      if (!sessionId) return;
      run((db) => finishSession(db, sessionId));
    },
    switchRoutine: (routineId) => {
      const session = loaded?.today.session;
      if (!session) return;
      run(async (db) => {
        const plan = await loadRoutinePlan(db, routineId, session.time_budget);
        await setSessionRoutine(db, session.id, routineId);
        await saveSessionPlan(db, session.id, plan.exercises);
      });
    },
    loadExperiments: () => openDatabase().then((db) => listExperiments(db, todayIso())),
    beginExperiment: async (experiment) => {
      const db = await openDatabase();
      await startExperiment(db, experiment);
      refresh();
    },
    logExperimentReading: (id, date, value, note) =>
      run((db) => addReading(db, id, date, value, note)),
    finishExperiment: (id, endDate) => run((db) => endExperiment(db, id, endDate)),
    saveDraft: (draft) => {
      openDatabase()
        .then((db) => writeSetting(db, 'session_draft', serializeDraft(draft)))
        .catch((error: unknown) => console.error(error));
    },
    loadDay: (date) => openDatabase().then((db) => loadDayDetail(db, date, todayIso())),
    loadCharts: (days) => openDatabase().then((db) => loadChartsData(db, todayIso(), days)),
    loadRecords: (window) =>
      openDatabase().then((db) => listDayRows(db, windowRange(window, todayIso()))),
    editDay: (date, entry) => write((db) => upsertDailyLog(db, { date, ...entry })),
    addFoodOn: (date, entry) => write((db) => addFoodEntry(db, { ...entry, date })),
    openSessionOn: async (date, routineId) => {
      const db = await openDatabase();
      const existing = await getSessionOn(db, date);
      if (existing) return existing.id;

      const id = await startSession(db, {
        date,
        timeBudget: 'completo',
        routineId,
        isRetroactive: date !== todayIso(),
      });
      refresh();
      return id;
    },
    addSetOn: (sessionId, exerciseId, weightKg, reps, extra) =>
      write((db) => addSet(db, { sessionId, exerciseId, weightKg, reps, ...extra })),
    removeSetOn: (sessionId, exerciseId, setIndex) =>
      write(async (db) => {
        const rows = await db.getAllAsync<{ id: string }>(
          `SELECT id FROM training_set_entry
            WHERE session_id = ? AND exercise_id = ? AND set_index = ?;`,
          [sessionId, exerciseId, setIndex],
        );
        for (const row of rows) await deleteSet(db, row.id);
      }),
    exportData: () => exportToFile(),
    importData: async () => {
      const result = await importFromFile();
      if (result !== null) refresh();
      return result;
    },
    resetDatabase: () => {
      setState({ phase: 'opening' });
      resetDatabase()
        .then(refresh)
        .catch((error: unknown) => {
          console.error(error);
          const message = error instanceof Error ? error.message : String(error);
          setState({ phase: 'failed', message });
        });
    },
    removeSet: (setIndex) => {
      const target = loaded?.exercise.todaySets.find((set) => set.setIndex === setIndex);
      if (!target) return;
      run(async (db) => {
        const rows = await db.getAllAsync<{ id: string }>(
          `SELECT id FROM training_set_entry
            WHERE session_id = ? AND exercise_id = ? AND set_index = ?;`,
          [target.sessionId, target.exerciseId, setIndex],
        );
        for (const row of rows) await deleteSet(db, row.id);
      });
    },
    dismissTargetChange: (effectiveFrom) =>
      run((db) => writeSetting(db, 'targets_change_seen', effectiveFrom)),
    raiseStepsTarget: (next) => run((db) => writeSetting(db, 'steps_target', String(next))),
    declineStepsTarget: (next) =>
      run((db) => writeSetting(db, 'steps_advice_declined', String(next))),
    startBatch: async ({ food, rawWeightG, portionsCount, fatDrained }) => {
      const db = await openDatabase();
      // One transaction: a label food whose batch is refused must not be left behind.
      await db.withTransactionAsync(async () => {
        const foodId = 'label' in food ? await addFoodFromLabel(db, food.label) : food.foodId;
        await createBatch(db, {
          foodId,
          rawWeightG,
          portionsCount,
          cookedDate: todayIso(),
          fatDrained,
        });
      });
      refresh();
    },
    eatBatchPortion: (batchId, mealSlot) =>
      run((db) => consumeBatchPortion(db, batchId, todayIso(), mealSlot)),
    loadWeek,
    loadStudies,
    refreshDeals: async () => {
      const db = await openDatabase();
      const outcome = await syncDeals(db);
      refresh();
      return outcome;
    },
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
