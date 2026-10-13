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
import { AppState } from 'react-native';
import { openDatabase } from '../db/index.ts';
import { readWorkoutFinish, type WorkoutFinish } from '../training/read.ts';
import type { SessionTiming } from '../training/timing.ts';
import {
  DEFAULT_TRAVEL_PREFERENCES,
  departureReadyAt,
  travelAdvice,
  travelReminders,
  travelPreferencesProblem,
  type JourneyState,
  type TravelAdvice,
  type TravelPreferences,
} from '../transit/journey.ts';
import { readJourneyState, saveJourneyState } from '../transit/journey-store.ts';
import {
  buildPlannerIndex,
  liveOptions,
  planLiveStops,
  runPlan,
  startPlan,
  type PlanOption,
  type PlanResult,
  type PlanMode,
} from '../transit/planner.ts';
import {
  buildLiveQuery,
  observedServiceTrips,
  type LiveQuery,
  type LiveSnapshot,
  type TransitLiveState,
} from '../transit/realtime.ts';
import {
  listPlaces,
  listStopWalks,
  listWalkLinks,
  type CachedSchedule,
  type Place,
} from '../transit/store.ts';
import { TRANSIT_ENABLED } from '../transit/index.ts';
import { useAppData } from './AppData.tsx';
import { loadTransit } from './transit.ts';
import {
  createTransitLiveClient,
  loadTransitLiveConfig,
  type TransitLiveConfig,
} from './transit-live.ts';
import { syncTransitReminders, type TravelNotificationStatus } from './notifications.ts';

type Choice = {
  originId: string;
  destinationId: string;
  mode?: PlanMode;
  at?: number;
  selectedKey?: string | null;
  workoutId?: string | null;
};
type ViewState = {
  saved: JourneyState;
  places: Place[];
  workout: WorkoutFinish | null;
  gymId: string | null;
  sessionId: string | null;
  advice: TravelAdvice | null;
  alternative: TravelAdvice | null;
  result: PlanResult | null;
  query: LiveQuery | null;
  loading: boolean;
  busy: boolean;
  problem: string | null;
  notificationStatus: TravelNotificationStatus;
  notificationProblem: string | null;
  now: number;
};
type Actions = {
  refresh: () => Promise<void>;
  choose: (choice: Choice) => Promise<void>;
  select: (option: PlanOption) => Promise<void>;
  arm: (enabled: boolean) => Promise<void>;
  clear: () => Promise<void>;
  preferences: (next: TravelPreferences) => Promise<void>;
  visible: (surface: string, value: boolean) => void;
  snapshot: (value: LiveSnapshot | null) => void;
  schedule: (value: CachedSchedule) => void;
};
const initial: JourneyState = { preferences: DEFAULT_TRAVEL_PREFERENCES, next: null };
const ViewContext = createContext<ViewState | null>(null);
const ActionsContext = createContext<Actions | null>(null);
const LinkContext = createContext<
  (Pick<ViewState, 'saved' | 'gymId' | 'sessionId' | 'query'> & { actions: Actions }) | null
>(null);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function TransitJourneyProvider({ children }: { children: ReactNode }) {
  const { state, dataRevision, loadSessionTiming } = useAppData();
  const loaded = state.phase === 'ready' ? state.loaded : null;
  const [saved, setSaved] = useState(initial);
  const [places, setPlaces] = useState<Place[]>([]);
  const [cache, setCache] = useState<CachedSchedule | null>(null);
  const [config, setConfig] = useState<TransitLiveConfig | null>(null);
  const [timing, setTiming] = useState<SessionTiming | null>(null);
  const [result, setResult] = useState<{ tripId: string; value: PlanResult } | null>(null);
  const [live, setLive] = useState<TransitLiveState | null>(null);
  const [external, setExternal] = useState<LiveSnapshot | null>(null);
  const [surfaces, setSurfaces] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [now, setNow] = useState(Date.now);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<TravelNotificationStatus>('off');
  const [notificationProblem, setNotificationProblem] = useState<string | null>(null);
  const [walkRevision, setWalkRevision] = useState(0);
  const pendingWrite = useRef(false);
  const current = useRef(saved);
  useEffect(() => {
    current.current = saved;
  }, [saved]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const db = await openDatabase();
      const [next, nextPlaces, liveConfig] = await Promise.all([
        readJourneyState(db),
        listPlaces(db),
        loadTransitLiveConfig(),
      ]);
      if (!mounted.current || pendingWrite.current) return;
      setSaved((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
      setPlaces((old) => (JSON.stringify(old) === JSON.stringify(nextPlaces) ? old : nextPlaces));
      setConfig((old) => (JSON.stringify(old) === JSON.stringify(liveConfig) ? old : liveConfig));
      setWalkRevision((value) => value + 1);
      setProblem(null);
    } catch (error) {
      if (mounted.current) setProblem(message(error));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);
  const ready = loaded !== null && TRANSIT_ENABLED;
  useEffect(() => {
    if (ready) void Promise.resolve().then(refresh);
  }, [ready, refresh]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => {
      setActive(next === 'active');
      if (next === 'active') {
        setNow(Date.now());
        void refresh();
      }
    });
    return () => listener.remove();
  }, [refresh]);
  const trip = saved.next;
  const tripId = trip?.id;
  useEffect(() => {
    if (!active || !tripId) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [active, tripId]);
  useEffect(() => {
    if (!tripId) return;
    let alive = true;
    loadTransit()
      .then((data) => {
        if (alive) setCache(data.cache);
      })
      .catch((error) => {
        if (alive) setProblem(message(error));
      });
    return () => {
      alive = false;
    };
  }, [tripId]);

  const session = loaded?.today.session;
  const sessionId = session?.id ?? null;
  const workoutId = trip?.workoutId;
  useEffect(() => {
    if (!sessionId || workoutId !== sessionId) return;
    let alive = true;
    // This action reads the existing estimate evidence; prepare=false performs no Training writes.
    loadSessionTiming(sessionId)
      .then((data) => {
        if (alive) setTiming(data);
      })
      .catch((error) => {
        if (alive) {
          setTiming(null);
          setProblem(message(error));
        }
      });
    return () => {
      alive = false;
    };
  }, [sessionId, workoutId, dataRevision, loadSessionTiming]);
  const workout = useMemo(
    () =>
      timing && loaded && timing.session.id === workoutId && sessionId === workoutId
        ? readWorkoutFinish(
            timing,
            loaded.plan,
            loaded.exercise.exercises,
            now,
            loaded.sessionDraft?.exerciseId
              ? {
                  exerciseId: loaded.sessionDraft.exerciseId,
                  implement: loaded.sessionDraft.implement,
                }
              : undefined,
          )
        : null,
    [timing, loaded, now, workoutId, sessionId],
  );
  const origin = places.find((p) => p.id === trip?.originId);
  const destination = places.find((p) => p.id === trip?.destinationId);
  const schedule = cache?.schedule;
  const snapshot =
    external && (!live?.snapshot || external.generatedAt > live.snapshot.generatedAt)
      ? external
      : (live?.snapshot ?? null);
  const observedKey = JSON.stringify(
    schedule ? observedServiceTrips(schedule, snapshot, snapshot?.generatedAt ?? 0) : [],
  );
  const index = useMemo(() => (schedule ? buildPlannerIndex(schedule) : null), [schedule]);
  const minute = Math.floor(now / 60_000) * 60_000;
  const at =
    trip?.selectedKey || trip?.mode !== 'now'
      ? trip?.at
      : Math.ceil(departureReadyAt(saved.preferences.preparationMinutes, workout, now) / 60_000) *
        60_000;
  useEffect(() => {
    let alive = true;
    if (!tripId || !index || !origin || !destination || at === undefined) return;
    void (async () => {
      try {
        await pause();
        if (!alive) return;
        setSearching(true);
        const db = await openDatabase();
        const [from, to, stops] = await Promise.all([
          listWalkLinks(db, origin.id),
          listWalkLinks(db, destination.id),
          listStopWalks(db),
        ]);
        const request = {
          origin,
          destination,
          originWalks: new Map(
            from
              .filter((walk) => walk.direction === 'to_stop')
              .map((walk) => [walk.stop_id, walk.minutes]),
          ),
          destinationWalks: new Map(
            to
              .filter((walk) => walk.direction === 'from_stop')
              .map((walk) => [walk.stop_id, walk.minutes]),
          ),
          stopWalks: stops,
          mode: trip?.mode === 'arrive' ? ('arrive' as const) : ('depart' as const),
          at,
          observedTrips: JSON.parse(observedKey),
        };
        await pause();
        const next = await runPlan(startPlan(index, request), { pause, cancelled: () => !alive });
        if (alive && next) {
          setResult({ tripId, value: next });
          setProblem(null);
        }
      } catch (error) {
        if (alive) setProblem(message(error));
      } finally {
        if (alive) setSearching(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tripId, trip?.mode, index, origin, destination, at, walkRevision, observedKey]);
  const plan =
    result && result.tripId === tripId && result.value.context.index.schedule === schedule
      ? result.value
      : null;
  const adviceFor = useCallback(
    (option: PlanOption) =>
      travelAdvice(
        option,
        saved.preferences.preparationMinutes,
        workout,
        now,
        trip?.mode === 'arrive' ? trip.at : undefined,
        option.scheduleKey === trip?.selectedKey ? trip.selectedAt : null,
      ),
    [saved.preferences.preparationMinutes, workout, now, trip],
  );
  const choices = useMemo(
    () => (plan ? liveOptions(plan, snapshot, now, true).map(adviceFor) : []),
    [plan, snapshot, now, adviceFor],
  );
  const selected = useMemo(() => {
    const itinerary = plan?.pool.find((option) => option.key === trip?.selectedKey);
    if (!plan || !itinerary) return null;
    const option = liveOptions(
      { ...plan, pool: [itinerary], best: [itinerary] },
      snapshot,
      now,
      true,
    )[0];
    return option ? adviceFor(option) : null;
  }, [plan, trip?.selectedKey, snapshot, now, adviceFor]);
  const advice = trip?.selectedKey
    ? selected
    : (choices.find((choice) => choice.feasible && choice.option.itinerary.rides.length > 0) ??
      choices.find((choice) => choice.feasible) ??
      null);
  const alternative =
    choices.find(
      (choice) => choice.feasible && choice.option.scheduleKey !== advice?.option.scheduleKey,
    ) ?? null;
  const near = !!plan && Math.abs(plan.request.at - minute) <= 3 * 3_600_000;
  const query = useMemo(() => {
    if (!plan || !schedule || !near) return null;
    const chosen = plan.pool.find((option) => option.key === trip?.selectedKey);
    const prioritized = chosen ? { ...plan, best: [chosen, ...plan.best] } : plan;
    const stops = planLiveStops(prioritized, 8);
    return stops.length
      ? buildLiveQuery(schedule, { stopIds: stops, trips: [], routeIds: [] })
      : null;
  }, [plan, schedule, trip?.selectedKey, near]);
  const controller = useRef<ReturnType<typeof createTransitLiveClient> | null>(null);
  useEffect(() => {
    if (!schedule) return;
    const client = createTransitLiveClient({ schedule, config, onState: setLive });
    controller.current = client;
    return () => {
      client.dispose();
      controller.current = null;
    };
  }, [schedule, config]);
  useEffect(() => {
    controller.current?.setQuery(query);
  }, [schedule, config, query]);
  const visible = Object.values(surfaces).some(Boolean) && !surfaces.transit;
  useEffect(() => {
    controller.current?.setForeground(active && visible);
  }, [schedule, config, active, visible]);

  const blockedWorkout =
    !!workoutId && (!workout || workoutId !== sessionId || origin?.gym_id !== workout.gymId);
  const missingPlace = !loading && !!trip && (!origin || !destination);
  const reminders = travelReminders(
    trip,
    blockedWorkout || missingPlace ? null : advice,
    saved.preferences,
    destination?.name ?? '',
    now,
  );
  const reminderKey = JSON.stringify(reminders);
  const retry = walkRevision;
  useEffect(() => {
    if (loading) return;
    if (
      trip?.reminders &&
      (!plan || searching || (!!workoutId && workoutId === sessionId && !timing)) &&
      !problem &&
      !missingPlace
    )
      return;
    let alive = true;
    openDatabase()
      .then((db) => syncTransitReminders(db, trip, JSON.parse(reminderKey)))
      .then((status) => {
        if (alive) {
          setNotificationStatus(status);
          setNotificationProblem(null);
        }
      })
      .catch((error) => {
        if (alive) setNotificationProblem(message(error));
      });
    return () => {
      alive = false;
    };
  }, [
    trip,
    reminderKey,
    loading,
    retry,
    plan,
    searching,
    workoutId,
    sessionId,
    timing,
    problem,
    missingPlace,
  ]);

  const write = useCallback(async (next: JourneyState) => {
    if (pendingWrite.current) throw new Error('Espera a que termine de guardar el viaje.');
    pendingWrite.current = true;
    setBusy(true);
    try {
      const db = await openDatabase();
      const replaced = current.current.next?.id !== next.next?.id;
      await saveJourneyState(db, next);
      current.current = next;
      setSaved(next);
      setProblem(null);
      if (replaced || !next.next?.reminders) await syncTransitReminders(db, next.next, []);
    } catch (error) {
      setProblem(message(error));
      throw error;
    } finally {
      pendingWrite.current = false;
      setBusy(false);
    }
  }, []);
  const latest = useRef({ advice, plan });
  useEffect(() => {
    latest.current = { advice, plan };
  }, [advice, plan]);
  const actions = useMemo<Actions>(
    () => ({
      refresh,
      choose: async (choice) => {
        if (choice.originId === choice.destinationId)
          throw new Error('Elige dos lugares distintos.');
        await write({
          ...current.current,
          next: {
            id: `${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
            originId: choice.originId,
            destinationId: choice.destinationId,
            mode: choice.mode ?? 'now',
            at: choice.at ?? Date.now(),
            workoutId: choice.workoutId ?? null,
            selectedKey: choice.selectedKey ?? null,
            selectedAt: choice.selectedKey ? Date.now() : null,
            reminders: false,
          },
        });
      },
      select: async (option) => {
        const next = current.current.next;
        if (!next || !latest.current.plan) return;
        await write({
          ...current.current,
          next: {
            ...next,
            id: `${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
            selectedKey: option.scheduleKey,
            selectedAt: Date.now(),
            at: latest.current.plan.request.at,
          },
        });
      },
      arm: async (enabled) => {
        const next = current.current.next;
        const choice = latest.current.advice;
        if (!next || (enabled && (!choice?.feasible || !latest.current.plan))) return;
        await write({
          ...current.current,
          next: {
            ...next,
            reminders: enabled,
            ...(enabled && choice && latest.current.plan
              ? {
                  selectedKey: choice.option.scheduleKey,
                  selectedAt: next.selectedAt ?? Date.now(),
                  at: latest.current.plan.request.at,
                }
              : {}),
          },
        });
      },
      clear: () => write({ ...current.current, next: null }),
      preferences: async (preferences) => {
        const error = travelPreferencesProblem(preferences);
        if (error) throw new Error(error);
        await write({ ...current.current, preferences });
      },
      visible: (surface, value) =>
        setSurfaces((old) => (old[surface] === value ? old : { ...old, [surface]: value })),
      snapshot: (value) => setExternal(value),
      schedule: (value) => setCache((old) => (old?.sha256 === value.sha256 ? old : value)),
    }),
    [refresh, write],
  );
  const view: ViewState = {
    saved,
    places,
    workout,
    gymId: session?.gym_id ?? null,
    sessionId,
    advice:
      blockedWorkout && advice
        ? {
            ...advice,
            feasible: false,
            reason:
              'No se pudo leer el entreno de este viaje. Revisa el origen y vuelve a elegirlo.',
          }
        : advice,
    alternative,
    result: plan,
    query,
    loading: loading || searching || (!!trip && !cache),
    busy,
    problem:
      problem ??
      (missingPlace
        ? 'Falta un lugar del viaje guardado. Vuelve a elegir origen y destino.'
        : null),
    notificationStatus,
    notificationProblem,
    now,
  };
  // The map screen consumes stable trip selection, never the card's ticking estimate.
  const gymId = session?.gym_id ?? null;
  const link = useMemo(
    () => ({ saved, gymId, sessionId, query, actions }),
    [saved, gymId, sessionId, query, actions],
  );
  return (
    <ActionsContext.Provider value={actions}>
      <LinkContext.Provider value={link}>
        <ViewContext.Provider value={view}>{children}</ViewContext.Provider>
      </LinkContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useTransitJourneyLink() {
  const link = useContext(LinkContext);
  if (!link) throw new Error('TransitJourneyProvider is missing.');
  return link;
}

export function useTransitJourney() {
  const view = useContext(ViewContext);
  const actions = useContext(ActionsContext);
  if (!view || !actions) throw new Error('TransitJourneyProvider is missing.');
  return { ...view, actions };
}
