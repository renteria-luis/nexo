import { useFocusEffect } from '@react-navigation/native';
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays, daysBetween } from '../../core/dates.ts';
import { type Coordinates } from '../../core/geo.ts';
import { useAppData } from '../../shell/AppData.tsx';
import { loadTransit, refreshTransit, transitLocation } from '../../shell/transit.ts';
import {
  agencyClock,
  agencyDate,
  buildStopIndex,
  departures,
  listPlaces,
  listWalkLinks,
  nearbyStops,
  queryInstant,
  savePlace,
  saveWalkLink,
  scheduledTime,
  PLACE_ICONS,
  type CachedSchedule,
  type Departure,
  type Place,
  type PlaceIcon,
  type WalkLink,
} from '../../transit/index.ts';
import { stopLines, usefulStops, validCoordinates } from '../../transit/schedule.ts';
import { buildLiveQuery } from '../../transit/realtime.ts';

import { Button } from '../Button.tsx';
import { Card } from '../Card.tsx';
import { Chip } from '../Chip.tsx';
import { Pencil, Plus, RefreshCw } from '../icons.ts';
import { PLACE_ICON_VIEWS } from '../placeIcons.ts';
import { routeColor } from '../routeColors.ts';
import { TextField } from '../TextField.tsx';
import { TransitLiveMap } from '../TransitLiveMap.tsx';
import {
  TransitAlerts,
  TransitStopDepartures,
  TransitStopHeader,
  TransitTripTimeline,
} from '../TransitDepartures.tsx';
import { TransitPlanner, type PlannerLive } from '../TransitPlanner.tsx';
import { TransitLegend } from '../TransitStatus.tsx';
import { TransitWhen } from '../TransitWhen.tsx';
import { TransitLiveSettings } from '../TransitLiveSettings.tsx';
import { useTransitLive } from '../useTransitLive.ts';
import { font, sheet, shape, theme } from '../theme.ts';
import { Screen, useScrollIntoView } from './Screen.tsx';

type Draft = {
  id?: string;
  name: string;
  address: string;
  lat: string;
  lng: string;
  icon: PlaceIcon;
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const sameTrip = (a: Departure | null, b: Departure | null) =>
  !!a && !!b && a.trip[0] === b.trip[0] && a.serviceDate === b.serviceDate;

/** The map's card. A tap on a bus further down scrolls the screen up to it. */
function MapCard({
  title,
  reveal,
  children,
}: {
  title: string;
  reveal: number | null;
  children: ReactNode;
}) {
  const scrollIntoView = useScrollIntoView();
  const block = useRef<View>(null);
  useEffect(() => {
    if (reveal !== null) scrollIntoView(block.current);
  }, [reveal, scrollIntoView]);
  return (
    <View ref={block} collapsable={false}>
      <Card title={title}>{children}</Card>
    </View>
  );
}

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
  const [data, setData] = useState<{ db: SQLiteDatabase; cache: CachedSchedule } | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [stopId, setStopId] = useState<string | null>(null);
  const [stopsFolded, setStopsFolded] = useState(false);
  const [moreStops, setMoreStops] = useState(false);
  const [links, setLinks] = useState<WalkLink[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
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
  const [walkEdits, setWalkEdits] = useState(0);
  // The bus he last tapped on a trip card, and when, so the same tap again moves the map again.
  const [focus, setFocus] = useState<{ departure: Departure; at: number } | null>(null);
  const focusBus = useCallback(
    (departure: Departure) => setFocus({ departure, at: Date.now() }),
    [],
  );
  const alive = useRef(true);
  const pending = useRef(false);
  const syncPending = useRef(false);
  const placeRead = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async (current: NonNullable<typeof data>) => {
    if (syncPending.current) return;
    syncPending.current = true;
    setSyncing(true);
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
      syncPending.current = false;
      if (alive.current) setSyncing(false);
    }
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

  const place = places.find((p) => p.id === placeId) ?? places[0];
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
  const stops = useMemo(() => candidates.map((c) => c.stop), [candidates]);
  const useful = useMemo(
    () => (schedule && index ? usefulStops(schedule, index, candidates) : { main: [], more: [] }),
    [schedule, index, candidates],
  );
  const selected = candidates.find((c) => c.stop[0] === stopId);
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
        ...(shownStopId && liveMode ? [shownStopId] : []),
        ...(plannerStops ? plannerStops.split(',') : []),
      ]),
    ].slice(0, 8);
    const trips =
      liveMode && selectedTripId && selectedServiceDate
        ? [{ tripId: selectedTripId, serviceDate: selectedServiceDate }]
        : [];
    const routeIds = liveMode && selectedRouteId ? [selectedRouteId] : [];
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
      ? buildLiveQuery(schedule, { stopIds, trips, routeIds })
      : null;
  }, [
    schedule,
    shownStopId,
    liveMode,
    editingLive,
    selectedTripId,
    selectedServiceDate,
    selectedRouteId,
    plannerStops,
    plannerRide,
    today,
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
  // The map shows the bus he tapped while its trip is open, otherwise the open Paradas trip, then
  // the planner's.
  const tapped =
    focus && (sameTrip(focus.departure, selectedDetail) || sameTrip(focus.departure, plannerRide))
      ? focus.departure
      : null;
  const followed = tapped ?? selectedDetail ?? plannerRide;
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
          )
        : [],
    [schedule, index, stopIndex, effectiveFrom, liveMode],
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
  }, [db, activePlaceId]);
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
  const editingPoint = draft !== null;
  const pickPlace = useCallback(
    (id: string) => {
      if (editingPoint) {
        const p = places.find((p) => p.id === id);
        if (p) pickPoint(p);
        return;
      }
      setPlaceId(id);
      setStopId(null);
      setNotice(null);
      setProblem(null);
    },
    [editingPoint, places, pickPoint],
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
    <Screen title="Transit" scrollEnabled={!mapActive}>
      {problem && (
        <Text accessibilityRole="alert" style={styles.error}>
          {problem}
        </Text>
      )}
      {notice && <Text style={styles.note}>{notice}</Text>}
      <TransitLiveSettings
        config={live.config}
        error={live.configError}
        onSave={live.save}
        onClear={live.clear}
      />
      <Card
        title="Tus lugares"
        action={
          <Button
            label="Añadir"
            icon={Plus}
            variant="ghost"
            disabled={busy || !!draft}
            onPress={() => {
              setDraft({ name: '', address: '', lat: '', lng: '', icon: 'pin' });
              setProblem(null);
            }}
          />
        }
      >
        <View style={styles.wrap}>
          {places.map((p) => (
            <Chip
              key={p.id}
              label={p.name}
              selected={p.id === place.id}
              disabled={busy || !!draft}
              onPress={() => pickPlace(p.id)}
            />
          ))}
        </View>
        <Text style={styles.note}>{place.address}</Text>
        <Text style={styles.coordinates}>
          {place.lat}, {place.lng}
        </Text>
        <Button
          label="Editar lugar"
          icon={Pencil}
          variant="ghost"
          disabled={busy || !!draft}
          onPress={() =>
            setDraft({
              id: place.id,
              name: place.name,
              address: place.address,
              lat: String(place.lat),
              lng: String(place.lng),
              icon: place.icon,
            })
          }
        />
      </Card>
      {draft && (
        <Card title={draft.id ? 'Editar lugar' : 'Nuevo lugar'}>
          <TextField
            accessibilityLabel="Nombre del lugar"
            value={draft.name}
            onChange={(name) => setDraft((d) => d && { ...d, name })}
            placeholder="Nombre"
            style={styles.input}
          />
          <TextField
            accessibilityLabel="Dirección o puerta del lugar"
            value={draft.address}
            onChange={(address) => setDraft((d) => d && { ...d, address })}
            placeholder="Dirección o puerta"
            style={styles.input}
          />
          <View style={styles.row}>
            <TextField
              accessibilityLabel="Latitud del lugar"
              value={draft.lat}
              onChange={(lat) => setDraft((d) => d && { ...d, lat })}
              placeholder="Latitud"
              style={[styles.input, styles.flex]}
            />
            <TextField
              accessibilityLabel="Longitud del lugar"
              value={draft.lng}
              onChange={(lng) => setDraft((d) => d && { ...d, lng })}
              placeholder="Longitud"
              style={[styles.input, styles.flex]}
            />
          </View>
          <Text style={styles.note}>
            Escribe coordenadas, toca el mapa o usa tu ubicación. Se guarda al tocar Guardar.
          </Text>
          <Text style={styles.note}>Ícono en el mapa: {PLACE_ICON_VIEWS[draft.icon].label}</Text>
          <View style={styles.wrap}>
            {PLACE_ICONS.map((icon) => (
              <Chip
                key={icon}
                label=""
                icon={PLACE_ICON_VIEWS[icon].icon}
                accessibilityLabel={`Ícono ${PLACE_ICON_VIEWS[icon].label}`}
                selected={draft.icon === icon}
                onPress={() => setDraft((d) => d && { ...d, icon })}
              />
            ))}
          </View>
          <Button
            label="Usar mi ubicación"
            loading={busy}
            onPress={() =>
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
          />
          <View style={styles.wrap}>
            <Button
              label="Guardar lugar"
              variant="primary"
              loading={busy}
              onPress={() =>
                void act(async () => {
                  if (!draft.lat.trim() || !draft.lng.trim())
                    throw new Error('Completa la latitud y la longitud.');
                  const id = await savePlace(data.db, {
                    ...draft,
                    lat: Number(draft.lat),
                    lng: Number(draft.lng),
                  });
                  const saved = await listPlaces(data.db);
                  if (alive.current) {
                    setPlaces(saved);
                    setPlaceId(id);
                    setStopId(null);
                    setDraft(null);
                    setNotice('Lugar guardado.');
                  }
                })
              }
            />
            <Button
              label="Cancelar"
              disabled={busy}
              onPress={() => {
                setDraft(null);
                setProblem(null);
              }}
            />
          </View>
        </Card>
      )}
      {index && (
        <TransitPlanner
          db={data.db}
          schedule={schedule}
          stopIndex={index}
          places={places}
          initialOrigin={place.id}
          snapshot={live.state.snapshot}
          active={live.active}
          today={today}
          walksVersion={walkEdits}
          onLive={onPlannerLive}
          onFocusBus={focusBus}
        />
      )}
      <MapCard title={draft ? 'Elige el punto exacto' : place.name} reveal={focus?.at ?? null}>
        <TransitLiveMap
          schedule={schedule}
          snapshot={
            sameTrip(followed, plannerRide) && !sameTrip(followed, selectedDetail)
              ? live.state.snapshot
              : snapshot
          }
          active={live.active}
          followed={followed}
          focusKey={tapped ? focus!.at : null}
          center={center}
          places={places}
          stops={stops}
          selectedPlace={place.id}
          selectedStop={shownStopId}
          draft={draftPoint && validCoordinates(draftPoint) ? draftPoint : null}
          onPlace={pickPlace}
          onStop={openStop}
          onPoint={draft && !busy ? pickPoint : undefined}
          onInteraction={setMapActive}
          routePoints={routePoints}
          routeColor={followed ? routeColor(followed.route[3]) : undefined}
        />
      </MapCard>
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
            El horario guardado venció el {schedule.validTo}. Actualiza antes de confiar en el
            servicio.
          </Text>
        )}
        {outsideDate && (
          <Text style={styles.note}>
            La fecha está fuera de vigencia. Solo pueden aparecer viajes que continúan desde un día
            de servicio válido anterior.
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
        <Text style={styles.note}>
          Distancias en línea recta: la acera, los cruces y la puerta pueden cambiar la caminata.
          Las paradas repetidas para las mismas líneas quedan en «Ver más».
        </Text>
        {snapshot && <TransitAlerts snapshot={snapshot} active={live.active} />}
        <TransitLegend />
      </Card>
      {stop && (
        <Card title="Tu caminata">
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
            Incluye los cruces y el tramo interior que recorras. Ida y vuelta se guardan por
            separado.
          </Text>
          <Button
            label="Guardar caminata"
            loading={busy}
            onPress={() =>
              void act(async () => {
                await saveWalkLink(data.db, {
                  place_id: place.id,
                  stop_id: stop.stop[0],
                  direction,
                  minutes: Number(walkMinutes),
                  entrance,
                });
                const saved = await listWalkLinks(data.db, place.id);
                if (alive.current) {
                  setLinks(saved);
                  setWalkEdits((n) => n + 1);
                  setNotice('Caminata guardada para esta dirección.');
                }
              })
            }
          />
          {missingLinks.map((l) => (
            <Text key={`${l.stop_id}-${l.direction}`} style={styles.error}>
              Revisar parada {l.stop_id}: ya no aparece en el horario. Se conserva tu caminata de{' '}
              {l.minutes} min ({l.direction === 'to_stop' ? 'ida' : 'vuelta'}),{' '}
              {l.entrance || 'sin nota'}.
            </Text>
          ))}
        </Card>
      )}
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
          Lugares, caminatas y horarios disponibles sin conexión. El fondo del mapa puede necesitar
          internet.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = sheet((theme) => ({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1, minWidth: 0 },
  body: { fontFamily: font.bold, fontSize: 14, color: theme.text },
  note: { fontFamily: font.regular, fontSize: 12, color: theme.textFaint },
  error: { fontFamily: font.bold, fontSize: 13, color: theme.danger },
  coordinates: { fontFamily: font.regular, fontSize: 11, color: theme.textFaint },
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
