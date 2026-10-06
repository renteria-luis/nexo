// One place that owns the loaded day and the writes against it, so every screen
// reads the same thing and a write from any of them refreshes all of them.
//
// The shell composes the modules here (spec 17.1). Screens never touch the
// database directly, which is what keeps the boundary rules of spec 17.4 true in
// practice rather than only on paper.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState as Lifecycle } from 'react-native';

import {
  addToDailyLog,
  upsertDailyLog,
  withIncrement,
  type DailyLogEntry,
  type DailyLogIncrement,
} from '../core/daily-log.ts';
import {
  appendMessage,
  lastChat,
  listChats,
  readChat,
  startChat,
  type ChatMessage,
  type ChatSummary,
} from '../core/assistant.ts';
import { addDays, todayIso, type IsoDate } from '../core/dates.ts';
import {
  clearSetting,
  dealBlocklistFrom,
  paletteFrom,
  readSettings,
  weightUnitFrom,
  writeSetting,
  type SettingKey,
} from '../core/settings.ts';
import {
  addReading,
  endExperiment,
  listExperiments,
  startExperiment,
  type ExperimentWithReadings,
  type NewExperiment,
} from '../core/experiments.ts';
import { listDeals, listSources, watchWords } from '../deals/index.ts';
import {
  cookRecipe,
  listPantry,
  listRecipes,
  removePantryItem,
  removeRecipe,
  savePantryItem,
  saveRecipe,
  type Cooked,
  type NewPantryItem,
  type NewRecipe,
  type PantryItem,
  type PantryRemoval,
  type Recipe,
} from '../pantry/index.ts';
import { listStudies } from '../core/studies.ts';
import type { ImportResult } from '../core/backup.ts';
import { implementFromDraft, serializeDraft, type SessionDraft } from '../core/session-draft.ts';
import { parseWaterTaps, serializeWaterTaps, undoLastTap } from '../core/water-taps.ts';
import { openDatabase, resetDatabase } from '../db/index.ts';
import { inTransaction, whenIdle } from '../db/transaction.ts';
import type { Company, CoreStudyRow, NutritionFoodRow } from '../db/types.ts';
import {
  addFoodEntry,
  addFood as addFoodToCatalog,
  addFoodFromLabel,
  datesWithFood,
  removeFood as removeFoodFromCatalogue,
  restoreFood as restoreFoodInCatalogue,
  updateFood,
  consumeBatchPortion,
  createBatch,
  repeatMealOn,
  deleteFoodEntry,
  discardBatch,
  listFoods,
  withPortionTaken,
  type LabelFood,
  type FoodEdit,
  type FoodRemoval,
  type LastMeal,
  type NewFood,
  type NewFoodEntry,
} from '../nutrition/index.ts';
import {
  listCatalog,
  loadExerciseCard,
  setExerciseGym,
  setExerciseNote,
  setRoutineReps,
  setRoutineSets,
  setRoutineTier,
  updateExercise,
  type CatalogEntry,
  type ExerciseCard,
  type ExerciseEdit,
} from '../training/catalog.ts';
import {
  addSet,
  deleteSet,
  finishSession,
  reopenSession as reopenSessionInDb,
  listRoutines,
  listRoutinesDone,
  loadRoutinePlan,
  owedRoutine,
  saveSessionPlan,
  getSessionOn,
  sessionDate,
  listSessionTimes,
  setDurationTrusted,
  setSessionDetails,
  setSessionMinutes,
  setSessionRoutine,
  startSession,
  usualMinutes,
  type Implement,
  type SessionDetails,
  type SessionKind,
  type PlannedExercise,
  type RoutinePlan,
  type TimeBudget,
} from '../training/index.ts';

import { exportToFile, importFromFile, type ExportOutcome } from './backup-file.ts';
import type { NudgeKind } from '../core/nudges.ts';
import { flushNudges, listenToNudges, syncNudges } from './notifications.ts';
import { applyNudgeAction } from './nudges.ts';
import { loadCharts as loadChartsData, type ChartsData } from './charts.ts';
import { afterFailedLoad, reloadQueue, showsAnotherDay, type LoadState } from './load-state.ts';
import {
  listDayRows,
  loadDayDetail,
  rescoreDays,
  windowRange,
  writeAndRescore,
  type DayDetail,
  type DayRow,
  type RecordWindow,
} from './records.ts';
import { exerciseContext, withTappedSet } from './day.ts';
import {
  load,
  REREAD_ALL,
  REREAD_DEALS,
  REREAD_FOODS,
  REREAD_NOTHING,
  withFresh,
  type Fresh,
  type Loaded,
  type Reread,
} from './load.ts';
import { dealsDue, syncDeals, type SyncOutcome } from './deals.ts';
import { locateGym, type LocationOutcome } from './location.ts';
import { loadWeekSummary, type WeekSummary } from './week.ts';
import type { ReadRequest } from '../core/questions.ts';
import { answerLocalQuestion } from './assistant-read.ts';

export type BatchStart = {
  /** A food already in the catalogue, or one typed in from its package label. */
  food: { foodId: string } | { label: LabelFood };
  rawWeightG: number;
  portionsCount: number;
  fatDrained: boolean;
};

export type AppState = LoadState<Loaded>;

/** Una recarga pedida: con o sin el trabajo de fondo, y que mas releer ademas del dia. */
type Reload = Reread & { settle: boolean };

/**
 * Ajustes que solo cambian lo que se pinta, no lo que vale un dia.
 *
 * Pintarlos ya es todo el trabajo: nada de lo que se lee de la base depende de ellos,
 * asi que la escritura va sola y no hay segunda pasada de la pantalla entera. Las
 * palabras que vigila se guardan en cada tecla, y una recarga por tecla le devolvia al
 * campo el texto de antes mientras seguia escribiendo; Hoy elige las ofertas al pintar.
 */
const LOOK_ONLY: ReadonlySet<SettingKey> = new Set([
  'palette',
  'weight_unit',
  'deal_watchlist',
  'deals_seen_at',
]);

/**
 * Los ajustes con una clave cambiada, y lo que se deriva de ellos al dia.
 *
 * Existe para pintar el chip elegido en el mismo cuadro en que lo toca. Antes el chip
 * se quedaba en el valor viejo hasta que la escritura y la recarga terminaban, y eso
 * se siente como un boton trabado aunque sean dos decimas.
 */
function withSetting(loaded: Loaded, key: SettingKey, value: string): Loaded {
  const settings = new Map(loaded.settings);
  settings.set(key, value);
  return {
    ...loaded,
    settings,
    palette: paletteFrom(settings),
    unit: weightUnitFrom(settings),
  };
}

export type AppData = {
  state: AppState;
  exerciseId: string | null;
  selectExercise: (exerciseId: string) => void;
  saveSetting: (key: SettingKey, value: string) => void;
  removeSetting: (key: SettingKey) => void;
  logDay: (entry: Omit<DailyLogEntry, 'date'>) => void;
  /** Una botella o un trago de hoy, sumado a lo guardado y pintado ya. */
  addToDay: (increment: DailyLogIncrement) => void;
  /** Un toque a un boton de agua, que "Deshacer" puede quitar despues. */
  tapWater: (ml: number) => void;
  /** Quita el ultimo toque de agua de hoy que quede. */
  undoWater: () => void;
  addFood: (entry: Omit<NewFoodEntry, 'date'>) => void;
  /** Un alimento nuevo copiado de su envase, que queda en su catalogo y en su respaldo. */
  createFood: (food: NewFood) => Promise<void>;
  /** Corrige la ficha de un alimento y rehace la nota de los dias que lo comieron. */
  editFood: (id: string, food: FoodEdit) => Promise<void>;
  /** Lo saca del catalogo: borrado si nunca lo comio, archivado si si. */
  deleteFood: (id: string) => Promise<FoodRemoval>;
  restoreFood: (id: string) => void;
  /** Los archivados, que se leen solo cuando los mira. */
  loadArchivedFoods: () => Promise<NutritionFoodRow[]>;
  /** El aviso que acaba de abrir la app, para llevarlo a la pantalla que le toca. */
  nudgeTarget: NudgeKind | null;
  clearNudgeTarget: () => void;
  /**
   * Vuelve a anotar una comida entera de otro dia, en el espacio que se elija. Lo que fue
   * una porcion de olla sale otra vez de su olla; devuelve cuantas no se anotaron porque
   * esa olla ya se acabo.
   */
  repeatMeal: (meal: LastMeal, mealSlot: string) => Promise<number>;
  removeFood: (entryId: string) => Promise<void>;
  beginSession: (
    routineId: string,
    budget: TimeBudget,
    plan: PlannedExercise[],
    company?: Company,
    gymId?: string,
  ) => void;
  /** Spec 5.2: asked for once, by him, never watched. */
  whereAmI: () => Promise<LocationOutcome>;
  /** La rutina que le toca hoy por el patron de la semana (spec 8.5), para traerla puesta. */
  loadOwedRoutine: () => Promise<string | null>;
  /** The trimmed plan for a routine at a budget, for the screen that asks approval. */
  loadPlan: (routineId: string, budget: TimeBudget, gymId?: string | null) => Promise<RoutinePlan>;
  /** Se pinta ya y se puede esperar; rechaza si la base no la acepto. */
  logSet: (
    weightKg: number,
    reps: number,
    extra?: { isWarmup?: boolean; rpe?: number | null; implement?: Implement | null },
  ) => Promise<void>;
  describeSession: (details: SessionDetails) => void;
  /** Writes the end time. Spec 6: the session is over when he says it is. */
  endSession: () => void;
  /** Deshace el terminar entreno, que es el unico boton sin vuelta atras. */
  reopenSession: () => void;
  /** Corrects a routine picked by mistake, replanning at the budget already chosen. */
  switchRoutine: (routineId: string) => void;
  loadExperiments: () => Promise<ExperimentWithReadings[]>;
  beginExperiment: (experiment: NewExperiment) => Promise<void>;
  logExperimentReading: (id: string, date: IsoDate, value: number, note?: string) => Promise<void>;
  finishExperiment: (id: string, endDate: IsoDate) => Promise<void>;
  removeSet: (setIndex: number) => void;
  /** Vuelve a leer todo despues de una carga que fallo. */
  retry: () => void;
  resetDatabase: () => void;
  dismissTargetChange: (effectiveFrom: IsoDate) => void;
  raiseStepsTarget: (next: number) => void;
  declineStepsTarget: (next: number) => void;
  /** Rejects with a readable message, so the form can show why it was refused. */
  startBatch: (start: BatchStart) => Promise<void>;
  /** Rechaza con el motivo, para que la tarjeta diga por que no entro la porcion. */
  eatBatchPortion: (batchId: string, mealSlot: string) => Promise<void>;
  /** Tira lo que queda de una tanda: nada se anota como comido. */
  throwAwayBatch: (batchId: string) => void;
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
  askLocal: (request: ReadRequest) => Promise<string>;
  /** Todo lo guardado a lo largo del tiempo, listo para dibujar. */
  loadCharts: (days: number) => Promise<ChartsData>;
  /** Todos los dias con rastro dentro de la ventana, del mas nuevo al mas viejo. */
  loadRecords: (window: RecordWindow) => Promise<DayRow[]>;

  /** El catalogo de ejercicios, para la pantalla donde lo edita. */
  loadCatalog: () => Promise<CatalogEntry[]>;
  loadExercise: (exerciseId: string) => Promise<ExerciseCard>;
  editExercise: (exerciseId: string, edit: ExerciseEdit) => Promise<void>;
  /** La nota de la (i). Implemento vacio es la general. */
  editExerciseNote: (exerciseId: string, implement: string, note: string) => Promise<void>;
  editExerciseGym: (exerciseId: string, gymId: string, available: boolean) => Promise<void>;
  /** Series con ese tiempo. Null lo deja fuera del plan recortado. */
  editRoutineSets: (
    routineId: string,
    exerciseId: string,
    budget: TimeBudget,
    sets: number | null,
  ) => Promise<void>;
  editRoutineReps: (
    routineId: string,
    exerciseId: string,
    repMin: number | null,
    repMax: number | null,
  ) => Promise<void>;
  editRoutineTier: (routineId: string, exerciseId: string, tier: number) => Promise<void>;
  /** Escribe el registro de cualquier dia, no solo el de hoy. */
  editDay: (date: IsoDate, entry: Omit<DailyLogEntry, 'date'>) => Promise<void>;
  addToDayOn: (date: IsoDate, increment: DailyLogIncrement) => Promise<void>;
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
  /** Lo que suele tardar un dia asi, o null si no hay sesiones de fiar con que decirlo. */
  loadPace: (kind: SessionKind) => Promise<number | null>;
  /** Si el tiempo de esa sesion sirve para hacer cuentas, y cuanto duro de verdad. */
  trustSessionTime: (sessionId: string, trusted: boolean) => Promise<void>;
  editSessionMinutes: (sessionId: string, minutes: number) => Promise<void>;
  /** Lo que hay en la nevera, spec 21. No puntua nada, asi que no recarga el resto. */
  loadPantry: () => Promise<PantryItem[]>;
  savePantryItem: (item: NewPantryItem) => Promise<void>;
  /** Rechaza con el motivo; si una receta lo usa, lo deja vacio y dice cuales. */
  removePantryItem: (id: string) => Promise<PantryRemoval>;
  loadRecipes: () => Promise<Recipe[]>;
  saveRecipe: (recipe: NewRecipe) => Promise<void>;
  removeRecipe: (id: string) => Promise<void>;
  /** Descuenta lo que se uso y deja la olla como lote, o dice que se lo impidio. */
  cookRecipe: (recipeId: string) => Promise<Cooked>;
  /** Los chats con el asistente, del mas nuevo al mas viejo. */
  loadChats: () => Promise<ChatSummary[]>;
  /** El ultimo chat, que es el que se abre al tocar la bola. Null si no hay ninguno. */
  lastChatId: () => Promise<string | null>;
  /** Las ultimas `limit` lineas, o todas. */
  loadChat: (chatId: string, limit?: number) => Promise<ChatMessage[]>;
  /** Un chat nuevo. Solo se crea cuando hay algo que escribir en el. */
  openChat: () => Promise<string>;
  /** Una linea del chat. No recarga nada: lo que se habla no puntua ningun dia. */
  sayInChat: (chatId: string, role: 'me' | 'app', body: string) => Promise<ChatMessage>;
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
  const [nudgeTarget, setNudgeTarget] = useState<NudgeKind | null>(null);
  const clearNudgeTarget = useCallback(() => setNudgeTarget(null), []);

  // El ejercicio abierto vive tambien en una referencia para que recargar no dependa
  // de el: antes, elegir otro ejercicio volvia a leer la app entera y hasta a escribir
  // la nota del dia, cuando lo unico que hacia falta era leer lo de ese ejercicio.
  const openExercise = useRef<string | null>(null);

  // El primer arranque de un dia nuevo rehace los ultimos siete dias aunque lo pida una
  // escritura que no los necesita: ayer siguio abierto hasta medianoche, y su falta de
  // entreno no existia hasta hoy.
  const settledOn = useRef<IsoDate | null>(null);

  const loaded = state.phase === 'ready' ? state.loaded : null;

  // Lo cargado, tambien en una referencia. Las acciones lo leen de aqui y por eso se
  // pueden armar una sola vez: si cambiaran de identidad en cada render, ninguna
  // pantalla podria saltarse su propio redibujo, porque recibiria funciones nuevas
  // aunque no haya cambiado nada de lo que muestra.
  const openLoaded = useRef(loaded);
  useEffect(() => {
    openLoaded.current = loaded;
  }, [loaded]);

  const reloads = useRef<((request: Reload) => void) | null>(null);
  const refresh = useCallback((settle = true, reread: Reread = REREAD_NOTHING) => {
    reloads.current ??= reloadQueue<Reload, Fresh>(
      async (request) => {
        const db = await openDatabase();
        await whenIdle(db);
        const deep = request.settle || settledOn.current !== todayIso();
        const fresh = await load(
          db,
          openExercise.current,
          deep,
          request,
          openLoaded.current?.today.date ?? null,
        );
        // Aunque esta carga se tire por vieja, el trabajo de fondo ya quedo escrito.
        if (deep) settledOn.current = fresh.today.date;
        // Los avisos de los proximos dias se rehacen con lo que acaba de anotar. No se
        // espera: programar en iOS no tiene por que retrasar lo que ya se puede pintar.
        syncNudges(db, fresh.today.date);
        return fresh;
      },
      (fresh) =>
        setState((current) => ({
          phase: 'ready',
          loaded: withFresh(current.phase === 'ready' ? current.loaded : null, fresh),
          problem: null,
        })),
      (error) => {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        setState((current) => afterFailedLoad(current, message));
      },
      (a, b) => ({
        settle: a.settle || b.settle,
        deals: a.deals || b.deals,
        foods: a.foods || b.foods,
      }),
      // Las notas que rehizo ya estan guardadas; lo que leyo para la pantalla, no.
      (request) => ({ ...request, settle: false }),
    );
    reloads.current({ settle, ...reread });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Cambia un trozo de lo cargado sin ir a la base: lo que se acaba de tocar, ya. */
  const patch = useCallback((change: (loaded: Loaded) => Loaded) => {
    setState((current) =>
      current.phase === 'ready' ? { ...current, loaded: change(current.loaded) } : current,
    );
  }, []);

  // El dia armado, para poder releer solo lo del ejercicio sin recargar nada mas.
  const day = state.phase === 'ready' ? state.loaded.today : null;
  const openDay = useRef(day);
  useEffect(() => {
    openDay.current = day;
  }, [day]);

  const selectExercise = useCallback((next: string) => {
    openExercise.current = next;
    setExerciseId(next);
  }, []);

  useEffect(() => {
    const assembled = openDay.current;
    if (exerciseId === null || assembled === null) return;

    let alive = true;
    openDatabase()
      .then((db) => exerciseContext(db, assembled, exerciseId))
      .then((exercise) => {
        if (alive) patch((loaded) => ({ ...loaded, exercise }));
      })
      .catch((error: unknown) => console.error(error));
    return () => {
      alive = false;
    };
    // A proposito solo el ejercicio: el dia entra por referencia porque cambia con
    // cada dato que anota, y eso volveria a leer esto sin que haga falta.
  }, [exerciseId, patch]);

  // Spec 18: los botones del aviso anotan sin abrir nada, y siempre queda escrito
  // que hizo caso, que es lo que decide si ese tipo de aviso sigue saliendo.
  useEffect(
    () =>
      listenToNudges(({ nudgeId, kind, action }) => {
        // Tocar el aviso abre la app donde estaba, que casi nunca es donde hace
        // falta. La pantalla la decide el tipo de aviso.
        if (action === 'abrir') setNudgeTarget(kind);
        openDatabase()
          .then((db) => applyNudgeAction(db, { nudgeId, kind, action }, todayIso()))
          // El boton del aviso pudo marcar un descanso, que cambia la nota de otros
          // dias de la semana: esta recarga si hace el trabajo de fondo.
          .then(() => refresh())
          .catch((error: unknown) => console.error(error));
      }),
    [refresh],
  );

  const run = useCallback(
    (
      work: (db: Awaited<ReturnType<typeof openDatabase>>) => Promise<unknown>,
      settle = true,
      reread = REREAD_NOTHING,
    ) => {
      openDatabase()
        .then(work)
        .then(() => refresh(settle, reread))
        .catch((error: unknown) => {
          console.error(error);
          // Lo que se pinto por adelantado tiene que volver a lo que dice la base.
          refresh(settle, reread);
        });
    },
    [refresh],
  );

  // Escribe y no recarga nada, para lo que ya quedo pintado y de lo que no depende
  // ninguna otra cosa que se lea. Si la escritura falla si recarga, para que en
  // pantalla no quede algo que la base nunca acepto.
  const store = useCallback(
    (work: (db: Awaited<ReturnType<typeof openDatabase>>) => Promise<unknown>) => {
      openDatabase()
        .then(work)
        .catch((error: unknown) => {
          console.error(error);
          refresh();
        });
    },
    [refresh],
  );

  // Igual que run pero se puede esperar, porque la pantalla de un dia pasado tiene
  // que volver a leer ese dia justo despues de escribirlo.
  const write = useCallback(
    async (
      work: (db: Awaited<ReturnType<typeof openDatabase>>) => Promise<unknown>,
      settle = true,
      reread = REREAD_NOTHING,
    ) => {
      const db = await openDatabase();
      await work(db);
      refresh(settle, reread);
    },
    [refresh],
  );

  // Stable identity: the weekly summary screen loads in an effect keyed on this.
  const loadWeek = useCallback(
    (date: IsoDate) => openDatabase().then((db) => loadWeekSummary(db, date)),
    [],
  );

  const loadStudies = useCallback(() => openDatabase().then(listStudies), []);

  const loadPace = useCallback(
    (kind: SessionKind) =>
      openDatabase()
        .then(listSessionTimes)
        .then((times) => usualMinutes(times, kind)),
    [],
  );

  const loadPantry = useCallback(() => openDatabase().then(listPantry), []);
  const loadRecipes = useCallback(() => openDatabase().then(listRecipes), []);

  const loadChats = useCallback(() => openDatabase().then((db) => listChats(db)), []);
  const lastChatId = useCallback(() => openDatabase().then(lastChat), []);
  const loadChat = useCallback(
    (chatId: string, limit?: number) => openDatabase().then((db) => readChat(db, chatId, limit)),
    [],
  );
  const openChat = useCallback(() => openDatabase().then((db) => startChat(db)), []);
  const sayInChat = useCallback(
    (chatId: string, role: 'me' | 'app', body: string) =>
      openDatabase().then((db) => appendMessage(db, chatId, role, body)),
    [],
  );

  // Lo mismo para el resto de los lectores: la pantalla de graficas, la de registros,
  // la de un dia y la de experimentos cargan dentro de un efecto que depende de esta
  // funcion, asi que una funcion nueva en cada render volvia a consultar la base
  // entera cada vez que se anotaba cualquier cosa en cualquier otra pantalla.
  const loadDay = useCallback(
    (date: IsoDate) => openDatabase().then((db) => loadDayDetail(db, date, todayIso())),
    [],
  );

  const loadCharts = useCallback(
    (days: number) => openDatabase().then((db) => loadChartsData(db, todayIso(), days)),
    [],
  );

  const askLocal = useCallback((request: ReadRequest) => {
    const unit = openLoaded.current?.unit ?? 'lb';
    return openDatabase().then((db) => answerLocalQuestion(db, request, todayIso(), unit));
  }, []);

  const loadRecords = useCallback(
    (window: RecordWindow) =>
      openDatabase().then((db) => listDayRows(db, windowRange(window, todayIso()))),
    [],
  );

  const loadExperiments = useCallback(
    () => openDatabase().then((db) => listExperiments(db, todayIso())),
    [],
  );

  const loadArchivedFoods = useCallback(
    () => openDatabase().then((db) => listFoods(db, { archived: true })),
    [],
  );

  const loadPlan = useCallback(
    (routineId: string, budget: TimeBudget, gymId?: string | null) =>
      openDatabase().then((db) => loadRoutinePlan(db, routineId, budget, gymId ?? null)),
    [],
  );

  const loadOwedRoutine = useCallback(async () => {
    const db = await openDatabase();
    const today = todayIso();
    const [routines, done] = await Promise.all([
      listRoutines(db),
      listRoutinesDone(db, { from: addDays(today, -60), to: today }),
    ]);
    return owedRoutine(routines, done, today);
  }, []);

  const loadCatalog = useCallback(() => openDatabase().then(listCatalog), []);

  const loadExercise = useCallback(
    (exerciseId: string) => openDatabase().then((db) => loadExerciseCard(db, exerciseId)),
    [],
  );

  // La recoleccion de ofertas del dia, bajada sola al abrir y al volver a la app. Solo se
  // releen las ofertas: nada mas de lo cargado depende de ellas.
  const triedDeals = useRef<number | null>(null);
  const fetchDeals = useCallback(() => {
    const current = openLoaded.current;
    if (current === null) return;
    const sources = current.dealSources;
    const newest = sources.reduce(
      (latest, source) => Math.max(latest, source.last_success_at ?? 0),
      0,
    );
    const now = Date.now();
    if (!dealsDue(newest === 0 ? null : newest, triedDeals.current, now)) return;
    triedDeals.current = now;
    openDatabase()
      .then(async (db) => {
        // Sin conexion falla callado y deja escrito por que; lo guardado sigue ahi.
        await syncDeals(db);
        const [deals, dealSources] = await Promise.all([
          listDeals(db, todayIso(), watchWords(dealBlocklistFrom(current.settings))),
          listSources(db),
        ]);
        patch((current) => ({ ...current, deals, dealSources }));
      })
      .catch((error: unknown) => console.error(error));
  }, [patch]);

  const ready = loaded !== null;
  useEffect(() => {
    if (ready) fetchDeals();
  }, [ready, fetchDeals]);

  // Volver a la app no recargaba nada, y despues de una noche dormida en memoria todo lo
  // cargado era de ayer. Y al irse, el plan de avisos tiene que quedar con lo ultimo.
  useEffect(() => {
    const subscription = Lifecycle.addEventListener('change', (next) => {
      if (next === 'background') flushNudges();
      if (next !== 'active') return;
      if (showsAnotherDay(openLoaded.current, todayIso())) refresh();
      fetchDeals();
    });
    return () => subscription.remove();
  }, [refresh, fetchDeals]);

  // Los toques de agua de hoy, del primero al ultimo. Viven aqui para que dos toques en el
  // mismo cuadro no lean la misma lista, y en un ajuste para que sobrevivan si iOS cierra
  // la app.
  const waterTaps = useRef<{ date: IsoDate; taps: number[] } | null>(null);

  const actions = useMemo<Omit<AppData, 'state' | 'exerciseId' | 'nudgeTarget'>>(() => {
    const tapsToday = () => {
      const date = todayIso();
      if (waterTaps.current?.date !== date) {
        waterTaps.current = {
          date,
          taps: parseWaterTaps(openLoaded.current?.settings.get('water_taps'), date),
        };
      }
      return waterTaps.current;
    };

    // El agua y los tragos solo cambian hoy, que se puntua en cada carga. `taps` es la
    // lista de toques de agua nueva, cuando el toque viene de esos botones.
    const addToday = (increment: DailyLogIncrement, taps?: string) => {
      const date = todayIso();
      patch((current) => {
        if (current.today.date !== date) return current;
        const next = taps === undefined ? current : withSetting(current, 'water_taps', taps);
        return {
          ...next,
          today: { ...next.today, log: withIncrement(next.today.log, date, increment) },
        };
      });
      run(async (db) => {
        await addToDailyLog(db, date, increment);
        if (taps !== undefined) await writeSetting(db, 'water_taps', taps);
      }, false);
    };

    return {
      selectExercise,
      saveSetting: (key, val) => {
        patch((loaded) => withSetting(loaded, key, val));
        if (LOOK_ONLY.has(key)) {
          store((db) => writeSetting(db, key, val));
          return;
        }
        // Las palabras excluidas deciden que oferta lleva proteina por dolar: se releen
        // solo las ofertas, y solo se pintan si el campo sigue diciendo lo mismo.
        if (key === 'deal_blocklist') {
          store(async (db) => {
            await writeSetting(db, key, val);
            const deals = await listDeals(db, todayIso(), watchWords(val));
            patch((current) =>
              current.settings.get('deal_blocklist') === val ? { ...current, deals } : current,
            );
          });
          return;
        }
        run((db) => writeSetting(db, key, val));
      },
      removeSetting: (key) => run((db) => clearSetting(db, key)),
      // Marcar descanso cambia la nota de los otros dias de la semana; el resto de lo
      // que se anota de hoy solo cambia hoy, y hoy se puntua en cada carga de todas formas.
      logDay: (entry) =>
        run(
          (db) => upsertDailyLog(db, { date: todayIso(), ...entry }),
          entry.restDay !== undefined,
        ),
      addToDay: (increment) => addToday(increment),
      tapWater: (ml) => {
        const today = tapsToday();
        today.taps = [...today.taps, ml];
        addToday({ waterMl: ml }, serializeWaterTaps(today.date, today.taps));
      },
      undoWater: () => {
        const today = tapsToday();
        const undone = undoLastTap(today.taps);
        if (undone === null) return;
        today.taps = undone.taps;
        addToday({ waterMl: -undone.ml }, serializeWaterTaps(today.date, today.taps));
      },
      addFood: (entry) =>
        run((db) => addFoodEntry(db, { ...entry, date: todayIso() }), false, REREAD_FOODS),
      // Se pueden esperar: la ficha no se cierra hasta que la base la acepto, y si no la
      // acepta dice por que. Antes se cerraba primero y el error solo iba a la consola.
      createFood: (food) => write((db) => addFoodToCatalog(db, food), true, REREAD_FOODS),
      deleteFood: async (id) => {
        const db = await openDatabase();
        const outcome = await removeFoodFromCatalogue(db, id);
        refresh(true, REREAD_FOODS);
        return outcome;
      },
      restoreFood: (id) => run((db) => restoreFoodInCatalogue(db, id), true, REREAD_FOODS),
      loadArchivedFoods,
      clearNudgeTarget,
      editFood: (id, food) =>
        write(
          async (db) => {
            await updateFood(db, id, food);
            // Corregir una ficha corrige todos los dias en que la comio, asi que sus
            // notas guardadas dejan de coincidir con lo que ahora dicen los totales.
            await rescoreDays(db, await datesWithFood(db, id), todayIso());
          },
          true,
          REREAD_FOODS,
        ),
      repeatMeal: async (meal, mealSlot) => {
        let skipped = 0;
        await write(
          async (db) => {
            skipped = await repeatMealOn(db, meal, todayIso(), mealSlot);
          },
          false,
          REREAD_FOODS,
        );
        return skipped;
      },
      // Se puede esperar: la pantalla de un dia pasado tiene que volver a leerlo en
      // cuanto el borrado esta escrito, y antes lo adivinaba con un temporizador.
      // Sin el trabajo de fondo, pero rehaciendo el dia de esa porcion: si era de un dia
      // pasado, su nota guardada seguia contando lo que se borro.
      removeFood: (entryId) =>
        write(
          async (db) => {
            const date = await deleteFoodEntry(db, entryId);
            if (date !== null) await rescoreDays(db, [date], todayIso());
          },
          false,
          REREAD_FOODS,
        ),
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
      whereAmI: () => locateGym(openLoaded.current?.gyms ?? []),
      loadPlan,
      loadOwedRoutine,
      logSet: async (weightKg, reps, extra) => {
        const session = openLoaded.current?.today.session;
        const exerciseId = openExercise.current;
        if (!session || !exerciseId) throw new Error('there is no open exercise to log a set into');
        const sessionId = session.id;
        // Una serie despues de medianoche en la sesion de anoche cambia la nota de anoche,
        // y eso solo lo rehace el trabajo de fondo.
        const settle = session.date !== todayIso();
        patch((current) =>
          withTappedSet(current, {
            sessionId,
            exerciseId,
            weightKg,
            reps,
            rpe: extra?.rpe ?? null,
            timestamp: Date.now(),
          }),
        );
        try {
          await write(async (db) => {
            // La serie del asistente no trae implemento: va el que dice el borrador de la
            // tarjeta, como si la hubiera anotado ahi.
            const implement =
              extra?.implement !== undefined
                ? extra.implement
                : (implementFromDraft(
                    (await readSettings(db)).get('session_draft'),
                    sessionId,
                    exerciseId,
                  ) as Implement | null);
            await addSet(db, { sessionId, exerciseId, weightKg, reps, ...extra, implement });
          }, settle);
        } catch (error) {
          // Lo que se pinto por adelantado tiene que volver a lo que dice la base.
          refresh(settle);
          throw error;
        }
      },
      describeSession: (details) => {
        const sessionId = openLoaded.current?.today.session?.id;
        if (!sessionId) return;
        // El gentio y con quien entrena no cambian ninguna nota, asi que el chip se
        // pinta ya y la escritura va detras sin trabajo de fondo.
        patch((current) => {
          const session = current.today.session;
          if (!session) return current;
          return {
            ...current,
            today: {
              ...current.today,
              session: {
                ...session,
                alone_or_partner: details.aloneOrPartner ?? session.alone_or_partner,
                crowding: details.crowding ?? session.crowding,
              },
            },
          };
        });
        // Nada de lo que se lee depende del gentio ni de con quien entreno, asi que
        // no hay nada que releer: se pinta y se guarda.
        store((db) => setSessionDetails(db, sessionId, details));
      },
      endSession: () => {
        const sessionId = openLoaded.current?.today.session?.id;
        if (!sessionId) return;
        run((db) => finishSession(db, sessionId));
      },
      reopenSession: () => {
        const sessionId = openLoaded.current?.today.session?.id;
        if (!sessionId) return;
        run((db) => reopenSessionInDb(db, sessionId));
      },
      switchRoutine: (routineId) => {
        const session = openLoaded.current?.today.session;
        if (!session) return;
        patch((current) =>
          current.today.session
            ? {
                ...current,
                today: {
                  ...current.today,
                  session: { ...current.today.session, routine_id: routineId },
                },
              }
            : current,
        );
        run(async (db) => {
          const plan = await loadRoutinePlan(db, routineId, session.time_budget, session.gym_id);
          await setSessionRoutine(db, session.id, routineId);
          await saveSessionPlan(db, session.id, plan.exercises);
        });
      },
      loadExperiments,
      beginExperiment: async (experiment) => {
        const db = await openDatabase();
        await startExperiment(db, experiment);
      },
      logExperimentReading: (id, date, value, note) =>
        openDatabase().then((db) => addReading(db, id, date, value, note)),
      finishExperiment: (id, endDate) =>
        openDatabase().then((db) => endExperiment(db, id, endDate)),
      saveDraft: (draft) => store((db) => writeSetting(db, 'session_draft', serializeDraft(draft))),
      loadDay,
      askLocal,
      loadCharts,
      loadRecords,
      editDay: (date, entry) =>
        write((db) =>
          writeAndRescore(db, date, todayIso(), () => upsertDailyLog(db, { date, ...entry }), {
            restDay: entry.restDay !== undefined,
          }),
        ),
      addToDayOn: (date, increment) =>
        write((db) =>
          writeAndRescore(db, date, todayIso(), () => addToDailyLog(db, date, increment)),
        ),
      addFoodOn: (date, entry) =>
        write(
          (db) => writeAndRescore(db, date, todayIso(), () => addFoodEntry(db, { ...entry, date })),
          true,
          REREAD_FOODS,
        ),
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
        write(async (db) =>
          writeAndRescore(db, await sessionDate(db, sessionId), todayIso(), () =>
            addSet(db, { sessionId, exerciseId, weightKg, reps, ...extra }),
          ),
        ),
      removeSetOn: (sessionId, exerciseId, setIndex) =>
        write(async (db) =>
          writeAndRescore(db, await sessionDate(db, sessionId), todayIso(), async () => {
            const rows = await db.getAllAsync<{ id: string }>(
              `SELECT id FROM training_set_entry
              WHERE session_id = ? AND exercise_id = ? AND set_index = ?;`,
              [sessionId, exerciseId, setIndex],
            );
            for (const row of rows) await deleteSet(db, row.id);
          }),
        ),
      exportData: () => exportToFile(),
      retry: () => {
        // Desde el panel de error tiene que verse que lo intenta otra vez; con la app
        // abierta, lo que ya estaba en pantalla se queda mientras tanto.
        setState((current) => (current.phase === 'failed' ? { phase: 'opening' } : current));
        refresh(true, REREAD_ALL);
      },
      importData: async () => {
        const result = await importFromFile();
        if (result !== null) refresh(true, REREAD_ALL);
        return result;
      },
      resetDatabase: () => {
        setState({ phase: 'opening' });
        resetDatabase()
          .then(() => refresh(true, REREAD_ALL))
          .catch((error: unknown) => {
            console.error(error);
            const message = error instanceof Error ? error.message : String(error);
            setState({ phase: 'failed', message });
          });
      },
      removeSet: (setIndex) => {
        const target = openLoaded.current?.exercise.todaySets.find(
          (set) => set.setIndex === setIndex,
        );
        if (!target) return;
        run(async (db) => {
          const rows = await db.getAllAsync<{ id: string }>(
            `SELECT id FROM training_set_entry
            WHERE session_id = ? AND exercise_id = ? AND set_index = ?;`,
            [target.sessionId, target.exerciseId, setIndex],
          );
          for (const row of rows) await deleteSet(db, row.id);
        }, target.date !== todayIso());
      },
      dismissTargetChange: (effectiveFrom) =>
        run((db) => writeSetting(db, 'targets_change_seen', effectiveFrom)),
      raiseStepsTarget: (next) => run((db) => writeSetting(db, 'steps_target', String(next))),
      declineStepsTarget: (next) =>
        run((db) => writeSetting(db, 'steps_advice_declined', String(next))),
      startBatch: async ({ food, rawWeightG, portionsCount, fatDrained }) => {
        const db = await openDatabase();
        // One transaction: a label food whose batch is refused must not be left behind.
        await inTransaction(db, async () => {
          const foodId = 'label' in food ? await addFoodFromLabel(db, food.label) : food.foodId;
          await createBatch(db, {
            foodId,
            rawWeightG,
            portionsCount,
            cookedDate: todayIso(),
            fatDrained,
          });
        });
        refresh(true, REREAD_FOODS);
      },
      eatBatchPortion: async (batchId, mealSlot) => {
        patch((current) => ({ ...current, batches: withPortionTaken(current.batches, batchId) }));
        try {
          await write(
            (db) => consumeBatchPortion(db, batchId, todayIso(), mealSlot),
            false,
            REREAD_FOODS,
          );
        } catch (error) {
          // Lo que se pinto por adelantado tiene que volver a lo que dice la base.
          refresh(false, REREAD_FOODS);
          throw error;
        }
      },
      // Nada de lo que se lee depende de una tanda vacia: se quita de la pantalla y se
      // guarda detras, sin recargar.
      throwAwayBatch: (batchId) => {
        patch((current) => ({
          ...current,
          batches: current.batches.filter((item) => item.batch.id !== batchId),
        }));
        store((db) => discardBatch(db, batchId));
      },
      loadWeek,
      loadStudies,
      loadPace,
      trustSessionTime: (sessionId, trusted) =>
        write((db) => setDurationTrusted(db, sessionId, trusted), false),
      editSessionMinutes: (sessionId, minutes) =>
        write((db) => setSessionMinutes(db, sessionId, minutes), false),
      loadPantry,
      loadRecipes,
      savePantryItem: async (item) => {
        await savePantryItem(await openDatabase(), item);
      },
      removePantryItem: (id) => openDatabase().then((db) => removePantryItem(db, id)),
      saveRecipe: async (recipe) => {
        await saveRecipe(await openDatabase(), recipe);
      },
      removeRecipe: (id) => openDatabase().then((db) => removeRecipe(db, id)),
      // Esta si recarga: la olla aparece como lote en Comida.
      cookRecipe: async (recipeId) => {
        const db = await openDatabase();
        const cooked = await cookRecipe(db, recipeId, todayIso());
        refresh();
        return cooked;
      },
      loadChats,
      lastChatId,
      loadChat,
      openChat,
      sayInChat,
      loadCatalog,
      loadExercise,
      // Editar el catalogo no cambia la nota de ningun dia, pero si lo que la pantalla
      // de entreno tiene delante, asi que se recarga sin el trabajo de fondo.
      editExercise: (exerciseId, edit) =>
        write((db) => updateExercise(db, exerciseId, edit), false),
      editExerciseNote: (exerciseId, implement, note) =>
        write((db) => setExerciseNote(db, exerciseId, implement, note), false),
      editExerciseGym: (exerciseId, gymId, available) =>
        write((db) => setExerciseGym(db, exerciseId, gymId, available), false),
      editRoutineSets: (routineId, exerciseId, budget, sets) =>
        write((db) => setRoutineSets(db, routineId, exerciseId, budget, sets), false),
      editRoutineReps: (routineId, exerciseId, repMin, repMax) =>
        write((db) => setRoutineReps(db, routineId, exerciseId, repMin, repMax), false),
      editRoutineTier: (routineId, exerciseId, tier) =>
        write((db) => setRoutineTier(db, routineId, exerciseId, tier), false),
      refreshDeals: async () => {
        const db = await openDatabase();
        const outcome = await syncDeals(db);
        // Lo bajado no cambia la nota de ningun dia: solo se releen las ofertas.
        refresh(false, REREAD_DEALS);
        return outcome;
      },
    };
  }, [
    clearNudgeTarget,
    loadArchivedFoods,
    loadCharts,
    loadDay,
    askLocal,
    loadExperiments,
    loadCatalog,
    loadExercise,
    loadPlan,
    loadOwedRoutine,
    loadRecords,
    loadStudies,
    loadPace,
    loadPantry,
    loadRecipes,
    loadChats,
    lastChatId,
    loadChat,
    openChat,
    sayInChat,
    loadWeek,
    patch,
    refresh,
    run,
    selectExercise,
    store,
    write,
  ]);

  const value: AppData = useMemo(
    () => ({ state, exerciseId, nudgeTarget, ...actions }),
    [state, exerciseId, nudgeTarget, actions],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
