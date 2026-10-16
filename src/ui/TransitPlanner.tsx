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
import {
  buildPlannerIndex,
  liveOptions,
  planLiveStops,
  rideAlerts,
  runPlan,
  startPlan,
  type PlanMode,
  type PlanOption,
  type PlanRequest,
  type PlanResult,
  type PlannerIndex,
  type Ride,
  type Walk,
} from '../transit/planner.ts';
import { observedServiceTrips, type LiveSnapshot } from '../transit/realtime.ts';
import type { NextTrip } from '../transit/journey.ts';
import {
  agencyClock,
  agencyDate,
  departures,
  queryInstant,
  type buildStopIndex,
  type Departure,
  type Schedule,
} from '../transit/schedule.ts';
import {
  listStopWalks,
  listWalkLinks,
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
  ChevronRight,
  ChevronUp,
  Footprints,
  Pencil,
  TriangleAlert,
  X,
} from './icons.ts';
import { IconButton } from './IconButton.tsx';
import { placeOptions } from './placeIcons.ts';
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
import { TransitPlanMap } from './TransitPlanMap.tsx';
import { useScrollIntoView } from './screens/Screen.tsx';
import { font, shape, sheet, theme } from './theme.ts';

/** What the planner wants read live: the stops of its best options and a ride he opened. */
export type PlannerLive = { stops: string[]; ride: Departure | null };

const SHOWN = 5;
// Live data only helps for buses about to run; a plan for tomorrow asks LTC for nothing.
const LIVE_HORIZON_MS = 3 * 3_600_000;
const STALE_NOW_MS = 5 * 60_000;

const indexes = new WeakMap<Schedule, PlannerIndex>();
function plannerIndex(schedule: Schedule): PlannerIndex {
  let index = indexes.get(schedule);
  if (!index) {
    index = buildPlannerIndex(schedule);
    indexes.set(schedule, index);
  }
  return index;
}

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

export function TransitPlanner({
  db,
  schedule,
  stopIndex,
  places,
  initialOrigin,
  located,
  snapshot,
  active,
  today,
  walksVersion,
  onWalkChanged,
  onLive,
  onFocusBus,
  journey,
  onSelectJourney,
  refreshAt = 0,
  onMapInteraction,
  onPlacesChange,
}: {
  db: SQLiteDatabase;
  schedule: Schedule;
  stopIndex: ReturnType<typeof buildStopIndex>;
  places: Place[];
  initialOrigin: string | null;
  refreshAt?: number;
  onMapInteraction?: (active: boolean) => void;
  onPlacesChange?: (ids: string[]) => void;
  /** The place nearest to where he opened Transit, and when that reading was asked for. */
  located: { id: string; at: number } | null;
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
}) {
  const [originId, setOriginId] = useState(journey?.originId ?? initialOrigin);
  const [openKey, setOpenKey] = useState<string | null>(journey?.selectedKey ?? null);
  const [mapOption, setMapOption] = useState<PlanOption | null>(null);
  const [mapFocus, setMapFocus] = useState<{ departure: Departure; at: number } | null>(null);
  const mapBlock = useRef<View>(null);
  const scrollIntoView = useScrollIntoView();
  const focusBus = (departure: Departure) => {
    setMapFocus({ departure, at: Date.now() });
    scrollIntoView(mapBlock.current);
    onFocusBus?.(departure);
  };
  const [targetId, setTargetId] = useState<string | null>(journey?.destinationId ?? null);
  useEffect(() => {
    onPlacesChange?.([...new Set([originId, targetId].filter((id): id is string => !!id))]);
  }, [originId, targetId, onPlacesChange]);
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
      setOpenKey(journey.selectedKey);
      setOpenRide(null);
      setMapFocus(null);
    }
  }
  const [seenLocated, setSeenLocated] = useState<number | null>(null);
  if (located && seenLocated !== located.at) {
    setSeenLocated(located.at);
    if (originChosenAt < located.at && located.id !== originId) {
      setOriginId(located.id);
      setOpenRide(null);
      setOpenKey(null);
      setMapFocus(null);
    }
  }
  const origin = places.find((p) => p.id === originId);
  const target = places.find((p) => p.id === targetId);
  const options = useMemo(() => placeOptions(places), [places]);

  const pairKey = origin && target && origin.id !== target.id ? `${origin.id}/${target.id}` : null;
  useEffect(() => {
    if (!pairKey) return;
    let alive = true;
    const [from, to] = pairKey.split('/');
    Promise.all([
      listWalkLinks(db, from),
      listWalkLinks(db, to),
      listStopWalks(db),
      listAcceptedWalks(db),
    ])
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
      mode: applied.mode,
      at: applied.at,
      observedTrips: JSON.parse(observedKey),
    };
  }, [pairKey, walks, fromLat, fromLng, toLat, toLng, applied, observedKey]);

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
        const found = await runPlan(startPlan(plannerIndex(schedule), request), {
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
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  const mappedOption = mapOption?.scheduleKey === openKey && shownResult ? mapOption : null;
  const openDeparture = openRide?.departure ?? mappedOption?.itinerary.rides[0]?.departure ?? null;
  useEffect(() => {
    const near =
      shownResult !== null &&
      (shownResult.request.mode === 'now' ||
        Math.abs(shownResult.request.at - Date.now()) < LIVE_HORIZON_MS);
    onLive({ stops: near ? planLiveStops(shownResult, 7) : [], ride: openDeparture });
  }, [shownResult, openDeparture, onLive]);
  useEffect(() => () => onLive({ stops: [], ride: null }), [onLive]);

  const refreshNow = useCallback(() => setApplied({ mode: 'now', at: Date.now() }), []);
  const pick = (which: 'origin' | 'target', id: string | null) => {
    if (which === 'origin') {
      setOriginId(id);
      setOriginChosenAt(Date.now());
    } else setTargetId(id);
    setOpenRide(null);
    setOpenKey(null);
    setMapFocus(null);
    setProblem(null);
    if (applied.mode === 'now') refreshNow();
  };
  const swap = () => {
    if (!targetId) return;
    setOriginId(targetId);
    setOriginChosenAt(Date.now());
    setTargetId(originId);
    setOpenRide(null);
    setOpenKey(null);
    setMapFocus(null);
    setProblem(null);
    if (applied.mode === 'now') refreshNow();
  };
  const choose = (next: PlanMode) => {
    setMode(next);
    setOpenRide(null);
    setOpenKey(null);
    setMapFocus(null);
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
        const place = kind === 'access' ? origin : target;
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

  return (
    <Card title="Cómo llegar">
      <PlaceRow
        onClear={() => pick('origin', null)}
        label="Desde"
        options={options}
        selected={originId}
        placeholder="Elige de dónde sales"
        accessibilityLabel="Elegir el origen"
        onPick={(id) => pick('origin', id)}
      />
      <PlaceRow
        onClear={() => pick('target', null)}
        label="Hasta"
        options={options}
        selected={targetId}
        placeholder="Elige a dónde vas"
        accessibilityLabel="Elegir el destino"
        onPick={(id) => pick('target', id)}
      >
        <IconButton
          icon={ArrowUpDown}
          accessibilityLabel="Invertir origen y destino"
          disabled={!targetId}
          onPress={swap}
          style={styles.swap}
        />
      </PlaceRow>
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
              setOpenRide(null);
              setOpenKey(null);
              setMapFocus(null);
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
          links={walks?.key === pairKey ? [...walks.origin, ...walks.destination] : []}
          transfers={walks?.stops ?? []}
          snapshot={snapshot}
          active={active}
          focus={mapFocus}
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
      ) : (
        <PlanList
          schedule={schedule}
          stopIndex={stopIndex}
          result={shownResult}
          snapshot={snapshot}
          active={active}
          searching={searching}
          targetName={target.name}
          originName={origin!.name}
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
          onSelect={
            onSelectJourney
              ? async (option) => {
                  const before = chosenKey;
                  setChosenKey(option.scheduleKey);
                  try {
                    await onSelectJourney(
                      {
                        originId: origin.id,
                        destinationId: target.id,
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
              : undefined
          }
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
        edit={{ kind: 'access', walk: plan.access }}
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
          edit={{ kind: 'egress', walk: plan.egress }}
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
