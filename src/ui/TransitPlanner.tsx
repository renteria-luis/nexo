import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { IsoDate } from '../core/dates.ts';
import { distanceMetres, headingTo, type Coordinates } from '../core/geo.ts';
import type { TripPoint, TripWalk } from '../transit/active-trip.ts';
import { itineraryPaths } from '../transit/map.ts';
import {
  ACCESS_RADIUS_M,
  liveOptions,
  planLiveStops,
  rideAlerts,
  runPlan,
  sharedPlannerIndex,
  startPlan,
  type PlanMode,
  type PlanOption,
  type PlanRequest,
  type PlanResult,
  type Ride,
  type RideLive,
  type Walk,
} from '../transit/planner.ts';
import { observedServiceTrips, stopClosure, type LiveSnapshot } from '../transit/realtime.ts';
import {
  closedStops,
  COST,
  stopChoices,
  STOP_CHOICES,
  STOP_REACH_M,
  type StopChoice,
} from '../transit/stop-choices.ts';
import type { NextTrip } from '../transit/journey.ts';
import {
  agencyClock,
  agencyDate,
  departures,
  queryInstant,
  type buildStopIndex,
  type Departure,
  type Route,
  type Schedule,
  type Stop,
} from '../transit/schedule.ts';
import {
  listStopWalks,
  listWalkLinks,
  nearestPlace,
  saveStopWalk,
  saveWalkLink,
  type Place,
  type StopWalk,
  type WalkLink,
} from '../transit/store.ts';
import { listAcceptedWalks } from '../transit/trip-store.ts';
import { learnedWalks, personalWalks, type LearnedWalk } from '../transit/walks.ts';
import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { Chip } from './Chip.tsx';
import { Combobox, type Option } from './Combobox.tsx';
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  Footprints,
  LocateFixed,
  MapPin,
  MapPinned,
  Pencil,
  Search,
  TriangleAlert,
  X,
} from './icons.ts';
import { IconButton } from './IconButton.tsx';
import { placeOptions } from './placeIcons.ts';
import { stopChoiceColor } from './routeColors.ts';
import { TextField } from './TextField.tsx';
import {
  dayOf,
  destination,
  relative,
  stopName,
  TransitTripTimeline,
  useLiveClock,
} from './TransitDepartures.tsx';
import { RouteBadge, StatusIcons } from './TransitStatus.tsx';
import { TransitWhen } from './TransitWhen.tsx';
import { TransitPlanMap, type MapEnd } from './TransitPlanMap.tsx';
import { useScrollIntoView } from './screens/Screen.tsx';
import { font, glass, shape, sheet, theme } from './theme.ts';

/** What the planner wants read live: the stops of its best options and a ride he opened. */
export type PlannerLive = { stops: string[]; ride: Departure | null };

const SHOWN = 5;
// Live data only helps for buses about to run; a plan for tomorrow asks LTC for nothing.
const LIVE_HORIZON_MS = 3 * 3_600_000;
const STALE_NOW_MS = 5 * 60_000;

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const samePlaces = (a: PlanRequest, b: PlanRequest) =>
  a.origin.lat === b.origin.lat &&
  a.origin.lng === b.origin.lng &&
  a.destination.lat === b.destination.lat &&
  a.destination.lng === b.destination.lng;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const clock = agencyClock;
const minutesOf = (ms: number) => Math.round(ms / 60_000);

type Walks = {
  key: string;
  origin: WalkLink[];
  destination: WalkLink[];
  stops: StopWalk[];
  learned: Map<string, LearnedWalk>;
};
type WalkEdit = { kind: 'access' | 'transfer' | 'egress'; walk: Walk };

// Ends of the trip that are not saved places, as the pickers name them.
const HERE = '@here';
const POINT = '@point';
const MAP = '@map';
const SEARCH = '@search';
// Within this of a saved place, where he is counts as that place, with his walks from it.
const HERE_PLACE_M = 60;
const NONE: string[] = [];

type Side = 'origin' | 'target';
/** A point he chose on the map or found by its address. */
type ChosenPoint = Coordinates & { name: string };
/** One end of the trip: a saved place, where he is, or a point he chose. */
type End = MapEnd & { place: Place | null; here: boolean };

function endOf(
  id: string | null,
  side: Side,
  point: ChosenPoint | null,
  places: readonly Place[],
  here: { point: Coordinates } | null,
): End | undefined {
  if (id === HERE) {
    if (!here) return undefined;
    const near = nearestPlace(places, here.point);
    if (near && distanceMetres(near, here.point) <= HERE_PLACE_M)
      return {
        lat: near.lat,
        lng: near.lng,
        id: near.id,
        name: `Tu ubicación · ${near.name}`,
        saved: true,
        place: near,
        here: true,
      };
    return { ...here.point, id: HERE, name: 'Tu ubicación', saved: false, place: null, here: true };
  }
  if (id === POINT)
    return point
      ? {
          lat: point.lat,
          lng: point.lng,
          id: `${POINT}-${side}`,
          name: point.name,
          saved: false,
          place: null,
          here: false,
        }
      : undefined;
  const place = places.find((p) => p.id === id);
  return place
    ? {
        lat: place.lat,
        lng: place.lng,
        id: place.id,
        name: place.name,
        saved: true,
        place,
        here: false,
      }
    : undefined;
}

/** Leaving now, a stop he tapped: a small window over the map, its lines, or its buses. */
type StopView = 'menu' | 'lines' | 'buses';
/** What the stop list tells the map: its stops in order, and which to read live. */
type StopSummary = {
  key: string;
  stops: {
    stop: number;
    /** Its number, nearest first; null where LTC has it closed. */
    rank: number | null;
    walk: Pick<Walk, 'metres' | 'minutes' | 'source'>;
    routes: Route[];
    reason: string | null;
  }[];
  live: string[];
};
const EMPTY_SUMMARY: StopSummary = { key: '', stops: [], live: [] };

export function TransitPlanner({
  db,
  schedule,
  stopIndex,
  places,
  here,
  onLocate,
  onFindAddress,
  snapshot,
  active,
  today,
  walksVersion,
  onWalkChanged,
  onLive,
  onFocusBus,
  journey,
  onSelectJourney,
  onLeave,
  refreshAt = 0,
  onMapInteraction,
  onPlacesChange,
}: {
  db: SQLiteDatabase;
  schedule: Schedule;
  stopIndex: ReturnType<typeof buildStopIndex>;
  places: Place[];
  /** Where he is, as last read, and when that reading was asked for. */
  here: { point: Coordinates; at: number } | null;
  /** Reads where he is again. */
  onLocate: () => void;
  /** Where an address he typed is, or null when nothing matches. */
  onFindAddress: (text: string) => Promise<Coordinates | null>;
  refreshAt?: number;
  onMapInteraction?: (active: boolean) => void;
  onPlacesChange?: (ids: string[]) => void;
  snapshot: LiveSnapshot | null;
  active: boolean;
  today: IsoDate;
  /** Changes when a walk is saved elsewhere on the screen. */
  walksVersion: number;
  onWalkChanged?: () => void;
  onLive: (live: PlannerLive) => void;
  /** Shows an opened bus on the screen's map. */
  onFocusBus?: (departure: Departure) => void;
  /** The saved next trip: it opens here, and one chosen elsewhere replaces what is shown. */
  journey?: NextTrip | null;
  onSelectJourney?: (
    choice: { originId: string; destinationId: string; mode: PlanMode; at: number },
    option: PlanOption,
  ) => Promise<void>;
  /** Leaves now on a bus he picked, from where he is. */
  onLeave?: (input: {
    option: PlanOption;
    schedule: Schedule;
    origin: TripPoint;
    destination: TripPoint;
    paths: Partial<Record<TripWalk['kind'], Coordinates[]>>;
  }) => Promise<void>;
}) {
  const [originId, setOriginId] = useState<string | null>(journey?.originId ?? HERE);
  const [originPoint, setOriginPoint] = useState<ChosenPoint | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(journey?.selectedKey ?? null);
  const [mapOption, setMapOption] = useState<PlanOption | null>(null);
  const [mapFocus, setMapFocus] = useState<{ departure: Departure; at: number } | null>(null);
  // Leaving now: the stop he tapped, and whether he looks at its lines or picks its buses.
  const [stopPick, setStopPick] = useState<{ stop: number; view: StopView } | null>(null);
  const [line, setLine] = useState<Departure | null>(null);
  const [pointFocus, setPointFocus] = useState<{ key: number; point: Coordinates } | null>(null);
  // Which end a tap on the map sets, while he chooses a point there.
  const [picking, setPicking] = useState<Side | null>(null);
  const [address, setAddress] = useState<{ text: string; busy: boolean } | null>(null);
  const mapBlock = useRef<View>(null);
  const scrollIntoView = useScrollIntoView();
  const focusBus = (departure: Departure) => {
    setMapFocus({ departure, at: Date.now() });
    scrollIntoView(mapBlock.current);
    onFocusBus?.(departure);
  };
  const [targetId, setTargetId] = useState<string | null>(journey?.destinationId ?? null);
  const [targetPoint, setTargetPoint] = useState<ChosenPoint | null>(null);
  // The chip he picked, and the search it last applied: a time to leave at or arrive by is only
  // searched once he chooses it.
  const [mode, setMode] = useState<PlanMode>(journey?.mode ?? 'now');
  const [applied, setApplied] = useState<{ mode: PlanMode; at: number }>(() => ({
    mode: journey?.mode ?? 'now',
    at: journey?.at ?? Date.now(),
  }));
  const [date, setDate] = useState(() => agencyDate(journey?.at ?? Date.now()));
  const [time, setTime] = useState(() => agencyClock(journey?.at ?? Date.now()));
  const [walks, setWalks] = useState<Walks | null>(null);
  const [saved, setSaved] = useState(0);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [failed, setFailed] = useState<{ request: PlanRequest; reason: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [openRide, setOpenRide] = useState<{ key: string; departure: Departure } | null>(null);
  const resetOpen = () => {
    setOpenRide(null);
    setOpenKey(null);
    setMapFocus(null);
    setStopPick(null);
    setLine(null);
  };
  // The trip starts where he opened Transit, unless he chose its start after that reading was
  // asked for.
  const [seenRefresh, setSeenRefresh] = useState(refreshAt);
  if (seenRefresh !== refreshAt) {
    setSeenRefresh(refreshAt);
    if (mode === 'now') setApplied({ mode: 'now', at: refreshAt });
  }
  const [originChosenAt, setOriginChosenAt] = useState(() => (journey ? Date.now() : 0));
  // The option he chose here shows as chosen at once, and the list stays as it is; a trip chosen
  // in Hoy or from a notice is shown in its place.
  const [chosenKey, setChosenKey] = useState(journey?.selectedKey ?? null);
  const journeySeen = `${journey?.id}|${journey?.selectedKey}`;
  const [seenJourney, setSeenJourney] = useState(journeySeen);
  if (seenJourney !== journeySeen) {
    setSeenJourney(journeySeen);
    setChosenKey(journey?.selectedKey ?? null);
    if (journey && journey.selectedKey !== chosenKey) {
      setOriginId(journey.originId);
      // When it was chosen: a selected bus, or else the moment a trip without one was saved.
      setOriginChosenAt(journey.selectedAt ?? journey.at);
      setTargetId(journey.destinationId);
      setMode(journey.mode);
      setApplied({ mode: journey.mode, at: journey.at });
      setDate(agencyDate(journey.at));
      setTime(agencyClock(journey.at));
      resetOpen();
      setOpenKey(journey.selectedKey);
    }
  }
  const [seenHere, setSeenHere] = useState<number | null>(null);
  if (here && seenHere !== here.at) {
    setSeenHere(here.at);
    if (originChosenAt < here.at && originId !== HERE) {
      setOriginId(HERE);
      resetOpen();
    }
  }
  const origin = useMemo(
    () => endOf(originId, 'origin', originPoint, places, here),
    [originId, originPoint, places, here],
  );
  const target = useMemo(
    () => endOf(targetId, 'target', targetPoint, places, null),
    [targetId, targetPoint, places],
  );
  const originPlaceId = origin?.place?.id;
  const targetPlaceId = target?.place?.id;
  useEffect(() => {
    onPlacesChange?.([
      ...new Set([originPlaceId, targetPlaceId].filter((id): id is string => !!id)),
    ]);
  }, [originPlaceId, targetPlaceId, onPlacesChange]);
  const options = useMemo(() => placeOptions(places), [places]);
  const originOptions = useMemo<Option[]>(
    () => [
      // Its button beside the list picks it.
      {
        id: HERE,
        label: origin?.here ? origin.name : 'Tu ubicación',
        icon: LocateFixed,
        hidden: true,
      },
      ...(originPoint ? [{ id: POINT, label: originPoint.name, icon: MapPin }] : []),
      { id: MAP, label: 'Punto en el mapa', icon: MapPinned },
      ...options,
    ],
    [options, originPoint, origin],
  );
  const targetOptions = useMemo<Option[]>(
    () => [
      ...(targetPoint ? [{ id: POINT, label: targetPoint.name, icon: MapPin }] : []),
      { id: SEARCH, label: 'Buscar una dirección', icon: Search, keywords: 'calle' },
      { id: MAP, label: 'Punto en el mapa', icon: MapPinned },
      ...options,
    ],
    [options, targetPoint],
  );

  const pairKey = origin && target && origin.id !== target.id ? `${origin.id}/${target.id}` : null;
  useEffect(() => {
    if (!pairKey) return;
    let alive = true;
    const [from, to] = pairKey.split('/');
    // A point that is not a saved place has no walks of his.
    const linksOf = (id: string) => (id.startsWith('@') ? [] : listWalkLinks(db, id));
    Promise.all([linksOf(from), linksOf(to), listStopWalks(db), listAcceptedWalks(db)])
      .then(([o, d, s, accepted]) => {
        if (alive)
          setWalks({
            key: pairKey,
            origin: o,
            destination: d,
            stops: s,
            learned: learnedWalks(accepted),
          });
      })
      .catch((error) => {
        if (alive) setProblem(message(error));
      });
    return () => {
      alive = false;
    };
  }, [db, pairKey, walksVersion, saved]);

  const fromLat = origin?.lat;
  const fromLng = origin?.lng;
  const toLat = target?.lat;
  const toLng = target?.lng;
  // How far the search looks for stops, and the stops LTC has closed, for these ends only.
  const endsKey = `${pairKey}|${fromLat},${fromLng}|${toLat},${toLng}|${applied.mode}`;
  const [reach, setReach] = useState({ key: '', access: 0, egress: 0 });
  const accessReach = reach.key === endsKey ? reach.access : 0;
  const egressReach = reach.key === endsKey ? reach.egress : 0;
  const widen = useCallback(
    (side: 'access' | 'egress') =>
      setReach((old) => {
        const base = old.key === endsKey ? old : { key: endsKey, access: 0, egress: 0 };
        return base[side] + 1 < STOP_REACH_M.length ? { ...base, [side]: base[side] + 1 } : base;
      }),
    [endsKey],
  );
  const [closed, setClosed] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] });
  const closedIds = closed.key === endsKey ? closed.ids : NONE;
  const closedKey = closedIds.join();
  const onClosed = useCallback(
    (ids: string[]) =>
      setClosed((old) =>
        old.key === endsKey && old.ids.join() === ids.join() ? old : { key: endsKey, ids },
      ),
    [endsKey],
  );
  const observedKey = JSON.stringify(
    observedServiceTrips(schedule, snapshot, snapshot?.generatedAt ?? 0),
  );
  const request = useMemo<PlanRequest | null>(() => {
    if (!pairKey || !walks || walks.key !== pairKey) return null;
    if (
      fromLat === undefined ||
      fromLng === undefined ||
      toLat === undefined ||
      toLng === undefined
    )
      return null;
    const [originId, destinationId] = pairKey.split('/');
    return {
      origin: { lat: fromLat, lng: fromLng },
      destination: { lat: toLat, lng: toLng },
      ...personalWalks({
        originId,
        destinationId,
        origin: walks.origin,
        destination: walks.destination,
        stops: walks.stops,
        learned: walks.learned,
      }),
      accessRadiusM: STOP_REACH_M[accessReach],
      egressRadiusM: STOP_REACH_M[egressReach],
      closedStops: closedKey ? closedKey.split(',') : [],
      mode: applied.mode,
      at: applied.at,
      observedTrips: JSON.parse(observedKey),
    };
  }, [
    pairKey,
    walks,
    fromLat,
    fromLng,
    toLat,
    toLng,
    applied,
    observedKey,
    accessReach,
    egressReach,
    closedKey,
  ]);

  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    if (!request) return;
    const cancelled = () => token !== generation.current;
    void (async () => {
      try {
        // The tap that started it paints first; the search then gives the screen a frame
        // between slices.
        await pause();
        if (cancelled()) return;
        const found = await runPlan(startPlan(sharedPlannerIndex(schedule), request), {
          pause,
          cancelled,
        });
        if (found && !cancelled()) setResult(found);
      } catch (error) {
        if (!cancelled()) setFailed({ request, reason: message(error) });
      }
    })();
  }, [schedule, request]);
  // A new search keeps the last list on screen while it runs, unless it was for other places.
  const shownResult =
    result &&
    request &&
    result.context.index.schedule === schedule &&
    samePlaces(result.request, request)
      ? result
      : null;
  const searchFailed = failed?.request === request ? failed.reason : null;
  const searching = request !== null && result?.request !== request && !searchFailed;
  const final = !!shownResult && shownResult.request === request;
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  // Far from every stop, the search looks farther before saying there is none.
  const wider =
    final && shownResult.issue === 'no-origin-stops'
      ? 'access'
      : final && shownResult.issue === 'no-destination-stops'
        ? 'egress'
        : null;
  const [widened, setWidened] = useState<PlanResult | null>(null);
  if (wider && widened !== shownResult) {
    setWidened(shownResult);
    widen(wider);
  }

  const leavingNow = applied.mode === 'now' && mode === 'now';
  const [summary, setSummary] = useState<StopSummary>(EMPTY_SUMMARY);
  const onSummary = useCallback(
    (next: StopSummary) => setSummary((old) => (old.key === next.key ? old : next)),
    [],
  );
  const shownSummary = leavingNow && shownResult ? summary : EMPTY_SUMMARY;
  const picked = stopPick
    ? (shownSummary.stops.find((stop) => stop.stop === stopPick.stop) ?? null)
    : null;
  const mapChoices = useMemo(
    () =>
      shownSummary.stops.map((stop) => {
        const row = schedule.stops[stop.stop];
        return {
          id: row[0],
          lat: row[3],
          lng: row[4],
          label: `${stop.rank === null ? 'Cerrado' : `Paradero ${stop.rank}`}: ${stopName(row)}`,
          rank: stop.rank,
          selected: stop.stop === stopPick?.stop,
        };
      }),
    [schedule, shownSummary, stopPick?.stop],
  );
  const pickStop = useCallback(
    (stop: number, view: StopView) => {
      setStopPick({ stop, view });
      setLine(null);
      setOpenKey(null);
      setOpenRide(null);
      setMapFocus(null);
      const row = schedule.stops[stop];
      setPointFocus({ key: Date.now(), point: { lat: row[3], lng: row[4] } });
      if (view === 'menu') scrollIntoView(mapBlock.current);
    },
    [schedule, scrollIntoView],
  );
  const onChoice = useCallback(
    (id: string) => {
      const stop = sharedPlannerIndex(schedule).stopIds.get(id);
      if (stop !== undefined) pickStop(stop, 'menu');
    },
    [schedule, pickStop],
  );

  const mappedOption = mapOption?.scheduleKey === openKey && shownResult ? mapOption : null;
  const openDeparture =
    openRide?.departure ?? line ?? mappedOption?.itinerary.rides[0]?.departure ?? null;
  useEffect(() => {
    const near =
      shownResult !== null &&
      (shownResult.request.mode === 'now' ||
        Math.abs(shownResult.request.at - Date.now()) < LIVE_HORIZON_MS);
    onLive({
      stops: !near
        ? []
        : shownResult.request.mode === 'now'
          ? shownSummary.live
          : planLiveStops(shownResult, 7),
      ride: openDeparture,
    });
  }, [shownResult, shownSummary, openDeparture, onLive]);
  useEffect(() => () => onLive({ stops: [], ride: null }), [onLive]);

  const refreshNow = useCallback(() => setApplied({ mode: 'now', at: Date.now() }), []);
  const pick = (which: Side, id: string | null) => {
    setProblem(null);
    if (id === MAP) {
      setPicking(which);
      setAddress(null);
      scrollIntoView(mapBlock.current);
      return;
    }
    if (id === SEARCH) {
      setAddress({ text: '', busy: false });
      setPicking(null);
      return;
    }
    if (which === 'origin') {
      setOriginId(id);
      setOriginChosenAt(Date.now());
      if (id === HERE) onLocate();
    } else setTargetId(id);
    setPicking(null);
    resetOpen();
    if (applied.mode === 'now') refreshNow();
  };
  const pickPoint = (point: Coordinates) => {
    if (!picking) return;
    const chosen = { ...point, name: 'Punto en el mapa' };
    if (picking === 'origin') {
      setOriginPoint(chosen);
      setOriginId(POINT);
      setOriginChosenAt(Date.now());
    } else {
      setTargetPoint(chosen);
      setTargetId(POINT);
    }
    setPicking(null);
    resetOpen();
    if (applied.mode === 'now') refreshNow();
  };
  const findAddress = () => {
    const text = address?.text.trim();
    if (!text) return;
    setAddress({ text, busy: true });
    setProblem(null);
    onFindAddress(text)
      .then((point) => {
        if (!point) {
          setAddress({ text, busy: false });
          setProblem('No encontré esa dirección en London. Prueba con el número y la calle.');
          return;
        }
        setTargetPoint({ ...point, name: text });
        setTargetId(POINT);
        setAddress(null);
        resetOpen();
        if (applied.mode === 'now') refreshNow();
      })
      .catch((error: unknown) => {
        setAddress({ text, busy: false });
        setProblem(message(error));
      });
  };
  // Where he is cannot be the destination unless it is one of his saved places.
  const canSwap = !!originId && !!targetId && (originId !== HERE || !!origin?.place);
  const swap = () => {
    if (!canSwap) return;
    const nextTargetId = originId === HERE ? (origin?.place?.id ?? null) : originId;
    const nextTargetPoint = originId === HERE ? null : originPoint;
    setOriginId(targetId);
    setOriginPoint(targetPoint);
    setOriginChosenAt(Date.now());
    setTargetId(nextTargetId);
    setTargetPoint(nextTargetPoint);
    resetOpen();
    setProblem(null);
    if (applied.mode === 'now') refreshNow();
  };
  const choose = (next: PlanMode) => {
    setMode(next);
    resetOpen();
    setProblem(null);
    if (next === 'now') {
      refreshNow();
      return;
    }
    const now = Date.now();
    setDate(agencyDate(now));
    setTime(agencyClock(now));
  };
  const saveWalk = useCallback(
    async ({ kind, walk }: WalkEdit, minutes: number) => {
      if (!origin || !target || !walks) return;
      const id = (stop: number | null) => schedule.stops[stop!][0];
      if (kind === 'transfer') {
        const existing = walks.stops.find(
          (w) => w.from_stop === id(walk.from) && w.to_stop === id(walk.to),
        );
        await saveStopWalk(db, {
          from_stop: id(walk.from),
          to_stop: id(walk.to),
          minutes,
          note: existing?.note ?? '',
        });
      } else {
        const place = kind === 'access' ? origin.place : target.place;
        if (!place) throw new Error('Tus minutos se guardan desde o hasta un lugar guardado.');
        const stop = id(kind === 'access' ? walk.to : walk.from);
        const direction = kind === 'access' ? 'to_stop' : 'from_stop';
        const existing = (kind === 'access' ? walks.origin : walks.destination).find(
          (l) => l.stop_id === stop && l.direction === direction,
        );
        await saveWalkLink(db, {
          place_id: place.id,
          stop_id: stop,
          direction,
          minutes,
          entrance: existing?.entrance ?? '',
        });
      }
      setSaved((n) => n + 1);
      onWalkChanged?.();
    },
    [db, schedule, origin, target, walks, onWalkChanged],
  );
  const links = useMemo(
    () => (walks?.key === pairKey ? [...walks.origin, ...walks.destination] : []),
    [walks, pairKey],
  );
  const savable = useMemo(
    () => ({ access: !!origin?.place, egress: !!target?.place }),
    [origin, target],
  );
  // He leaves from where he is; a point he chose on the map is only looked at.
  const leave =
    onLeave && origin?.here && target
      ? async (option: PlanOption) => {
          const paths: Partial<Record<TripWalk['kind'], Coordinates[]>> = {};
          for (const path of itineraryPaths(
            schedule,
            option.itinerary,
            origin,
            target,
            links,
            walks?.stops ?? [],
          ))
            if (path.dashed && path.points.length > 2)
              paths[path.id as TripWalk['kind']] = path.points;
          const end = (value: End): TripPoint => ({
            id: value.id,
            name: value.name,
            lat: value.lat,
            lng: value.lng,
            point: !value.place,
          });
          await onLeave({ option, schedule, origin: end(origin), destination: end(target), paths });
        }
      : undefined;
  const select =
    onSelectJourney && origin?.place && target?.place && shownResult
      ? async (option: PlanOption) => {
          const before = chosenKey;
          setChosenKey(option.scheduleKey);
          try {
            await onSelectJourney(
              {
                originId: origin.place!.id,
                destinationId: target.place!.id,
                mode: shownResult.request.mode,
                at: shownResult.request.at,
              },
              option,
            );
          } catch (error) {
            setChosenKey(before);
            throw error;
          }
        }
      : undefined;

  return (
    <Card title="Cómo llegar">
      <PlaceRow
        onClear={() => pick('origin', null)}
        label="Desde"
        options={originOptions}
        selected={originId === POINT && !originPoint ? null : originId}
        placeholder="Elige de dónde sales"
        accessibilityLabel="Elegir el origen"
        onPick={(id) => pick('origin', id)}
      >
        <IconButton
          icon={LocateFixed}
          accessibilityLabel="Salir desde tu ubicación"
          selected={originId === HERE}
          onPress={() => pick('origin', HERE)}
          style={styles.swap}
        />
      </PlaceRow>
      {originId === HERE && !here && (
        <View style={styles.walkLine}>
          <Text style={[styles.note, styles.grow]}>
            Todavía no sé dónde estás. Revisa el permiso de ubicación de Nexo.
          </Text>
          <Button label="Leer ubicación" variant="ghost" onPress={onLocate} />
        </View>
      )}
      <PlaceRow
        onClear={() => pick('target', null)}
        label="Hasta"
        options={targetOptions}
        selected={targetId === POINT && !targetPoint ? null : targetId}
        placeholder="Elige a dónde vas"
        accessibilityLabel="Elegir el destino"
        onPick={(id) => pick('target', id)}
      >
        <IconButton
          icon={ArrowUpDown}
          accessibilityLabel="Invertir origen y destino"
          disabled={!canSwap}
          onPress={swap}
          style={styles.swap}
        />
      </PlaceRow>
      {address && (
        <View style={styles.editor}>
          <TextField
            accessibilityLabel="Dirección del destino"
            value={address.text}
            onChange={(text) => setAddress({ text, busy: false })}
            placeholder="Número y calle, por ejemplo 1680 Richmond St"
            style={styles.input}
          />
          <View style={styles.wrap}>
            <Button
              label="Buscar"
              icon={Search}
              variant="primary"
              loading={address.busy}
              disabled={!address.text.trim()}
              onPress={findAddress}
            />
            <Button label="Cancelar" variant="ghost" onPress={() => setAddress(null)} />
          </View>
          <Text style={styles.note}>
            La busca el buscador de Apple, que recibe lo que escribes.
          </Text>
        </View>
      )}
      {picking && (
        <View style={styles.walkLine}>
          <Text style={[styles.body, styles.grow]}>
            Toca el mapa donde {picking === 'origin' ? 'sales' : 'vas'}.
          </Text>
          <Button label="Cancelar" variant="ghost" onPress={() => setPicking(null)} />
        </View>
      )}
      <View style={styles.wrap}>
        <Chip label="Salir ahora" selected={mode === 'now'} onPress={() => choose('now')} />
        <Chip label="Salir a las…" selected={mode === 'depart'} onPress={() => choose('depart')} />
        <Chip
          label="Llegar antes de…"
          selected={mode === 'arrive'}
          onPress={() => choose('arrive')}
        />
      </View>
      {mode !== 'now' && (
        <TransitWhen
          key={mode}
          initiallyOpen={applied.mode !== mode}
          live={false}
          date={date}
          clock={time}
          today={today}
          validFrom={schedule.validFrom}
          validTo={schedule.validTo}
          onDate={setDate}
          onClock={setTime}
          onApply={() => {
            try {
              setApplied({ mode, at: queryInstant(date, time) });
              resetOpen();
              setProblem(null);
              return true;
            } catch (error) {
              setProblem(message(error));
              return false;
            }
          }}
          onNow={() => choose('now')}
          label="Elegir día y hora del viaje"
          applyLabel="Buscar viajes"
        />
      )}
      {(problem ?? searchFailed) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {problem ?? searchFailed}
        </Text>
      )}
      <View ref={mapBlock} collapsable={false}>
        <TransitPlanMap
          schedule={schedule}
          places={places}
          origin={origin}
          target={target}
          option={mappedOption}
          links={links}
          transfers={walks?.stops ?? []}
          snapshot={snapshot}
          active={active}
          focus={mapFocus}
          line={line}
          choices={mapChoices}
          onChoice={onChoice}
          pointFocus={pointFocus}
          onPoint={picking ? pickPoint : undefined}
          popup={
            picked &&
            origin &&
            stopPick?.view === 'menu' && (
              <StopPopup
                schedule={schedule}
                summary={picked}
                from={origin}
                onView={(view) => pickStop(picked.stop, view)}
                onClose={() => setStopPick(null)}
              />
            )
          }
          onInteraction={onMapInteraction}
        />
      </View>
      {!origin ? (
        <Text style={styles.note}>Elige de dónde sales.</Text>
      ) : !target ? (
        <Text style={styles.note}>Elige a dónde vas.</Text>
      ) : applied.mode !== mode ? (
        <Text style={styles.note}>Elige el día y la hora y toca Buscar viajes.</Text>
      ) : !pairKey ? (
        <Text style={styles.note}>Elige dos lugares distintos.</Text>
      ) : !shownResult ? (
        searching && <ActivityIndicator />
      ) : leavingNow ? (
        <StopList
          schedule={schedule}
          stopIndex={stopIndex}
          result={shownResult}
          final={final}
          snapshot={snapshot}
          active={active}
          searching={searching}
          from={origin}
          originName={origin.name}
          targetName={target.name}
          closedIds={closedIds}
          pick={stopPick}
          line={line}
          savable={savable}
          openRide={openRide}
          open={openKey}
          chosenKey={chosenKey}
          onPick={pickStop}
          onBack={() => {
            setStopPick(null);
            setLine(null);
            setOpenKey(null);
            setOpenRide(null);
          }}
          onLine={setLine}
          onSummary={onSummary}
          onClosed={onClosed}
          onWiden={widen}
          onStale={refreshNow}
          onOpenRide={setOpenRide}
          onSaveWalk={saveWalk}
          onFocusBus={focusBus}
          onToggle={(key) => {
            setOpenKey(key);
            setOpenRide(null);
            setMapFocus(null);
          }}
          onMapOption={setMapOption}
          onLeave={leave}
          onSelect={select}
        />
      ) : (
        <PlanList
          schedule={schedule}
          stopIndex={stopIndex}
          result={shownResult}
          snapshot={snapshot}
          active={active}
          searching={searching}
          targetName={target.name}
          originName={origin.name}
          savable={savable}
          openRide={openRide}
          onOpenRide={setOpenRide}
          onStale={refreshNow}
          onSaveWalk={saveWalk}
          onFocusBus={focusBus}
          open={openKey}
          onToggle={(key) => {
            setOpenKey(key);
            setOpenRide(null);
            setMapFocus(null);
          }}
          onMapOption={setMapOption}
          chosenKey={chosenKey}
          onSelect={select}
        />
      )}
    </Card>
  );
}

const PlaceRow = memo(function PlaceRow({
  label,
  options,
  selected,
  placeholder,
  accessibilityLabel,
  onPick,
  onClear,
  children,
}: {
  label: string;
  options: readonly Option[];
  selected: string | null;
  placeholder: string;
  accessibilityLabel: string;
  onPick: (id: string) => void;
  onClear: () => void;
  /** Beside the list, as tall as it. */
  children?: ReactNode;
}) {
  return (
    <View style={styles.placeRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.pickerLine}>
        <View style={styles.grow}>
          <Combobox
            options={options}
            value={selected}
            onChange={onPick}
            placeholder={placeholder}
            accessibilityLabel={accessibilityLabel}
          />
        </View>
        {selected && (
          <IconButton
            icon={X}
            accessibilityLabel={`Quitar ${label.toLowerCase()}`}
            onPress={onClear}
          />
        )}
        {children}
      </View>
    </View>
  );
});

function issueText(result: PlanResult, originName: string, targetName: string): string | null {
  const { validFrom, validTo } = result.context.index.schedule;
  switch (result.issue) {
    case 'outside-validity':
      return `Esa fecha está fuera del horario guardado (${validFrom} a ${validTo}).`;
    case 'no-origin-stops':
      return `No hay paradas a 600 m de ${originName}. Guarda en Tu caminata los minutos a una parada más lejana.`;
    case 'no-destination-stops':
      return `No hay paradas a 600 m de ${targetName}. Guarda en Tu caminata los minutos desde una parada más lejana.`;
    case 'none':
      return 'No encontré viaje directo ni con un transbordo en esas horas. Puede necesitar dos transbordos, que todavía no se calculan.';
    default:
      return null;
  }
}

const PlanList = memo(function PlanList({
  schedule,
  stopIndex,
  result,
  snapshot,
  active,
  searching,
  originName,
  targetName,
  savable,
  openRide,
  onOpenRide,
  onStale,
  onSaveWalk,
  onFocusBus,
  open,
  onToggle,
  onMapOption,
  chosenKey,
  onSelect,
}: {
  schedule: Schedule;
  stopIndex: ReturnType<typeof buildStopIndex>;
  result: PlanResult;
  snapshot: LiveSnapshot | null;
  active: boolean;
  searching: boolean;
  originName: string;
  targetName: string;
  /** Which walks can keep his minutes: those from or to a saved place. */
  savable: { access: boolean; egress: boolean };
  openRide: { key: string; departure: Departure } | null;
  onOpenRide: (ride: { key: string; departure: Departure } | null) => void;
  onStale: () => void;
  onSaveWalk: (edit: WalkEdit, minutes: number) => Promise<void>;
  onFocusBus: (departure: Departure) => void;
  open: string | null;
  onToggle: (key: string | null) => void;
  onMapOption: (option: PlanOption | null) => void;
  chosenKey: string | null;
  onSelect?: (option: PlanOption) => Promise<void>;
}) {
  // Read again on returning to the app and on each reading, like the trip cards.
  const now = useLiveClock(active, snapshot);
  const [selecting, setSelecting] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const minute = Math.floor(now / 60_000) * 60_000;
  const stale = result.request.mode === 'now' && minute - result.request.at > STALE_NOW_MS;
  useEffect(() => {
    if (stale) onStale();
  }, [stale, onStale]);
  // Judged against the real time: a reading taken late in a minute is ahead of the minute's start
  // by more than the 30 s that live data may be ahead, and read as old.
  const options = useMemo(() => liveOptions(result, snapshot, now), [result, snapshot, now]);
  // The bus he just missed is there for reference and does not take one of the options' places.
  const limit = SHOWN + (options[0]?.missed ? 1 : 0);
  const count = more ? options.length : limit;
  const shown = result.request.mode === 'arrive' ? options.slice(-count) : options.slice(0, count);
  const expandedOption = shown.find((option) => option.scheduleKey === open) ?? null;
  useEffect(() => {
    onMapOption(expandedOption);
  }, [expandedOption, onMapOption]);
  const issue = issueText(result, originName, targetName);
  return (
    <View style={styles.list}>
      {selectionError && <Text style={styles.error}>{selectionError}</Text>}
      {issue && <Text style={result.issue === 'none' ? styles.body : styles.note}>{issue}</Text>}
      {searching && <Text style={styles.note}>Actualizando…</Text>}
      {shown.map((option) => (
        <PlanRow
          key={option.scheduleKey}
          option={option}
          now={minute}
          mode={result.request.mode}
          chosen={option.scheduleKey === chosenKey}
          expanded={open === option.scheduleKey}
          onToggle={() => onToggle(open === option.scheduleKey ? null : option.scheduleKey)}
        >
          {open === option.scheduleKey && (
            <>
              <PlanSteps
                schedule={schedule}
                stopIndex={stopIndex}
                option={option}
                snapshot={snapshot}
                active={active}
                now={minute}
                targetName={targetName}
                savable={savable}
                openRide={openRide}
                onOpenRide={onOpenRide}
                onSaveWalk={onSaveWalk}
                onFocusBus={onFocusBus}
              />
              {onSelect && option.scheduleKey === chosenKey ? (
                <Text style={styles.body}>
                  Viaje elegido. Arriba, en Tu viaje, tienes «Salgo ahora» y los avisos.
                </Text>
              ) : (
                onSelect && (
                  <Button
                    label="Elegir este viaje"
                    disabled={selecting || !!option.problem || option.leaveAt < now - 60_000}
                    onPress={() => {
                      setSelecting(true);
                      void onSelect(option)
                        .catch((error) => setSelectionError(message(error)))
                        .finally(() => setSelecting(false));
                    }}
                  />
                )
              )}
            </>
          )}
        </PlanRow>
      ))}
      {options.length > limit && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: more }}
          onPress={() => setMore(!more)}
          style={styles.more}
        >
          <Text style={styles.moreText}>
            {more ? 'Ver menos opciones' : `Ver ${options.length - limit} más`}
          </Text>
        </Pressable>
      )}
      <Text style={styles.note}>
        Ordenadas por la hora en que llegas a la puerta. Las caminatas sin tus minutos son estimadas
        a 4.5 km/h sobre 1.3 veces la línea recta; en la parada se cuentan 2 min antes del bus y en
        un transbordo 3 min libres.
      </Text>
    </View>
  );
});

function walkText(walk: StopSummary['stops'][number]['walk'], from: Coordinates, stop: Stop) {
  const source =
    walk.source === 'saved'
      ? 'tus minutos'
      : walk.source === 'learned'
        ? 'según tus caminatas'
        : 'estimado';
  return `${walk.minutes} min a pie (${source}) · ${Math.round(walk.metres)} m al ${headingTo(from, { lat: stop[3], lng: stop[4] })}`;
}

function StopBadge({ rank }: { rank: number | null }) {
  return (
    <View style={[styles.badge, { backgroundColor: stopChoiceColor(rank) }]}>
      {rank === null ? (
        <X size={14} color="#FFFFFF" strokeWidth={3} />
      ) : (
        <Text style={styles.badgeText}>{rank}</Text>
      )}
    </View>
  );
}

/** The small window over the map for a stop he tapped: look at its lines or pick its buses. */
function StopPopup({
  schedule,
  summary,
  from,
  onView,
  onClose,
}: {
  schedule: Schedule;
  summary: StopSummary['stops'][number];
  from: Coordinates;
  onView: (view: 'lines' | 'buses') => void;
  onClose: () => void;
}) {
  const stop = schedule.stops[summary.stop];
  return (
    <View style={styles.popup}>
      <View style={styles.walkLine}>
        <StopBadge rank={summary.rank} />
        <View style={styles.grow}>
          <Text style={styles.body} numberOfLines={2}>
            {stopName(stop)} #{stop[1] || stop[0]}
          </Text>
          <Text style={styles.note}>{walkText(summary.walk, from, stop)}</Text>
        </View>
        <IconButton icon={X} accessibilityLabel="Cerrar el paradero" onPress={onClose} />
      </View>
      {summary.reason ? (
        <Text style={styles.warn}>Cerrado por ahora. LTC: {summary.reason}</Text>
      ) : (
        <View style={styles.walkLine}>
          <View style={[styles.lines, styles.grow]}>
            {summary.routes.map((route) => (
              <RouteBadge key={route[0]} route={route} size={22} />
            ))}
          </View>
          <Button label="Ver" icon={Eye} onPress={() => onView('lines')} />
          <Button label="Elegir" variant="primary" onPress={() => onView('buses')} />
        </View>
      )}
    </View>
  );
}

/**
 * Leaving now, the three stops with the bus that suits him best there, and the nearby ones LTC has
 * closed; a stop opens on its lines or its buses. It keeps its own clock, like the list.
 */
const StopList = memo(function StopList({
  schedule,
  stopIndex,
  result,
  final,
  snapshot,
  active,
  searching,
  from,
  originName,
  targetName,
  closedIds,
  pick,
  line,
  savable,
  openRide,
  open,
  chosenKey,
  onPick,
  onBack,
  onLine,
  onSummary,
  onClosed,
  onWiden,
  onStale,
  onOpenRide,
  onSaveWalk,
  onFocusBus,
  onToggle,
  onMapOption,
  onLeave,
  onSelect,
}: {
  schedule: Schedule;
  stopIndex: ReturnType<typeof buildStopIndex>;
  result: PlanResult;
  /** The result is for the search asked for, not one kept on screen while it runs. */
  final: boolean;
  snapshot: LiveSnapshot | null;
  active: boolean;
  searching: boolean;
  from: Coordinates;
  originName: string;
  targetName: string;
  closedIds: readonly string[];
  pick: { stop: number; view: StopView } | null;
  line: Departure | null;
  savable: { access: boolean; egress: boolean };
  openRide: { key: string; departure: Departure } | null;
  open: string | null;
  chosenKey: string | null;
  onPick: (stop: number, view: StopView) => void;
  onBack: () => void;
  onLine: (departure: Departure | null) => void;
  onSummary: (summary: StopSummary) => void;
  onClosed: (ids: string[]) => void;
  onWiden: (side: 'access') => void;
  onStale: () => void;
  onOpenRide: (ride: { key: string; departure: Departure } | null) => void;
  onSaveWalk: (edit: WalkEdit, minutes: number) => Promise<void>;
  onFocusBus: (departure: Departure) => void;
  onToggle: (key: string | null) => void;
  onMapOption: (option: PlanOption | null) => void;
  onLeave?: (option: PlanOption) => Promise<void>;
  onSelect?: (option: PlanOption) => Promise<void>;
}) {
  const now = useLiveClock(active, snapshot);
  const minute = Math.floor(now / 60_000) * 60_000;
  const stale = minute - result.request.at > STALE_NOW_MS;
  useEffect(() => {
    if (stale) onStale();
  }, [stale, onStale]);
  const choices = useMemo(() => stopChoices(result, snapshot, now), [result, snapshot, now]);
  const shown = useMemo(() => choices.slice(0, STOP_CHOICES), [choices]);
  const closed = useMemo(
    () => closedStops(result, closedIds, snapshot, now),
    [result, closedIds, snapshot, now],
  );
  // Fewer stops than he is offered: the search looks farther.
  const few = final && choices.length < STOP_CHOICES;
  useEffect(() => {
    if (few) onWiden('access');
  }, [few, onWiden]);
  // LTC closes stops for now: the first offered are checked on each reading, and one closed stays
  // checked, so it opens again when LTC says so.
  const watched = [
    ...new Set([...closedIds, ...choices.slice(0, 6).map((c) => schedule.stops[c.stop][0])]),
  ].join();
  useEffect(() => {
    if (!snapshot) return;
    onClosed(
      watched.split(',').filter((stop) => stop && stopClosure(schedule, snapshot, stop, now)),
    );
  }, [watched, snapshot, schedule, now, onClosed]);
  const picked = pick ? (shown.find((choice) => choice.stop === pick.stop) ?? null) : null;
  const summary = useMemo<StopSummary>(() => {
    const id = (stop: number) => schedule.stops[stop][0];
    const stops = [
      ...shown.map((choice, i) => ({
        stop: choice.stop,
        rank: i + 1,
        walk: choice.walk,
        routes: choice.routes,
        reason: null,
      })),
      ...closed.map((stop) => ({
        stop: stop.stop,
        rank: null,
        walk: { metres: stop.metres, minutes: stop.minutes, source: 'estimate' as const },
        routes: [],
        reason: stop.reason,
      })),
    ];
    const ridden = (picked?.options ?? []).flatMap((option) =>
      option.itinerary.rides.flatMap((ride) => [
        id(ride.departure.stopTime[0]),
        id(ride.arrival.stopTime[0]),
      ]),
    );
    const live = [
      ...new Set([
        ...closedIds,
        ...(picked ? [id(picked.stop)] : []),
        ...choices.slice(0, 5).map((choice) => id(choice.stop)),
        ...ridden,
      ]),
    ].slice(0, 7);
    const key = JSON.stringify([
      stops.map((s) => [s.stop, s.rank, s.walk.minutes, s.routes.map((r) => r[0]), s.reason]),
      live,
    ]);
    return { key, stops, live };
  }, [shown, choices, closed, closedIds, picked, schedule]);
  useEffect(() => {
    onSummary(summary);
  }, [summary, onSummary]);

  const walking = result.pool.find((plan) => !plan.rides.length);
  const reach = result.request.accessRadiusM ?? ACCESS_RADIUS_M;
  const issue = issueText(result, originName, targetName);
  if (pick && pick.view !== 'menu' && picked) {
    const stop = schedule.stops[picked.stop];
    return (
      <View style={styles.list}>
        <View style={styles.walkLine}>
          <IconButton
            icon={ChevronLeft}
            accessibilityLabel="Volver a los paraderos"
            onPress={onBack}
          />
          <StopBadge rank={shown.indexOf(picked) + 1} />
          <View style={styles.grow}>
            <Text style={styles.body} numberOfLines={2}>
              {stopName(stop)} #{stop[1] || stop[0]}
            </Text>
            <Text style={styles.note}>{walkText(picked.walk, from, stop)}</Text>
          </View>
        </View>
        <View style={styles.wrap}>
          <Chip
            label="Ver líneas"
            selected={pick.view === 'lines'}
            onPress={() => onPick(picked.stop, 'lines')}
          />
          <Chip
            label="Elegir bus"
            selected={pick.view === 'buses'}
            onPress={() => onPick(picked.stop, 'buses')}
          />
        </View>
        {pick.view === 'lines' ? (
          <StopLines
            schedule={schedule}
            stopIndex={stopIndex}
            choice={picked}
            snapshot={snapshot}
            active={active}
            now={minute}
            line={line}
            onLine={onLine}
            onFocusBus={onFocusBus}
          />
        ) : (
          <StopBuses
            schedule={schedule}
            stopIndex={stopIndex}
            choice={picked}
            snapshot={snapshot}
            active={active}
            now={minute}
            targetName={targetName}
            savable={savable}
            openRide={openRide}
            open={open}
            chosenKey={chosenKey}
            onOpenRide={onOpenRide}
            onSaveWalk={onSaveWalk}
            onFocusBus={onFocusBus}
            onToggle={onToggle}
            onMapOption={onMapOption}
            onLeave={onLeave}
            onSelect={onSelect}
          />
        )}
      </View>
    );
  }
  return (
    <View style={styles.list}>
      {issue && <Text style={result.issue === 'none' ? styles.body : styles.note}>{issue}</Text>}
      {searching && <Text style={styles.note}>Actualizando…</Text>}
      {reach > ACCESS_RADIUS_M && shown.length > 0 && (
        <Text style={styles.note}>
          A menos de {ACCESS_RADIUS_M} m no hay {STOP_CHOICES} paraderos que te sirvan; busqué hasta{' '}
          {reach / 1_000} km.
        </Text>
      )}
      {!shown.length && !issue && !searching && (
        <Text style={styles.body}>
          Ahora no sale ningún bus que te lleve desde los paraderos cercanos. Prueba «Salir a las…».
        </Text>
      )}
      {shown.map((choice, i) => {
        const stop = schedule.stops[choice.stop];
        const { best } = choice;
        return (
          <Pressable
            key={choice.stop}
            accessibilityRole="button"
            accessibilityLabel={`Paradero ${i + 1}, ${stopName(stop)}`}
            onPress={() => onPick(choice.stop, 'buses')}
            style={({ pressed }) => [
              styles.option,
              pick?.stop === choice.stop && styles.chosen,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.optionHead}>
              <StopBadge rank={i + 1} />
              <View style={styles.grow}>
                <Text style={styles.body} numberOfLines={2}>
                  {stopName(stop)} #{stop[1] || stop[0]}
                </Text>
                <Text style={styles.note}>{walkText(choice.walk, from, stop)}</Text>
                <Text style={styles.note}>
                  {best.itinerary.rides.length > 1 ? 'Con transbordo' : 'Directo'}:{' '}
                  {best.itinerary.rides.map((r) => r.route[1]).join(' → ')} a las{' '}
                  {clock(best.live[0].board.at)} ·{' '}
                  {best.leaveAt <= minute ? 'sal ya' : `sal ${relative(best.leaveAt, minute)}`} ·
                  llegas {clock(best.arriveAt)}
                </Text>
              </View>
              <View style={styles.lines}>
                {choice.routes.map((route) => (
                  <RouteBadge key={route[0]} route={route} size={22} />
                ))}
              </View>
            </View>
          </Pressable>
        );
      })}
      {closed.map((stop) => {
        const row = schedule.stops[stop.stop];
        return (
          <Pressable
            key={stop.stop}
            accessibilityRole="button"
            accessibilityLabel={`${stopName(row)}, cerrado por ahora`}
            onPress={() => onPick(stop.stop, 'menu')}
            style={({ pressed }) => [styles.option, styles.closed, pressed && styles.pressed]}
          >
            <View style={styles.optionHead}>
              <StopBadge rank={null} />
              <View style={styles.grow}>
                <Text style={styles.body} numberOfLines={2}>
                  {stopName(row)} #{row[1] || row[0]}
                </Text>
                <Text style={styles.note}>
                  Cerrado por ahora · {stop.metres} m al{' '}
                  {headingTo(from, { lat: row[3], lng: row[4] })}
                </Text>
                <Text style={styles.note}>LTC: {stop.reason}</Text>
              </View>
            </View>
          </Pressable>
        );
      })}
      {walking && (
        <Text style={styles.note}>
          También puedes ir caminando: {walking.access.minutes} min ({walkSource(walking.access)}).
        </Text>
      )}
      <Text style={styles.note}>
        El 1 es el que más te conviene: cuenta sobre todo a qué hora llegas, y suma {COST.transfer}{' '}
        min por transbordo ({COST.tight} más si es justo), {COST.walk} min por cada minuto a pie y{' '}
        {COST.trip} min por cada minuto de viaje. Cada paradero muestra su mejor bus.
      </Text>
      <Text style={styles.note}>
        Toca un paradero para ver sus líneas o elegir su bus. Metros en línea recta desde donde
        sales; sin tus minutos, la caminata se estima a 4.5 km/h sobre 1.3 veces esa distancia.
      </Text>
    </View>
  );
});

/** A stop's lines that take him there, each opening its whole route with the bus on it. */
function StopLines({
  schedule,
  stopIndex,
  choice,
  snapshot,
  active,
  now,
  line,
  onLine,
  onFocusBus,
}: {
  schedule: Schedule;
  stopIndex: ReturnType<typeof buildStopIndex>;
  choice: StopChoice;
  snapshot: LiveSnapshot | null;
  active: boolean;
  now: number;
  line: Departure | null;
  onLine: (departure: Departure | null) => void;
  onFocusBus: (departure: Departure) => void;
}) {
  const groups = useMemo(() => {
    const byLine = new Map<string, { departure: Departure; at: number; live: RideLive }[]>();
    for (const option of choice.options) {
      if (option.problem || option.notice || option.missed) continue;
      const ride = option.itinerary.rides[0];
      const key = `${ride.route[0]}/${ride.trip[4]}`;
      const list = byLine.get(key) ?? [];
      if (!list.some((bus) => bus.departure.trip[0] === ride.trip[0]))
        list.push({ departure: ride.departure, at: option.live[0].board.at, live: option.live[0] });
      byLine.set(key, list);
    }
    return [...byLine.values()].map((list) => list.sort((a, b) => a.at - b.at));
  }, [choice]);
  const choices = useMemo(
    () =>
      line
        ? departures(schedule, stopIndex, choice.stop, line.at - 3_600_000, 80).filter(
            (d) => d.route[0] === line.route[0] && d.trip[4] === line.trip[4],
          )
        : [],
    [schedule, stopIndex, choice.stop, line],
  );
  return (
    <View style={styles.list}>
      {groups.map((buses) => {
        const first = buses[0];
        const where = destination(first.departure);
        const opened =
          !!line &&
          line.route[0] === first.departure.route[0] &&
          line.trip[4] === first.departure.trip[4];
        return (
          <View
            key={`${first.departure.route[0]}/${first.departure.trip[4]}`}
            style={styles.option}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: opened }}
              accessibilityLabel={`Línea ${first.departure.route[1]} hacia ${where.main}; ver su recorrido`}
              onPress={() => onLine(opened ? null : first.departure)}
              style={({ pressed }) => [styles.optionHead, pressed && styles.pressed]}
            >
              <RouteBadge route={first.departure.route} size={26} />
              <View style={styles.grow}>
                <Text style={styles.body} numberOfLines={2}>
                  {where.main}
                  {where.via ? ` vía ${where.via}` : ''}
                </Text>
                <Text style={styles.note}>
                  {buses
                    .slice(0, 4)
                    .map((bus) => clock(bus.at))
                    .join(' · ')}
                  {first.at >= now ? ` · el primero ${relative(first.at, now)}` : ''}
                </Text>
              </View>
              <StatusIcons live={first.live.board} />
              {opened ? (
                <ChevronUp size={18} color={theme.text} strokeWidth={2.5} />
              ) : (
                <ChevronDown size={18} color={theme.text} strokeWidth={2.5} />
              )}
            </Pressable>
            {opened && line && (
              <TransitTripTimeline
                schedule={schedule}
                departure={line}
                choices={choices}
                snapshot={snapshot}
                active={active}
                onSelect={onLine}
                onClose={() => onLine(null)}
                onFocusBus={onFocusBus}
              />
            )}
          </View>
        );
      })}
      <Text style={styles.note}>
        Solo las líneas de este paradero que te llevan, directo o con un transbordo.
      </Text>
    </View>
  );
}

/** A stop's buses that take him there; he leaves on one, or keeps it as his trip. */
function StopBuses({
  schedule,
  stopIndex,
  choice,
  snapshot,
  active,
  now,
  targetName,
  savable,
  openRide,
  open,
  chosenKey,
  onOpenRide,
  onSaveWalk,
  onFocusBus,
  onToggle,
  onMapOption,
  onLeave,
  onSelect,
}: {
  schedule: Schedule;
  stopIndex: ReturnType<typeof buildStopIndex>;
  choice: StopChoice;
  snapshot: LiveSnapshot | null;
  active: boolean;
  now: number;
  targetName: string;
  savable: { access: boolean; egress: boolean };
  openRide: { key: string; departure: Departure } | null;
  open: string | null;
  chosenKey: string | null;
  onOpenRide: (ride: { key: string; departure: Departure } | null) => void;
  onSaveWalk: (edit: WalkEdit, minutes: number) => Promise<void>;
  onFocusBus: (departure: Departure) => void;
  onToggle: (key: string | null) => void;
  onMapOption: (option: PlanOption | null) => void;
  onLeave?: (option: PlanOption) => Promise<void>;
  onSelect?: (option: PlanOption) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const options = choice.options;
  const limit = SHOWN + (options[0]?.missed ? 1 : 0);
  const shown = more ? options : options.slice(0, limit);
  const expanded = shown.find((option) => option.scheduleKey === open) ?? null;
  useEffect(() => {
    onMapOption(expanded);
  }, [expanded, onMapOption]);
  const run = (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    work()
      .catch((reason) => setError(message(reason)))
      .finally(() => setBusy(false));
  };
  return (
    <View style={styles.list}>
      {error && <Text style={styles.error}>{error}</Text>}
      {shown.map((option) => {
        const gone = !!option.problem || option.leaveAt < now - 60_000;
        return (
          <PlanRow
            key={option.scheduleKey}
            option={option}
            now={now}
            mode="now"
            chosen={option.scheduleKey === chosenKey}
            expanded={open === option.scheduleKey}
            onToggle={() => onToggle(open === option.scheduleKey ? null : option.scheduleKey)}
          >
            {open === option.scheduleKey && (
              <>
                <PlanSteps
                  schedule={schedule}
                  stopIndex={stopIndex}
                  option={option}
                  snapshot={snapshot}
                  active={active}
                  now={now}
                  targetName={targetName}
                  savable={savable}
                  openRide={openRide}
                  onOpenRide={onOpenRide}
                  onSaveWalk={onSaveWalk}
                  onFocusBus={onFocusBus}
                />
                <View style={styles.wrap}>
                  {onLeave && (
                    <Button
                      label="Salgo ahora"
                      variant="primary"
                      disabled={busy || gone || !!option.missed}
                      onPress={() => run(() => onLeave(option))}
                    />
                  )}
                  {onSelect && option.scheduleKey !== chosenKey && (
                    <Button
                      label="Elegir este viaje"
                      disabled={busy || gone || !!option.missed}
                      onPress={() => run(() => onSelect(option))}
                    />
                  )}
                </View>
                {onLeave ? (
                  <Text style={styles.note}>
                    Sigue tu viaje con el GPS desde donde estás: el mapa te lleva al paradero y se
                    actualiza mientras caminas.
                  </Text>
                ) : (
                  !onSelect && (
                    <Text style={styles.note}>
                      {savable.access
                        ? 'Hacia una dirección o punto del mapa solo puedes mirar o salir desde Tu ubicación.'
                        : 'Desde un punto del mapa solo puedes mirar. Para seguir el viaje, sal desde Tu ubicación.'}
                    </Text>
                  )
                )}
                {onSelect && option.scheduleKey === chosenKey && (
                  <Text style={styles.body}>
                    Viaje elegido. Arriba, en Tu viaje, tienes «Salgo ahora» y los avisos.
                  </Text>
                )}
              </>
            )}
          </PlanRow>
        );
      })}
      {options.length > limit && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: more }}
          onPress={() => setMore(!more)}
          style={styles.more}
        >
          <Text style={styles.moreText}>
            {more ? 'Ver menos buses' : `Ver ${options.length - limit} más`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function ridesLabel(option: PlanOption) {
  const rides = option.itinerary.rides.length;
  return rides === 0 ? 'caminando' : rides === 1 ? 'directo' : '1 transbordo';
}

function noticeText(option: PlanOption): string {
  const [first, second] = option.itinerary.rides;
  const line = (ride: Ride) => `el ${ride.route[1]} de las ${clock(ride.departure.at)}`;
  const next = second
    ? ` El siguiente es el ${second.route[1]} de las ${clock(option.live[1].board.at)}; llegas ${clock(option.arriveAt)}.`
    : '';
  if (option.replaced) {
    const lost = line(option.replaced.ride);
    if (option.replaced.reason === 'canceled') return `LTC canceló ${lost}.${next}`;
    if (option.replaced.reason === 'skipped')
      return `${lost[0].toUpperCase()}${lost.slice(1)} no para ahí.${next}`;
    return `Con ${line(first)} tarde ya no alcanzas ${lost}.${next}`;
  }
  const broken = option.itinerary.rides.find((_, i) =>
    [option.live[i].board.status, option.live[i].alight.status].some(
      (s) => s === 'canceled' || s === 'skipped',
    ),
  );
  if (option.problem === 'canceled' && broken) return `LTC canceló ${line(broken)}.`;
  if (option.problem === 'skipped' && broken)
    return `${line(broken)[0].toUpperCase()}${line(broken).slice(1)} no para donde lo tomas o te bajas.`;
  return `Con ${line(first)} tarde ya no hay conexión en la hora siguiente.`;
}

const PlanRow = memo(function PlanRow({
  option,
  now,
  mode,
  chosen,
  expanded,
  onToggle,
  children,
}: {
  option: PlanOption;
  now: number;
  mode: PlanMode;
  chosen: boolean;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const rides = option.itinerary.rides;
  const Chevron = expanded ? ChevronUp : ChevronDown;
  const day = dayOf(option.leaveAt, now);
  // `now` is the start of the minute, so a bus that left within it can read as still to come.
  const passed = option.live[0] && relative(option.live[0].board.at, now);
  const when =
    option.missed === 'passed'
      ? passed?.startsWith('hace')
        ? `pasó ${passed}`
        : 'acaba de pasar'
      : option.missed === 'late'
        ? 'probablemente no llegues'
        : mode === 'now'
          ? option.leaveAt <= now
            ? 'sal ya'
            : `sal ${relative(option.leaveAt, now)}`
          : day;
  const summary = [
    chosen ? 'elegido' : '',
    `${minutesOf(option.arriveAt - option.leaveAt)} min`,
    ridesLabel(option),
    when,
    option.tight && !option.missed ? 'justo' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View
      style={[
        styles.option,
        chosen && styles.chosen,
        (option.notice || option.missed) && styles.notice,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Sales ${clock(option.leaveAt)}, llegas ${clock(option.arriveAt)}, ${
          rides.map((r) => `línea ${r.route[1]}`).join(' y ') || 'caminando'
        }, ${summary}`}
        onPress={onToggle}
        style={({ pressed }) => [styles.optionHead, pressed && styles.pressed]}
      >
        <View style={styles.grow}>
          <Text style={styles.optionTime}>
            {clock(option.leaveAt)} → {clock(option.arriveAt)}
          </Text>
          <Text style={styles.note} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        <View style={styles.lines}>
          {rides.length ? (
            rides.map((ride, i) => (
              <Fragment key={`${ride.trip[0]}-${i}`}>
                {i > 0 && <ChevronRight size={14} color={theme.text} strokeWidth={2.5} />}
                <RouteBadge route={ride.route} size={24} />
              </Fragment>
            ))
          ) : (
            <Footprints size={18} color={theme.text} strokeWidth={2.5} />
          )}
        </View>
        {chosen && <Check size={18} color={theme.text} strokeWidth={3} />}
        {option.live[0] && <StatusIcons live={option.live[0].board} />}
        <Chevron size={18} color={theme.text} strokeWidth={2.5} />
      </Pressable>
      {option.notice && <Text style={styles.warn}>{noticeText(option)}</Text>}
      {option.reportedOutsideCalendar && (
        <Text style={styles.note}>
          LTC reporta este bus aunque su calendario no lo incluya hoy. Sin predicción, la hora es la
          del horario.
        </Text>
      )}
      {option.tight && option.backup && !option.missed && !expanded && (
        <Text style={styles.note}>
          Si pierdes el transbordo: {option.backup.ride.route[1]} de las{' '}
          {clock(option.backup.ride.departure.at)}, llegas {clock(option.backup.arriveAt)}.
        </Text>
      )}
      {children}
    </View>
  );
});

function walkSource(walk: Walk) {
  return walk.source === 'saved'
    ? 'tus minutos'
    : walk.source === 'learned'
      ? 'según tus caminatas'
      : walk.source === 'same'
        ? 'misma parada'
        : `estimado · ${Math.round(walk.metres)} m en línea recta`;
}

function PlanSteps({
  schedule,
  stopIndex,
  option,
  snapshot,
  active,
  now,
  targetName,
  savable,
  openRide,
  onOpenRide,
  onSaveWalk,
  onFocusBus,
}: {
  schedule: Schedule;
  stopIndex: ReturnType<typeof buildStopIndex>;
  option: PlanOption;
  snapshot: LiveSnapshot | null;
  active: boolean;
  now: number;
  targetName: string;
  savable: { access: boolean; egress: boolean };
  openRide: { key: string; departure: Departure } | null;
  onOpenRide: (ride: { key: string; departure: Departure } | null) => void;
  onSaveWalk: (edit: WalkEdit, minutes: number) => Promise<void>;
  onFocusBus: (departure: Departure) => void;
}) {
  const plan = option.itinerary;
  const stops = schedule.stops;
  const [first, second] = plan.rides;
  const at = (stop: number | null) => (stop === null ? targetName : stopName(stops[stop]));
  const code = (stop: number) => stops[stop][1] || stops[stop][0];
  if (!first)
    return (
      <View style={styles.steps}>
        <Step title={`Camina ${plan.access.minutes} min hasta ${targetName}`}>
          <Text style={styles.note}>{walkSource(plan.access)} · sin ruta guardada</Text>
        </Step>
      </View>
    );
  const reachStop = option.leaveAt + plan.access.minutes * 60_000;
  return (
    <View style={styles.steps}>
      <WalkStep
        title={`Sal ${clock(option.leaveAt)} y camina ${plan.access.minutes} min a ${at(plan.access.to)}`}
        detail={`#${code(plan.access.to!)} · ${walkSource(plan.access)} · llegas ${clock(reachStop)}`}
        edit={savable.access ? { kind: 'access', walk: plan.access } : null}
        onSave={onSaveWalk}
      />
      <RideStep
        schedule={schedule}
        stopIndex={stopIndex}
        ride={first}
        live={option.live[0]}
        snapshot={snapshot}
        active={active}
        now={now}
        rideKey={`${option.scheduleKey}/0`}
        openRide={openRide}
        onOpenRide={onOpenRide}
        onFocusBus={onFocusBus}
      />
      {second && plan.transfer && option.slack !== null && (
        <>
          <WalkStep
            title={
              plan.transfer.source === 'same'
                ? `Transbordo en la misma parada`
                : `Transbordo: camina ${plan.transfer.minutes} min a ${at(plan.transfer.to)}`
            }
            detail={`${
              plan.transfer.source === 'same'
                ? ''
                : `#${code(plan.transfer.to!)} · ${walkSource(plan.transfer)} · `
            }margen ${Math.floor(option.slack / 60_000)} min${option.tight ? ' · justo' : ''}`}
            edit={
              plan.transfer.source === 'same' ? null : { kind: 'transfer', walk: plan.transfer }
            }
            onSave={onSaveWalk}
            warn={option.tight}
          />
          <RideStep
            schedule={schedule}
            stopIndex={stopIndex}
            ride={second}
            live={option.live[1]}
            snapshot={snapshot}
            active={active}
            now={now}
            rideKey={`${option.scheduleKey}/1`}
            openRide={openRide}
            onOpenRide={onOpenRide}
            onFocusBus={onFocusBus}
          />
        </>
      )}
      {plan.egress && (
        <WalkStep
          title={`Camina ${plan.egress.minutes} min a ${targetName}`}
          detail={`Desde #${code(plan.egress.from!)} · ${walkSource(plan.egress)} · llegas ${clock(option.arriveAt)}`}
          edit={savable.egress ? { kind: 'egress', walk: plan.egress } : null}
          onSave={onSaveWalk}
        />
      )}
      {option.tight && option.backup && (
        <Text style={styles.warn}>
          Justo: si pierdes el {second?.route[1]}, el {option.backup.ride.route[1]} de las{' '}
          {clock(option.backup.ride.departure.at)} sale de{' '}
          {stopName(stops[option.backup.ride.departure.stopTime[0]])} y llegas{' '}
          {clock(option.backup.arriveAt)}.
        </Text>
      )}
    </View>
  );
}

function Step({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepIcon}>
        <Footprints size={16} color={theme.text} strokeWidth={2.5} />
      </View>
      <View style={styles.grow}>
        <Text style={styles.stepTitle}>{title}</Text>
        {children}
      </View>
    </View>
  );
}

function WalkStep({
  title,
  detail,
  edit,
  onSave,
  warn = false,
}: {
  title: string;
  detail: string;
  edit: WalkEdit | null;
  onSave: (edit: WalkEdit, minutes: number) => Promise<void>;
  warn?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Step title={title}>
      <View style={styles.walkLine}>
        <Text style={[styles.note, styles.grow, warn && styles.warnText]}>{detail}</Text>
        {edit && !editing && (
          <IconButton
            icon={Pencil}
            accessibilityLabel="Corregir con tus minutos"
            onPress={() => {
              setMinutes(
                edit.walk.source === 'saved' || edit.walk.source === 'learned'
                  ? String(edit.walk.minutes)
                  : '',
              );
              setError(null);
              setEditing(true);
            }}
          />
        )}
      </View>
      {edit && editing && (
        <View style={styles.editor}>
          <TextField
            accessibilityLabel="Tus minutos de caminata"
            value={minutes}
            onChange={setMinutes}
            placeholder="Tus minutos"
            style={styles.input}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.wrap}>
            <Button
              label="Guardar"
              variant="primary"
              loading={busy}
              onPress={() => {
                setBusy(true);
                setError(null);
                onSave(edit, Number(minutes))
                  .then(() => setEditing(false))
                  .catch((reason) => setError(message(reason)))
                  .finally(() => setBusy(false));
              }}
            />
            <Button label="Cancelar" disabled={busy} onPress={() => setEditing(false)} />
          </View>
        </View>
      )}
    </Step>
  );
}

function RideStep({
  schedule,
  stopIndex,
  ride,
  live,
  snapshot,
  active,
  now,
  rideKey,
  openRide,
  onOpenRide,
  onFocusBus,
}: {
  schedule: Schedule;
  stopIndex: ReturnType<typeof buildStopIndex>;
  ride: Ride;
  live: PlanOption['live'][number];
  snapshot: LiveSnapshot | null;
  active: boolean;
  now: number;
  rideKey: string;
  openRide: { key: string; departure: Departure } | null;
  onOpenRide: (ride: { key: string; departure: Departure } | null) => void;
  onFocusBus: (departure: Departure) => void;
}) {
  const stops = schedule.stops;
  const where = destination(ride.departure);
  const open = openRide?.key === rideKey ? openRide.departure : null;
  const alerts = useMemo(
    () => rideAlerts(schedule, ride, snapshot, now),
    [schedule, ride, snapshot, now],
  );
  const choices = useMemo(() => {
    if (!open) return [];
    return departures(
      schedule,
      stopIndex,
      ride.departure.stopTime[0],
      ride.departure.at - 3_600_000,
      80,
    ).filter((d) => d.route[0] === ride.route[0] && d.trip[4] === ride.trip[4]);
  }, [open, schedule, stopIndex, ride]);
  const late = live.board.at !== ride.departure.at;
  return (
    <View style={styles.step}>
      <View style={styles.stepIcon}>
        <RouteBadge route={ride.route} size={26} />
      </View>
      <View style={styles.grow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: !!open }}
          accessibilityLabel={`Línea ${ride.route[1]} hacia ${where.main}; ver su recorrido`}
          onPress={() => onOpenRide(open ? null : { key: rideKey, departure: ride.departure })}
          style={styles.rideHead}
        >
          <View style={styles.grow}>
            <Text style={styles.stepTitle} numberOfLines={2}>
              {where.main}
              {where.via ? ` vía ${where.via}` : ''}
            </Text>
            <Text style={styles.note}>
              Sale {clock(live.board.at)} de {stopName(stops[ride.departure.stopTime[0]])}
              {late ? ` · horario ${clock(ride.departure.at)}` : ''}
              {live.board.at >= now && live.board.at - now < 90 * 60_000
                ? ` · ${relative(live.board.at, now)}`
                : ''}
            </Text>
            <Text style={styles.note}>
              Bajas en {stopName(stops[ride.arrival.stopTime[0]])} · {clock(live.alight.at)} ·{' '}
              {ride.alight - ride.board} paradas
            </Text>
          </View>
          <StatusIcons live={live.board} />
        </Pressable>
        {alerts.map((alert) => (
          <View key={alert.id} style={styles.alert}>
            <TriangleAlert size={14} color={theme.text} strokeWidth={2.5} />
            <Text style={[styles.note, styles.grow]}>LTC: {alert.header}</Text>
          </View>
        ))}
        {open && (
          <TransitTripTimeline
            schedule={schedule}
            departure={open}
            choices={choices}
            snapshot={snapshot}
            active={active}
            onSelect={(departure) => onOpenRide({ key: rideKey, departure })}
            onClose={() => onOpenRide(null)}
            onFocusBus={onFocusBus}
          />
        )}
      </View>
    </View>
  );
}

const styles = sheet((theme) => ({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  placeRow: { gap: 6 },
  rowLabel: { fontFamily: font.bold, fontSize: 12, color: theme.textFaint },
  pickerLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Square, at the height of the list beside it.
  swap: { width: 42, height: 42 },
  list: { gap: 10 },
  body: { fontFamily: font.bold, fontSize: 14, color: theme.text },
  note: { fontFamily: font.regular, fontSize: 12, color: theme.textFaint },
  error: { fontFamily: font.bold, fontSize: 13, color: theme.danger },
  warn: { fontFamily: font.bold, fontSize: 12, color: theme.text },
  warnText: { fontFamily: font.bold, color: theme.text },
  option: {
    gap: 8,
    padding: 10,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
  },
  notice: { opacity: 0.7, borderColor: theme.lineSoft },
  closed: { opacity: 0.6, borderColor: theme.lineSoft, backgroundColor: theme.bg },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.black, fontSize: 14, color: '#FFFFFF' },
  popup: {
    gap: 8,
    padding: 10,
    borderWidth: shape.border,
    borderRadius: shape.radiusSmall,
    ...glass.panel,
    backgroundColor: theme.surfaceSolid,
  },
  chosen: { borderWidth: 3, backgroundColor: theme.okBg },
  optionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pressed: { opacity: 0.7 },
  optionTime: { fontFamily: font.black, fontSize: 16, color: theme.text },
  lines: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  steps: { gap: 12, borderTopWidth: 1, borderTopColor: theme.lineSoft, paddingTop: 10 },
  step: { flexDirection: 'row', gap: 10 },
  stepIcon: { width: 30, alignItems: 'center', paddingTop: 2 },
  stepTitle: { fontFamily: font.bold, fontSize: 14, color: theme.text },
  walkLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rideHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alert: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingTop: 4 },
  editor: { gap: 8, paddingTop: 6 },
  input: {
    fontFamily: font.regular,
    fontSize: 14,
    color: theme.text,
    borderWidth: shape.border,
    borderColor: theme.lineSoft,
    borderRadius: shape.radiusSmall,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 44,
    backgroundColor: theme.surface,
  },
  more: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 2 },
  moreText: {
    fontFamily: font.bold,
    fontSize: 13,
    color: theme.text,
    textDecorationLine: 'underline',
  },
}));
