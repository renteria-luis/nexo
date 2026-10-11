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
import { ActivityIndicator, Text, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { daysBetween } from '../../core/dates.ts';
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
  type CachedSchedule,
  type Departure,
  type Place,
  type WalkLink,
} from '../../transit/index.ts';
import { validCoordinates } from '../../transit/schedule.ts';
import { buildLiveQuery } from '../../transit/realtime.ts';

import { Button } from '../Button.tsx';
import { Card } from '../Card.tsx';
import { Chip } from '../Chip.tsx';
import { Pencil, Plus, RefreshCw } from '../icons.ts';
import { TextField } from '../TextField.tsx';
import { TransitMap } from '../TransitMap';
import type { ReportedBus } from '../TransitMap.types.ts';
import { TransitAlerts, TransitDepartures, TransitTripDetail } from '../TransitDepartures.tsx';
import { TransitLiveSettings } from '../TransitLiveSettings.tsx';
import { useTransitLive } from '../useTransitLive.ts';
import { font, sheet, shape } from '../theme.ts';
import { Screen } from './Screen.tsx';

type Draft = { id?: string; name: string; address: string; lat: string; lng: string };
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
    () => (schedule ? nearbyStops(schedule, center) : []),
    [schedule, center],
  );
  const stops = useMemo(() => candidates.map((c) => c.stop), [candidates]);
  const selected = candidates.find((c) => c.stop[0] === stopId);
  const stop = selected ?? candidates[0];
  const shownStopId = stop?.stop[0] ?? null;
  const stopIndex = stop?.index;
  const lineNames = useMemo(() => {
    if (!schedule || !index || stopIndex === undefined) return [];
    return [
      ...new Set(
        (index.get(stopIndex) ?? []).flatMap((r) =>
          r.trips.map((trip) => schedule.routes[trip[1]][1]),
        ),
      ),
    ].sort();
  }, [schedule, index, stopIndex]);
  const knownStops = useMemo(() => new Set(schedule?.stops.map((s) => s[0]) ?? []), [schedule]);
  const missingLinks = links.filter((l) => !knownStops.has(l.stop_id));
  const selectedDetail =
    detail && schedule?.stops[detail.stopTime[0]]?.[0] === shownStopId ? detail : null;
  const selectedTripId = selectedDetail?.trip[0];
  const selectedServiceDate = selectedDetail?.serviceDate;
  const selectedRouteId = selectedDetail?.route[0];
  const selectedShapeId = selectedDetail?.trip[5];
  const editingLive = draft !== null;
  const query = useMemo(
    () =>
      schedule && shownStopId && liveMode && !editingLive
        ? buildLiveQuery(schedule, {
            stopIds: [shownStopId],
            trips:
              selectedTripId && selectedServiceDate
                ? [{ tripId: selectedTripId, serviceDate: selectedServiceDate }]
                : [],
            routeIds: selectedRouteId ? [selectedRouteId] : [],
          })
        : null,
    [
      schedule,
      shownStopId,
      liveMode,
      editingLive,
      selectedTripId,
      selectedServiceDate,
      selectedRouteId,
    ],
  );
  const live = useTransitLive(schedule, query, selectedDetail?.at);
  const snapshot = liveMode ? live.state.snapshot : null;
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
  const tripsById = useMemo(() => new Map(schedule?.trips.map((t) => [t[0], t]) ?? []), [schedule]);
  const buses = useMemo<ReportedBus[]>(() => {
    if (!schedule || !snapshot?.staticCompatible) return [];
    return snapshot.vehicles.flatMap((vehicle) => {
      if (!vehicle.position) return [];
      const trip = tripsById.get(vehicle.tripId);
      if (!trip) return [];
      return [
        {
          id: `${vehicle.entityId}-${vehicle.tripId}-${vehicle.serviceDate}`,
          label: `Bus ${vehicle.vehicleId ?? 'LTC'} · ${schedule.routes[trip[1]][1]} → ${trip[3]}`,
          lat: vehicle.position.lat,
          lng: vehicle.position.lng,
          measuredAt: vehicle.measuredAt,
          freshnessAt: Math.min(
            snapshot.generatedAt,
            snapshot.health.vehicles.feedTimestamp ?? 0,
            vehicle.measuredAt ?? 0,
          ),
          stale: vehicle.measuredAt === null || snapshot.health.vehicles.status !== 'ok',
        },
      ];
    });
  }, [snapshot, schedule, tripsById]);
  const routePoints = useMemo(
    () =>
      selectedShapeId && schedule
        ? (schedule.shapes[selectedShapeId] ?? []).map((p) => ({ lat: p[0], lng: p[1] }))
        : [],
    [selectedShapeId, schedule],
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
              setDraft({ name: '', address: '', lat: '', lng: '' });
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
      <Card title={draft ? 'Elige el punto exacto' : place.name}>
        <TransitMap
          center={center}
          places={places}
          stops={stops}
          selectedPlace={place.id}
          selectedStop={shownStopId}
          draft={draftPoint && validCoordinates(draftPoint) ? draftPoint : null}
          onPlace={pickPlace}
          onStop={setStopId}
          onPoint={draft && !busy ? pickPoint : undefined}
          onInteraction={setMapActive}
          buses={buses}
          routePoints={routePoints}
        />
      </Card>
      <Card title="Paradas cercanas">
        <Text style={styles.note}>
          Distancia en línea recta. La acera, los cruces y la puerta pueden cambiar la caminata.
          Líneas asociadas al horario completo; no todas pasan a toda hora.
        </Text>
        {candidates.map((c) => (
          <Chip
            key={c.stop[0]}
            label={`${c.stop[1] || 'Sin código'} · ${c.stop[2]} · ${Math.round(c.distanceM)} m`}
            accessibilityLabel={`${c.stop[2]}, identificador ${c.stop[0]}, a ${Math.round(c.distanceM)} metros en línea recta`}
            selected={c.stop[0] === shownStopId}
            onPress={() => setStopId(c.stop[0])}
            style={styles.stopChip}
          />
        ))}
      </Card>
      {stop && (
        <Card title={stop.stop[2]}>
          <Text style={styles.note}>
            ID {stop.stop[0]} · código {stop.stop[1] || 'no publicado'}
          </Text>
          <Text style={styles.body}>
            Líneas: {lineNames.join(', ') || 'ninguna en este paquete'}
          </Text>
          <Text style={styles.note}>
            {liveMode
              ? (live.state.reason ??
                (snapshot
                  ? 'Predicciones oficiales LTC; cada reporte conserva su hora.'
                  : 'Sin datos en vivo · se muestra el horario guardado.'))
              : 'Consulta de horario guardado; los datos en vivo corresponden a ahora.'}
          </Text>
          {liveMode && live.config && (
            <Button
              label="Actualizar en vivo"
              variant="ghost"
              loading={live.state.loading}
              onPress={() => void live.refresh()}
            />
          )}
          {snapshot && Object.entries(snapshot.health).some(([, h]) => h.status !== 'ok') && (
            <Text style={styles.note}>
              Sin datos frescos en alguna fuente. Se conserva el último reporte y el horario.
            </Text>
          )}
          {snapshot && <TransitAlerts snapshot={snapshot} active={live.active} />}
          <View style={styles.row}>
            <TextField
              accessibilityLabel="Fecha de horarios"
              value={date}
              onChange={setDate}
              placeholder="AAAA-MM-DD"
              style={[styles.input, styles.flex]}
            />
            <TextField
              accessibilityLabel="Hora de horarios"
              value={clock}
              onChange={setClock}
              placeholder="HH:MM"
              style={[styles.input, styles.flex]}
            />
          </View>
          <View style={styles.wrap}>
            <Button
              label="Ver horarios"
              onPress={() => {
                try {
                  setFrom(queryInstant(date, clock));
                  setLiveMode(false);
                  setProblem(null);
                } catch (error) {
                  setProblem(message(error));
                }
              }}
            />
            <Button
              label="Ahora"
              variant="ghost"
              onPress={() => {
                const now = Date.now();
                setDate(agencyDate(now));
                setClock(agencyClock(now));
                setFrom(now);
                setLiveMode(true);
                setProblem(null);
              }}
            />
          </View>
          <Text style={styles.note}>
            Desde {agencyDate(from)} {agencyClock(from)}, hora de London. Próximas salidas dentro de
            24 horas.
          </Text>
          {expired && (
            <Text style={styles.error}>
              El horario guardado venció el {schedule.validTo}. Actualiza antes de confiar en el
              servicio.
            </Text>
          )}
          {outsideDate && (
            <Text style={styles.note}>
              La fecha está fuera de vigencia. Solo pueden aparecer viajes que continúan desde un
              día de servicio válido anterior.
            </Text>
          )}
          <TransitDepartures
            schedule={schedule}
            departures={departuresList}
            snapshot={snapshot}
            selected={selectedDetail}
            current={liveMode}
            active={live.active}
            onSelect={setDetail}
          />
          {selectedDetail && (
            <TransitTripDetail
              schedule={schedule}
              departure={selectedDetail}
              snapshot={snapshot}
              active={live.active}
            />
          )}
        </Card>
      )}
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
  stopChip: { minHeight: 44, paddingVertical: 8 },
  detail: { gap: 8, borderTopWidth: 1, borderTopColor: theme.lineSoft, paddingTop: 10 },
  current: { fontFamily: font.black, color: theme.text },
}));
