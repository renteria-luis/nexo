import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ActivityIndicator, LayoutAnimation, Pressable, Text, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays, daysBetween } from '../../core/dates.ts';
import { distanceMetres, type Coordinates } from '../../core/geo.ts';
import { useAppData } from '../../shell/AppData.tsx';
import { useTransitJourneyLink } from '../../shell/TransitJourney.tsx';
import type { TransitResponse } from '../../shell/notifications.ts';
import { loadTransit, refreshTransit, transitHere, transitLocation } from '../../shell/transit.ts';
import {
  agencyClock,
  agencyDate,
  buildStopIndex,
  departures,
  listPlaces,
  listWalkLinks,
  nearbyStops,
  nearestPlace,
  queryInstant,
  savePlace,
  saveWalkLink,
  scheduledTime,
  type CachedSchedule,
  type Departure,
  type Place,
  type WalkLink,
} from '../../transit/index.ts';
import { stopLines, usefulStops, validCoordinates } from '../../transit/schedule.ts';
import { buildLiveQuery, observedServiceTrips } from '../../transit/realtime.ts';
import { placeCategories } from '../../transit/place-categories.ts';

import { Button } from '../Button.tsx';
import { Card } from '../Card.tsx';
import { Chip } from '../Chip.tsx';
import { Combobox } from '../Combobox.tsx';
import { ChevronDown, ChevronRight, Pencil, Plus, Radio, RefreshCw, X } from '../icons.ts';
import { IconButton } from '../IconButton.tsx';
import { ExploreIcon } from '../ExploreIcon.tsx';
import { PopupSheet } from '../PopupSheet.tsx';
import { PlaceForm, type PlaceDraft } from '../PlaceForm.tsx';
import { placeOptions } from '../placeIcons.ts';
import { routeColor } from '../routeColors.ts';
import { TextField } from '../TextField.tsx';
import { TransitPersonalMap, type WalkPreview } from '../TransitPersonalMap.tsx';
import { TransitWalkReview } from '../TransitWalkReview.tsx';
import {
  TransitStopDepartures,
  TransitStopHeader,
  TransitTripTimeline,
} from '../TransitDepartures.tsx';
import { TransitPlanner, type PlannerLive } from '../TransitPlanner.tsx';
import { TransitLegend } from '../TransitStatus.tsx';
import { TransitJourneyAlerts, TransitJourneyCard } from '../TransitJourneyCard.tsx';
import { TransitWhen } from '../TransitWhen.tsx';
import { TransitLiveSettings } from '../TransitLiveSettings.tsx';
import { useTransitLive } from '../useTransitLive.ts';
import { font, sheet, shape, theme } from '../theme.ts';
import { Screen } from './Screen.tsx';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const sameTrip = (a: Departure | null, b: Departure | null) =>
  !!a && !!b && a.trip[0] === b.trip[0] && a.serviceDate === b.serviceDate;

class TransitBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: message(error) };
  }
  render() {
    return this.state.error ? (
      <Screen title="Transit">
        <Card title="Transit no se pudo abrir">
          <Text style={styles.error}>{this.state.error}</Text>
          <Button label="Reintentar" onPress={() => this.setState({ error: null })} />
        </Card>
      </Screen>
    ) : (
      this.props.children
    );
  }
}

export function TransitScreen() {
  const { state } = useAppData();
  if (state.phase !== 'ready') return <Screen title="Transit">{null}</Screen>;
  return (
    <TransitBoundary>
      <TransitContent />
    </TransitBoundary>
  );
}

function TransitContent() {
  const journey = useTransitJourneyLink();
  const navigation = useNavigation();
  const [panel, setPanel] = useState<'explore' | 'live' | null>(null);
  const [exploreMapActive, setExploreMapActive] = useState(false);
  const [refreshAt, setRefreshAt] = useState(0);
  const route = useRoute<{ key: string; name: string; params?: { reminder?: TransitResponse } }>();
  const reminder = route.params?.reminder;
  const [data, setData] = useState<{ db: SQLiteDatabase; cache: CachedSchedule } | null>(null);
  useEffect(() => {
    if (data) journey.actions.schedule(data.cache);
  }, [data, journey.actions]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [stopId, setStopId] = useState<string | null>(null);
  const [stopsFolded, setStopsFolded] = useState(false);
  const [moreStops, setMoreStops] = useState(false);
  const [links, setLinks] = useState<WalkLink[]>([]);
  const [draft, setDraft] = useState<PlaceDraft | null>(null);
  // Choosing the point on the map, with the place's sheet put away until he comes back.
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [mapActive, setMapActive] = useState(false);
  const [direction, setDirection] = useState<WalkLink['direction']>('to_stop');
  const [walkMinutes, setWalkMinutes] = useState('');
  const [entrance, setEntrance] = useState('');
  const [seenWalk, setSeenWalk] = useState('');
  const [today, setToday] = useState(() => agencyDate(Date.now()));
  const [date, setDate] = useState(() => agencyDate(Date.now()));
  const [clock, setClock] = useState(() => agencyClock(Date.now()));
  const [from, setFrom] = useState(Date.now);
  const [liveMode, setLiveMode] = useState(true);
  const [detail, setDetail] = useState<Departure | null>(null);
  const [plannerLive, setPlannerLive] = useState<PlannerLive>({ stops: [], ride: null });
  const [tripPlaceIds, setTripPlaceIds] = useState<string[]>([]);
  const [walkEdits, setWalkEdits] = useState(0);
  const [walkPreview, setWalkPreview] = useState<WalkPreview | null>(null);
  const [walkOpen, setWalkOpen] = useState(false);
  // While a trip is in progress its card is the screen: the rest folds to one line each.
  const traveling = journey.traveling;
  const [opened, setOpened] = useState<{ trip: string; sections: string[] } | null>(null);
  const openSections = traveling && opened?.trip === traveling ? opened.sections : [];
  const shows = (section: string) => !traveling || openSections.includes(section);
  const stopsShown = shows('stops');
  const toggleSection = (section: string) => {
    if (!traveling) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpened({
      trip: traveling,
      sections: openSections.includes(section)
        ? openSections.filter((s) => s !== section)
        : [...openSections, section],
    });
  };
  const walksChanged = useCallback(() => {
    setWalkEdits((n) => n + 1);
    void journey.actions.refresh();
  }, [journey.actions]);
  // The bus he last tapped on a trip card, and when, so the same tap again moves the map again.
  const [focus, setFocus] = useState<{ departure: Departure; at: number } | null>(null);
  // A bus opened from Paradas is inspected in the explorer.
  const focusBus = useCallback((departure: Departure) => {
    const at = Date.now();
    setFocus({ departure, at });
    setPanel('explore');
  }, []);
  // Where he is as he opens Transit: one reading at once, and the place nearest to it is shown
  // and starts the trip, unless he picks another before it lands.
  const [here, setHere] = useState<{ point: Coordinates; asked: number } | null>(null);
  const [pickedAt, setPickedAt] = useState(0);
  const [seenHere, setSeenHere] = useState<number | null>(null);
  const alive = useRef(true);
  const pending = useRef(false);
  const syncPending = useRef<Promise<void> | null>(null);
  const placeRead = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback((current: NonNullable<typeof data>) => {
    if (syncPending.current) return syncPending.current;
    setSyncing(true);
    const work = (async () => {
      try {
        const result = await refreshTransit(current.db, current.cache);
        if (!alive.current) return;
        if (result.kind === 'updated') {
          setData({ db: current.db, cache: result.cache });
          setDetail(null);
          setNotice('Horarios actualizados.');
        } else {
          const reason = result.kind === 'failed' ? result.reason : null;
          setData({
            db: current.db,
            cache: { ...current.cache, checked_at: Date.now(), last_error: reason },
          });
          setNotice(
            reason
              ? `No se pudo actualizar. Se conserva el horario guardado. ${reason}`
              : 'Ya tienes la versión publicada.',
          );
        }
      } catch (error) {
        if (alive.current) setProblem(message(error));
      } finally {
        syncPending.current = null;
        if (alive.current) setSyncing(false);
      }
    })();
    syncPending.current = work;
    return work;
  }, []);

  const load = useCallback(async () => {
    try {
      const current = await loadTransit();
      const saved = await listPlaces(current.db);
      if (!alive.current) return;
      setData(current);
      setPlaces(saved);
      setProblem(null);
      setToday(agencyDate(Date.now()));
      if (
        current.cache.checked_at === null ||
        agencyDate(current.cache.checked_at) !== agencyDate(Date.now())
      )
        void refresh(current);
    } catch (error) {
      if (alive.current) setProblem(message(error));
    }
  }, [refresh]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useFocusEffect(
    useCallback(() => {
      const asked = Date.now();
      let current = true;
      transitHere()
        .then((point) => {
          if (current && point) setHere({ point, asked });
        })
        .catch((error: unknown) => console.error(error));
      return () => {
        current = false;
      };
    }, []),
  );

  const place = places.find((p) => p.id === placeId) ?? places[0];
  const nearest = useMemo(() => (here ? nearestPlace(places, here.point) : null), [here, places]);
  if (here && nearest && seenHere !== here.asked) {
    setSeenHere(here.asked);
    if (pickedAt < here.asked && nearest.id !== place?.id) {
      setPlaceId(nearest.id);
      setStopId(null);
    }
  }
  const located = useMemo(
    () => (here && nearest ? { id: nearest.id, at: here.asked } : null),
    [here, nearest],
  );
  const options = useMemo(() => placeOptions(places), [places]);
  const categories = useMemo(() => placeCategories(places), [places]);
  const schedule = data?.cache.schedule;
  const index = useMemo(() => (schedule ? buildStopIndex(schedule) : null), [schedule]);
  const draftPoint =
    draft && draft.lat.trim() && draft.lng.trim()
      ? { lat: Number(draft.lat), lng: Number(draft.lng) }
      : null;
  const draftLat = draft?.lat;
  const draftLng = draft?.lng;
  const placeLat = place?.lat;
  const placeLng = place?.lng;
  const center = useMemo(() => {
    const point =
      draftLat?.trim() && draftLng?.trim()
        ? { lat: Number(draftLat), lng: Number(draftLng) }
        : null;
    return point && validCoordinates(point)
      ? point
      : { lat: placeLat ?? 43, lng: placeLng ?? -81.24 };
  }, [draftLat, draftLng, placeLat, placeLng]);
  const candidates = useMemo(
    () => (schedule ? nearbyStops(schedule, center, 16) : []),
    [schedule, center],
  );
  const useful = useMemo(
    () => (schedule && index ? usefulStops(schedule, index, candidates) : { main: [], more: [] }),
    [schedule, index, candidates],
  );
  const selected = useMemo(() => {
    const nearby = candidates.find((c) => c.stop[0] === stopId);
    if (nearby || !schedule || !stopId) return nearby;
    const index = schedule.stops.findIndex((stop) => stop[0] === stopId);
    if (index < 0) return undefined;
    const stop = schedule.stops[index];
    return { stop, index, distanceM: distanceMetres(center, { lat: stop[3], lng: stop[4] }) };
  }, [candidates, schedule, stopId, center]);
  const stop = stopsFolded ? undefined : (selected ?? useful.main[0] ?? candidates[0]);
  const shownStopId = stop?.stop[0] ?? null;
  const stopIndex = stop?.index;
  const routesAt = useCallback(
    (at: number) =>
      schedule && index
        ? [...new Map(stopLines(schedule, index, at).map((l) => [l.route[0], l.route])).values()]
        : [],
    [schedule, index],
  );
  const openStop = useCallback(
    (id: string) => {
      setStopId(id);
      setStopsFolded(false);
      setDetail(null);
      if (useful.more.some((c) => c.stop[0] === id)) setMoreStops(true);
    },
    [useful],
  );
  const knownStops = useMemo(() => new Set(schedule?.stops.map((s) => s[0]) ?? []), [schedule]);
  const missingLinks = links.filter((l) => !knownStops.has(l.stop_id));
  const selectedDetail =
    detail && schedule?.stops[detail.stopTime[0]]?.[0] === shownStopId ? detail : null;
  const selectedTripId = selectedDetail?.trip[0];
  const selectedServiceDate = selectedDetail?.serviceDate;
  const selectedRouteId = selectedDetail?.route[0];
  const editingLive = draft !== null;
  const onPlannerLive = useCallback(
    (next: PlannerLive) =>
      setPlannerLive((current) =>
        current.stops.join() === next.stops.join() && current.ride === next.ride ? current : next,
      ),
    [],
  );
  const plannerStops = plannerLive.stops.join();
  const plannerRide = plannerLive.ride;
  // One live reading serves the stop card and the planner, inside the service's limits of
  // eight stops, four trips and four lines; the open stop goes first.
  const query = useMemo(() => {
    if (!schedule || editingLive) return null;
    const stopIds = [
      ...new Set([
        ...(journey.query?.stopIds ?? []),
        ...(shownStopId && liveMode && stopsShown ? [shownStopId] : []),
        ...(plannerStops ? plannerStops.split(',') : []),
      ]),
    ].slice(0, 8);
    const trips = [...(journey.query?.trips ?? [])];
    if (
      liveMode &&
      selectedTripId &&
      selectedServiceDate &&
      !trips.some((t) => t.tripId === selectedTripId && t.serviceDate === selectedServiceDate)
    )
      trips.push({ tripId: selectedTripId, serviceDate: selectedServiceDate });
    const routeIds = [...(journey.query?.routeIds ?? [])];
    if (liveMode && selectedRouteId && !routeIds.includes(selectedRouteId))
      routeIds.push(selectedRouteId);
    // The service only answers for trips from two days back to tomorrow.
    if (
      plannerRide &&
      plannerRide.serviceDate >= addDays(today, -2) &&
      plannerRide.serviceDate <= addDays(today, 1) &&
      !trips.some(
        (t) => t.tripId === plannerRide.trip[0] && t.serviceDate === plannerRide.serviceDate,
      )
    ) {
      trips.push({ tripId: plannerRide.trip[0], serviceDate: plannerRide.serviceDate });
      if (!routeIds.includes(plannerRide.route[0])) routeIds.push(plannerRide.route[0]);
    }
    return stopIds.length || trips.length
      ? buildLiveQuery(schedule, {
          stopIds,
          trips: trips.slice(0, 4),
          routeIds: routeIds.slice(0, 4),
        })
      : null;
  }, [
    schedule,
    shownStopId,
    liveMode,
    stopsShown,
    editingLive,
    selectedTripId,
    selectedServiceDate,
    selectedRouteId,
    plannerStops,
    plannerRide,
    today,
    journey.query,
  ]);
  // Live reads follow the open trips until they are over, not only around his departure.
  const following = [selectedDetail, plannerRide].filter((d): d is Departure => d !== null);
  const live = useTransitLive(
    schedule,
    query,
    following.length ? Math.min(...following.map((d) => d.at)) : undefined,
    following.length && schedule
      ? Math.max(
          ...following.map((d) =>
            scheduledTime(d.serviceDate, d.trip[7] + schedule.patterns[d.trip[6]].at(-1)![2]),
          ),
        )
      : undefined,
  );
  const snapshot = liveMode ? live.state.snapshot : null;
  useEffect(() => {
    journey.actions.snapshot(live.state.snapshot);
  }, [journey.actions, live.state.snapshot]);
  // The explorer follows its own stop selection, independently of Cómo llegar.
  const tapped = focus && sameTrip(focus.departure, selectedDetail) ? focus.departure : null;
  const followed = tapped ?? selectedDetail;
  const followedShapeId = followed?.trip[5];
  const effectiveFrom = liveMode ? Math.max(from, live.state.lastSuccessAt ?? from) : from;
  const departuresList = useMemo(
    () =>
      schedule && index && stopIndex !== undefined
        ? departures(
            schedule,
            index,
            stopIndex,
            liveMode ? effectiveFrom - 3_600_000 : effectiveFrom,
            liveMode ? 80 : 20,
            liveMode ? observedServiceTrips(schedule, live.state.snapshot, effectiveFrom) : [],
          )
        : [],
    [schedule, index, stopIndex, effectiveFrom, liveMode, live.state.snapshot],
  );
  const choices = useMemo(
    () =>
      selectedDetail
        ? departuresList.filter(
            (d) => d.route[0] === selectedDetail.route[0] && d.trip[4] === selectedDetail.trip[4],
          )
        : [],
    [departuresList, selectedDetail],
  );
  const routePoints = useMemo(
    () =>
      followedShapeId && schedule
        ? (schedule.shapes[followedShapeId] ?? []).map((p) => ({ lat: p[0], lng: p[1] }))
        : [],
    [followedShapeId, schedule],
  );
  const db = data?.db;
  const activePlaceId = place?.id;
  useEffect(() => {
    const version = ++placeRead.current;
    if (!db || !activePlaceId) return;
    listWalkLinks(db, activePlaceId)
      .then((saved) => {
        if (alive.current && version === placeRead.current) setLinks(saved);
      })
      .catch((error) => {
        if (alive.current && version === placeRead.current) setProblem(message(error));
      });
  }, [db, activePlaceId, walkEdits]);
  const savedWalk = links.find(
    (l) => l.place_id === activePlaceId && l.stop_id === shownStopId && l.direction === direction,
  );
  const walkKey = `${activePlaceId}/${shownStopId}/${direction}/${savedWalk?.updated_at ?? ''}`;
  if (seenWalk !== walkKey) {
    setSeenWalk(walkKey);
    const saved = savedWalk;
    setWalkMinutes(saved ? String(saved.minutes) : '');
    setEntrance(saved?.entrance ?? '');
  }

  const pickPoint = useCallback(
    (point: Coordinates) =>
      setDraft((d) => (d ? { ...d, lat: String(point.lat), lng: String(point.lng) } : d)),
    [],
  );
  const pickPlace = useCallback(
    (id: string) => {
      if (picking) {
        const p = places.find((p) => p.id === id);
        if (p) pickPoint(p);
        return;
      }
      setPlaceId(id);
      setPickedAt(Date.now());
      setStopId(null);
      setNotice(null);
      setProblem(null);
    },
    [picking, places, pickPoint],
  );
  const act = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      if (alive.current) setProblem(message(error));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.row}>
          <IconButton
            icon={ExploreIcon}
            accessibilityLabel="Explorar Transit"
            selected={panel === 'explore'}
            disabled={!data}
            onPress={() => {
              setPanel('explore');
              setExploreMapActive(false);
            }}
          />
          <IconButton
            icon={Radio}
            accessibilityLabel="Conexión en vivo y horario"
            selected={panel === 'live'}
            disabled={!data || !live.loaded || !!draft}
            onPress={() => {
              setPanel('live');
              setExploreMapActive(false);
            }}
          />
        </View>
      ),
    });
  }, [navigation, panel, data, draft, live.loaded]);

  const refreshLive = live.refresh;
  const refreshAll = useCallback(async () => {
    if (!data) return;
    const now = Date.now();
    setToday(agencyDate(now));
    if (liveMode) {
      setFrom(now);
      setDate(agencyDate(now));
      setClock(agencyClock(now));
    }
    setRefreshAt(now);
    setWalkEdits((version) => version + 1);
    const results = await Promise.allSettled([
      refresh(data),
      refreshLive(),
      journey.actions.refresh(),
      listPlaces(data.db).then((saved) => {
        if (alive.current) setPlaces(saved);
      }),
    ]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }, [data, liveMode, refreshLive, refresh, journey.actions]);

  if (!data || !place || !schedule)
    return (
      <Screen title="Transit">
        {problem ? (
          <Card title="No se pudieron leer los datos">
            <Text style={styles.error}>{problem}</Text>
            <Button label="Reintentar" onPress={() => void load()} />
          </Card>
        ) : (
          <ActivityIndicator />
        )}
      </Screen>
    );
  const expired = today > schedule.validTo;
  const requestedDay = agencyDate(from);
  const outsideDate = requestedDay < schedule.validFrom || requestedDay > schedule.validTo;
  const ageDays = Math.max(0, daysBetween(agencyDate(schedule.createdAt), today));

  return (
    <Screen
      title="Transit"
      refreshable
      onRefresh={refreshAll}
      scrollEnabled={!mapActive && !panel}
      onOverlayDismiss={
        busy
          ? undefined
          : () => {
              if (draft) {
                if (picking) setPicking(false);
                else {
                  setDraft(null);
                  setProblem(null);
                }
              } else setPanel(null);
              setExploreMapActive(false);
            }
      }
      overlayAbove={
        draft && !picking ? (
          <PlaceForm
            draft={draft}
            categories={categories}
            onChange={(change) => setDraft((d) => d && { ...d, ...change })}
            busy={busy}
            problem={problem}
            onLocate={() =>
              void act(async () => {
                const point = await Promise.race([
                  transitLocation(),
                  new Promise<never>((_, reject) =>
                    setTimeout(
                      () =>
                        reject(
                          new Error(
                            'La ubicación tardó demasiado. Puedes usar el mapa o escribirla.',
                          ),
                        ),
                      20_000,
                    ),
                  ),
                ]);
                if (alive.current) pickPoint(point);
              })
            }
            onPickOnMap={() => {
              setPicking(true);
              setPanel('explore');
              setExploreMapActive(false);
            }}
            onCancel={() => {
              setDraft(null);
              setProblem(null);
            }}
            onSave={() =>
              void act(async () => {
                if (!draft.lat.trim() || !draft.lng.trim())
                  throw new Error('Completa la latitud y la longitud.');
                const id = await savePlace(data.db, {
                  id: draft.id,
                  name: draft.name,
                  address: draft.address,
                  lat: Number(draft.lat),
                  lng: Number(draft.lng),
                  icon: draft.icon,
                  tags: draft.tags,
                  category: draft.category,
                  importance: draft.importance.trim() ? Number(draft.importance) : null,
                });
                const saved = await listPlaces(data.db);
                if (alive.current) {
                  setPlaces(saved);
                  setPlaceId(id);
                  setPickedAt(Date.now());
                  setStopId(null);
                  setDraft(null);
                  setNotice('Lugar guardado.');
                }
              })
            }
          />
        ) : undefined
      }
      overlay={
        panel === 'live' ? (
          <TransitLiveSettings
            config={live.config}
            error={live.configError}
            state={live.state}
            active={live.active}
            onSave={live.save}
            onClear={live.clear}
            onClose={() => setPanel(null)}
          >
            <Card
              title="Horario guardado"
              action={
                <Button
                  label="Actualizar"
                  icon={RefreshCw}
                  variant="ghost"
                  loading={syncing}
                  onPress={() => void refresh(data)}
                />
              }
            >
              <Text style={styles.body}>{schedule.feedVersion}</Text>
              <Text style={styles.note}>
                Válido {schedule.validFrom} a {schedule.validTo} · {schedule.stops.length} paradas
              </Text>
              <Text style={styles.note}>
                Preparado {agencyDate(schedule.createdAt)} ({ageDays} días) · versión{' '}
                {data.cache.sha256.slice(0, 12)}
              </Text>
              <Text style={styles.note}>
                Última revisión:{' '}
                {data.cache.checked_at
                  ? `${agencyDate(data.cache.checked_at)} ${agencyClock(data.cache.checked_at)}`
                  : 'incluido con esta versión de Nexo'}
              </Text>
              {data.cache.last_error && (
                <Text style={styles.error}>
                  Falló la última actualización. El horario guardado sigue disponible.
                </Text>
              )}
              <Text style={styles.note}>
                Lugares, caminatas y horarios disponibles sin conexión. El fondo del mapa puede
                necesitar internet.
              </Text>
            </Card>
          </TransitLiveSettings>
        ) : panel === 'explore' ? (
          <PopupSheet wide scrollEnabled={!exploreMapActive}>
            <View style={styles.panelHead}>
              <Text style={styles.panelTitle}>Explorar</Text>
              <IconButton
                icon={X}
                accessibilityLabel="Cerrar explorador"
                onPress={() => {
                  if (picking) setPicking(false);
                  else setPanel(null);
                  setExploreMapActive(false);
                }}
              />
            </View>
            <Card
              title="Tus lugares"
              action={
                <View style={styles.row}>
                  <IconButton
                    icon={Pencil}
                    accessibilityLabel="Editar lugar"
                    disabled={busy || !!draft}
                    onPress={() => {
                      setDraft({
                        id: place.id,
                        name: place.name,
                        address: place.address,
                        lat: String(place.lat),
                        lng: String(place.lng),
                        icon: place.icon,
                        tags: place.tags,
                        category: place.category,
                        importance: place.importance === null ? '' : String(place.importance),
                      });
                      setProblem(null);
                    }}
                  />
                  <IconButton
                    icon={Plus}
                    accessibilityLabel="Añadir lugar"
                    disabled={busy || !!draft}
                    onPress={() => {
                      setDraft({
                        name: '',
                        address: '',
                        lat: '',
                        lng: '',
                        icon: 'pin',
                        tags: '',
                        category: '',
                        importance: '',
                      });
                      setProblem(null);
                    }}
                  />
                </View>
              }
            >
              <Combobox
                options={options}
                value={place.id}
                onChange={pickPlace}
                placeholder="Elige un lugar"
                accessibilityLabel="Elegir el lugar"
              />
              <Text style={styles.note}>{place.address}</Text>
            </Card>
            <Card title={picking ? 'Toca el punto exacto' : place.name}>
              <TransitPersonalMap
                db={data.db}
                revision={walkEdits}
                onChanged={walksChanged}
                preview={walkPreview}
                schedule={schedule}
                snapshot={snapshot}
                active={live.active}
                followed={followed}
                focusKey={tapped ? focus!.at : null}
                center={center}
                places={places}
                selectedPlace={place.id}
                tripPlaceIds={tripPlaceIds}
                selectedStop={shownStopId}
                draft={draftPoint && validCoordinates(draftPoint) ? draftPoint : null}
                onPlace={pickPlace}
                onStop={openStop}
                onPoint={picking && !busy ? pickPoint : undefined}
                onInteraction={setExploreMapActive}
                routePoints={routePoints}
                routeColor={followed ? routeColor(followed.route[3]) : undefined}
              />
              {picking && draft && (
                <View style={styles.row}>
                  <Text style={[styles.note, styles.flex]}>
                    {draft.lat && draft.lng
                      ? `${draft.lat}, ${draft.lng}`
                      : 'Toca el mapa o un lugar para copiar su punto.'}
                  </Text>
                  <Button label="Listo" variant="primary" onPress={() => setPicking(false)} />
                </View>
              )}
            </Card>
          </PopupSheet>
        ) : undefined
      }
    >
      {problem && !draft && (
        <Text accessibilityRole="alert" style={styles.error}>
          {problem}
        </Text>
      )}
      {notice && <Text style={styles.note}>{notice}</Text>}
      {reminder?.kind === 'reminder' &&
        (reminder.expired || reminder.journeyId !== journey.saved.next?.id) && (
          <Text style={styles.note}>
            Ese aviso corresponde a un cálculo anterior. Revisa el viaje y las horas actuales antes
            de salir.
          </Text>
        )}
      <TransitJourneyCard surface="transit" onMapInteraction={setMapActive} />
      {traveling && (
        <FoldRow title="Cómo llegar" open={shows('plan')} onPress={() => toggleSection('plan')} />
      )}
      {index && shows('plan') && (
        <TransitPlanner
          db={data.db}
          schedule={schedule}
          stopIndex={index}
          places={places}
          initialOrigin={located?.id ?? null}
          refreshAt={refreshAt}
          onMapInteraction={setMapActive}
          onPlacesChange={setTripPlaceIds}
          located={located}
          snapshot={live.state.snapshot}
          active={live.active}
          today={today}
          walksVersion={walkEdits}
          onWalkChanged={walksChanged}
          onLive={onPlannerLive}
          journey={journey.saved.next}
          onSelectJourney={async (choice, option) => {
            const origin = places.find((p) => p.id === choice.originId);
            await journey.actions.choose({
              ...choice,
              selectedKey: option.scheduleKey,
              workoutId:
                origin?.gym_id && origin.gym_id === journey.gymId ? journey.sessionId : null,
            });
          }}
        />
      )}
      {!traveling && (
        <TransitWalkReview
          db={data.db}
          schedule={schedule}
          places={places}
          revision={walkEdits}
          onChanged={walksChanged}
          onPath={(walk) => {
            const key = Date.now();
            setWalkPreview({ key, walk });
            setPanel('explore');
          }}
        />
      )}
      {traveling && (
        <FoldRow title="Paradas" open={shows('stops')} onPress={() => toggleSection('stops')} />
      )}
      {shows('stops') && (
        <Card title="Paradas">
          <View style={styles.row}>
            <View style={styles.flex}>
              <TransitWhen
                live={liveMode}
                date={date}
                clock={clock}
                today={today}
                validFrom={schedule.validFrom}
                validTo={schedule.validTo}
                onDate={setDate}
                onClock={setClock}
                onApply={() => {
                  try {
                    setFrom(queryInstant(date, clock));
                    setLiveMode(false);
                    setProblem(null);
                    return true;
                  } catch (error) {
                    setProblem(message(error));
                    return false;
                  }
                }}
                onNow={() => {
                  const now = Date.now();
                  setDate(agencyDate(now));
                  setClock(agencyClock(now));
                  setFrom(now);
                  setLiveMode(true);
                  setProblem(null);
                }}
              />
            </View>
            {liveMode && live.config && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Actualizar en vivo"
                accessibilityState={{ busy: live.state.loading }}
                disabled={live.state.loading}
                onPress={() => void live.refresh()}
                style={[styles.iconButton, live.state.loading && styles.busy]}
              >
                <RefreshCw size={18} color={theme.text} strokeWidth={2.5} />
              </Pressable>
            )}
          </View>
          {liveMode && live.state.reason && <Text style={styles.note}>{live.state.reason}</Text>}
          {!liveMode && (
            <Text style={styles.note}>
              Horario guardado desde {agencyDate(from)} {agencyClock(from)}, hora de London; lo en
              vivo es solo para ahora.
            </Text>
          )}
          {snapshot && Object.entries(snapshot.health).some(([, h]) => h.status !== 'ok') && (
            <Text style={styles.note}>
              Alguna fuente de LTC no está al día; se conserva el último reporte y el horario.
            </Text>
          )}
          {expired && (
            <Text style={styles.error}>
              El horario guardado venció el {schedule.validTo}. Actualízalo en Conexión en vivo y
              horario, arriba, antes de confiar en el servicio.
            </Text>
          )}
          {outsideDate && (
            <Text style={styles.note}>
              La fecha está fuera de vigencia. Solo pueden aparecer viajes que continúan desde un
              día de servicio válido anterior.
            </Text>
          )}
          {[...useful.main, ...(moreStops ? useful.more : [])].map((c) => {
            const open = c.stop[0] === shownStopId;
            return (
              <View key={c.stop[0]} style={styles.stopBlock}>
                <TransitStopHeader
                  stop={c.stop}
                  distanceM={c.distanceM}
                  routes={routesAt(c.index)}
                  open={open}
                  onPress={() => (open ? setStopsFolded(true) : openStop(c.stop[0]))}
                />
                {open &&
                  (selectedDetail ? (
                    <TransitTripTimeline
                      schedule={schedule}
                      departure={selectedDetail}
                      choices={choices}
                      snapshot={snapshot}
                      active={live.active}
                      onSelect={setDetail}
                      onClose={() => setDetail(null)}
                      onFocusBus={focusBus}
                    />
                  ) : (
                    <TransitStopDepartures
                      schedule={schedule}
                      departures={departuresList}
                      snapshot={snapshot}
                      current={liveMode}
                      active={live.active}
                      onSelect={setDetail}
                    />
                  ))}
                {open && (
                  <Button
                    label={
                      walkOpen
                        ? 'Cerrar tu caminata'
                        : `Tu caminata con ${place.name}${savedWalk ? `: ${savedWalk.minutes} min` : ''}`
                    }
                    variant="ghost"
                    onPress={() => setWalkOpen(!walkOpen)}
                  />
                )}
                {open && walkOpen && (
                  <View style={styles.walk}>
                    <View style={styles.wrap}>
                      <Chip
                        label="Lugar → parada"
                        selected={direction === 'to_stop'}
                        onPress={() => setDirection('to_stop')}
                        disabled={busy}
                      />
                      <Chip
                        label="Parada → lugar"
                        selected={direction === 'from_stop'}
                        onPress={() => setDirection('from_stop')}
                        disabled={busy}
                      />
                    </View>
                    <TextField
                      accessibilityLabel="Minutos de caminata"
                      value={walkMinutes}
                      onChange={setWalkMinutes}
                      placeholder="Tus minutos habituales"
                      style={styles.input}
                    />
                    <TextField
                      accessibilityLabel="Puerta y notas de caminata"
                      value={entrance}
                      onChange={setEntrance}
                      placeholder="Puerta, cruces o tramo interior"
                      multiline
                      style={styles.input}
                    />
                    <Text style={styles.note}>
                      Incluye los cruces y el tramo interior que recorras. Ida y vuelta se guardan
                      por separado.
                    </Text>
                    <Button
                      label="Guardar caminata"
                      loading={busy}
                      onPress={() =>
                        void act(async () => {
                          await saveWalkLink(data.db, {
                            place_id: place.id,
                            stop_id: c.stop[0],
                            direction,
                            minutes: Number(walkMinutes),
                            entrance,
                          });
                          const saved = await listWalkLinks(data.db, place.id);
                          if (alive.current) {
                            setLinks(saved);
                            walksChanged();
                            // The button now carries the saved minutes, right where he typed them.
                            setWalkOpen(false);
                          }
                        })
                      }
                    />
                  </View>
                )}
              </View>
            );
          })}
          {useful.more.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: moreStops }}
              onPress={() => setMoreStops(!moreStops)}
              style={styles.more}
            >
              <Text style={styles.moreText}>
                {moreStops ? 'Ver menos paradas' : `Ver ${useful.more.length} paradas más`}
              </Text>
            </Pressable>
          )}
          {missingLinks.map((l) => (
            <Text key={`${l.stop_id}-${l.direction}`} style={styles.error}>
              Revisar parada {l.stop_id}: ya no aparece en el horario. Se conserva tu caminata de{' '}
              {l.minutes} min ({l.direction === 'to_stop' ? 'ida' : 'vuelta'}),{' '}
              {l.entrance || 'sin nota'}.
            </Text>
          ))}

          <Text style={styles.note}>
            Distancias en línea recta: la acera, los cruces y la puerta pueden cambiar la caminata.
            Las paradas repetidas para las mismas líneas quedan en «Ver más».
          </Text>
          {snapshot && (
            <TransitJourneyAlerts
              schedule={schedule}
              snapshot={snapshot}
              active={live.active}
              departures={selectedDetail ? [selectedDetail] : departuresList}
            />
          )}
          <TransitLegend />
        </Card>
      )}
    </Screen>
  );
}

/** While a trip is in progress, a section shrinks to its name; a tap opens or folds it. */
function FoldRow({ title, open, onPress }: { title: string; open: boolean; onPress: () => void }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${open ? 'Ocultar' : 'Mostrar'} ${title}`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => [styles.fold, pressed && styles.busy]}
    >
      <Text style={styles.foldTitle}>{title}</Text>
      <Icon size={20} color={theme.text} strokeWidth={2.5} />
    </Pressable>
  );
}

const styles = sheet((theme) => ({
  fold: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radius,
    backgroundColor: theme.surface,
  },
  foldTitle: { fontFamily: font.black, fontSize: 16, color: theme.text },
  walk: { gap: 8 },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  panelTitle: { fontFamily: font.black, fontSize: 18, color: theme.text },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1, minWidth: 0 },
  body: { fontFamily: font.bold, fontSize: 14, color: theme.text },
  note: { fontFamily: font.regular, fontSize: 12, color: theme.textFaint },
  error: { fontFamily: font.bold, fontSize: 13, color: theme.danger },
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
  stopBlock: { gap: 8 },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
  },
  busy: { opacity: 0.5 },
  more: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 2 },
  moreText: {
    fontFamily: font.bold,
    fontSize: 13,
    color: theme.text,
    textDecorationLine: 'underline',
  },
}));
