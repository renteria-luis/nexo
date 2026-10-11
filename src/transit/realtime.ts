import { addDays, isRealDate } from '../core/dates.ts';
import type { CredentialStorage } from '../core/cloud-credentials.ts';
import {
  activeServices,
  agencyDate,
  scheduledTime,
  validCoordinates,
  type Departure,
  type Schedule,
  type Stop,
  type StopTime,
  type Trip,
} from './schedule.ts';
import {
  REALTIME_ALERT_FRESH_MS,
  REALTIME_FRESH_MS,
  REALTIME_MAX_RESPONSE_BYTES,
  REALTIME_SCHEMA,
  type LiveAlert,
  type LiveEvent,
  type LiveIdentity,
  type LiveStopUpdate,
  type LiveTripRef,
  type LiveTripUpdate,
  type LiveVehicle,
  type RealtimeQuery,
  type RealtimeResponse,
} from './realtime-contract.ts';

export type LiveQuery = RealtimeQuery;
export type LiveSnapshot = RealtimeResponse;
export type TransitLiveConfig = { endpoint: string; credential: string };
export const LIVE_LOCAL_MAX_BYTES = REALTIME_MAX_RESPONSE_BYTES + 8_000;
export const LIVE_LOCAL_MAX_AGE_MS = 30 * 60_000;
export const LIVE_MANUAL_MIN_MS = 15_000;
// A new selection needs its own data sooner than a repeated tap does; five seconds still keeps
// rapid taps inside the service's twelve requests a minute.
export const LIVE_CHANGE_MIN_MS = 5_000;
const REFRESH_MS = 45_000;
const FUTURE_ALLOWANCE_MS = 30_000;

function requireValid(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(`Datos en vivo inválidos: ${reason}. Se conserva el horario.`);
}

function object(value: unknown): Record<string, unknown> {
  requireValid(value && typeof value === 'object' && !Array.isArray(value), 'objeto incompleto');
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum = 500, empty = false): value is string {
  return typeof value === 'string' && value.length <= maximum && (empty || value.trim() !== '');
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function timestamp(value: unknown, now: number): value is number | null {
  return value === null || integer(value, 1, now + FUTURE_ALLOWANCE_MS);
}

function nullableId(value: unknown): value is string | null {
  return value === null || text(value);
}

function list(value: unknown, maximum: number): asserts value is unknown[] {
  requireValid(Array.isArray(value) && value.length <= maximum, 'lista ausente o demasiado grande');
}

export function validateTransitLiveConfig(raw: unknown): TransitLiveConfig {
  const value = object(raw);
  requireValid(typeof value.endpoint === 'string' && value.endpoint.length <= 2_048, 'dirección');
  let url: URL;
  try {
    url = new URL(value.endpoint.trim());
  } catch {
    throw new Error('Usa la dirección HTTPS completa de la conexión de Transit.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/api/live' ||
    !url.hostname.includes('.')
  ) {
    throw new Error('Usa una dirección HTTPS que termine en /api/live, sin parámetros.');
  }
  if (
    typeof value.credential !== 'string' ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(value.credential.trim())
  ) {
    throw new Error('La clave de instalación debe tener entre 32 y 128 letras, números, _ o -.');
  }
  return { endpoint: url.href, credential: value.credential.trim() };
}

export function createTransitLiveConfigStore(storage: CredentialStorage) {
  let pending = Promise.resolve();
  const load = async (): Promise<TransitLiveConfig | null> => {
    let raw: string | null;
    try {
      raw = await storage.read();
    } catch {
      throw new Error(
        'No se pudo abrir la conexión de Transit. Desbloquea el teléfono y reintenta.',
      );
    }
    if (raw === null) return null;
    try {
      requireValid(raw.length <= 4_096, 'configuración demasiado grande');
      return validateTransitLiveConfig(JSON.parse(raw));
    } catch {
      throw new Error('La conexión guardada de Transit no se puede leer. Vuelve a configurarla.');
    }
  };
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = pending.then(work);
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  return {
    load,
    save: (next: TransitLiveConfig) =>
      enqueue(async () => {
        const checked = validateTransitLiveConfig(next);
        try {
          await storage.write(JSON.stringify(checked));
        } catch {
          throw new Error('No se pudo guardar la conexión de Transit. Se conserva la anterior.');
        }
        return checked;
      }),
    clear: () =>
      enqueue(async () => {
        try {
          await storage.remove();
        } catch {
          throw new Error('No se pudo borrar la conexión de Transit. Reintenta.');
        }
      }),
  };
}

export function buildLiveQuery(
  schedule: Schedule,
  selection: { stopIds?: string[]; trips?: LiveTripRef[]; routeIds?: string[] },
): LiveQuery {
  const query: LiveQuery = {
    schema: REALTIME_SCHEMA,
    staticVersion: schedule.feedVersion,
    staticSourceSha256: schedule.sourceSha256,
    stopIds: [...new Set(selection.stopIds ?? [])].sort(),
    trips: [...(selection.trips ?? [])].sort((a, b) =>
      `${a.tripId}/${a.serviceDate}`.localeCompare(`${b.tripId}/${b.serviceDate}`),
    ),
    routeIds: [...new Set(selection.routeIds ?? [])].sort(),
  };
  validateLiveQuery(query, schedule);
  return query;
}

export function validateLiveQuery(raw: unknown, schedule: Schedule): LiveQuery {
  const q = object(raw);
  requireValid(
    q.schema === REALTIME_SCHEMA &&
      q.staticVersion === schedule.feedVersion &&
      q.staticSourceSha256 === schedule.sourceSha256,
    'versión de consulta',
  );
  requireValid(
    Object.keys(q).every((k) =>
      ['schema', 'staticVersion', 'staticSourceSha256', 'stopIds', 'trips', 'routeIds'].includes(k),
    ),
    'parámetros desconocidos',
  );
  list(q.stopIds, 8);
  list(q.trips, 4);
  list(q.routeIds, 4);
  requireValid(q.stopIds.length + q.trips.length + q.routeIds.length > 0, 'selección vacía');
  const stopIds = new Set(schedule.stops.map((s) => s[0]));
  const routeIds = new Set(schedule.routes.map((r) => r[0]));
  requireValid(
    q.stopIds.every((id) => typeof id === 'string' && stopIds.has(id)) &&
      new Set(q.stopIds).size === q.stopIds.length,
    'parada desconocida o duplicada',
  );
  requireValid(
    q.routeIds.every((id) => typeof id === 'string' && routeIds.has(id)) &&
      new Set(q.routeIds).size === q.routeIds.length,
    'línea desconocida o duplicada',
  );
  const tripKeys = new Set<string>();
  for (const rawRef of q.trips) {
    const ref = object(rawRef);
    requireValid(
      Object.keys(ref).length === 2 &&
        text(ref.tripId) &&
        typeof ref.serviceDate === 'string' &&
        isRealDate(ref.serviceDate),
      'viaje o fecha',
    );
    const trip = schedule.trips.find((t) => t[0] === ref.tripId);
    requireValid(
      trip && activeServices(schedule, ref.serviceDate).has(trip[2]),
      'viaje sin servicio ese día',
    );
    const key = `${ref.tripId}/${ref.serviceDate}`;
    requireValid(!tripKeys.has(key), 'viaje duplicado');
    tripKeys.add(key);
  }
  return q as unknown as LiveQuery;
}

export function liveQueryKey(query: LiveQuery): string {
  return JSON.stringify([
    query.staticSourceSha256,
    [...query.stopIds].sort(),
    query.trips.map((t) => `${t.tripId}/${t.serviceDate}`).sort(),
    [...query.routeIds].sort(),
  ]);
}

function tripStartTime(schedule: Schedule, trip: Trip): string {
  const seconds = trip[7] + schedule.patterns[trip[6]][0][3];
  return `${String(Math.floor(seconds / 3_600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function identity(raw: unknown, schedule: Schedule, query: LiveQuery, now: number): Trip {
  const value = object(raw);
  requireValid(
    text(value.tripId) &&
      text(value.routeId) &&
      typeof value.serviceDate === 'string' &&
      isRealDate(value.serviceDate),
    'identidad de viaje',
  );
  const trip = schedule.trips.find((t) => t[0] === value.tripId);
  const day = agencyDate(now);
  requireValid(
    value.serviceDate >= addDays(day, -2) && value.serviceDate <= addDays(day, 1),
    'día fuera de la consulta en vivo',
  );
  requireValid(
    trip &&
      schedule.routes[trip[1]][0] === value.routeId &&
      activeServices(schedule, value.serviceDate).has(trip[2]),
    'viaje, línea o día distintos',
  );
  requireValid(
    value.directionId === null ||
      ((value.directionId === 0 || value.directionId === 1) && value.directionId === trip[4]),
    'sentido distinto',
  );
  requireValid(
    value.startTime === null ||
      (typeof value.startTime === 'string' && value.startTime === tripStartTime(schedule, trip)),
    'inicio de viaje distinto',
  );
  const pattern = schedule.patterns[trip[6]];
  requireValid(
    query.trips.some((t) => t.tripId === trip[0] && t.serviceDate === value.serviceDate) ||
      query.routeIds.includes(value.routeId) ||
      pattern.some((t) => query.stopIds.includes(schedule.stops[t[0]][0])),
    'viaje fuera de la selección',
  );
  return trip;
}

function event(raw: unknown, day: string): void {
  if (raw === null) return;
  const value = object(raw);
  const start = scheduledTime(day, 0);
  requireValid(
    value.time === null || integer(value.time, start - 43_200_000, start + 345_600_000),
    'hora de predicción',
  );
  requireValid(value.delay === null || integer(value.delay, -86_400, 86_400), 'demora');
  requireValid(
    value.uncertainty === null || integer(value.uncertainty, 0, 86_400),
    'incertidumbre',
  );
}

export function validateLiveSnapshot(
  raw: unknown,
  schedule: Schedule,
  query: LiveQuery,
  now = Date.now(),
): LiveSnapshot {
  const value = object(raw);
  requireValid(
    value.schema === REALTIME_SCHEMA && integer(value.generatedAt, 1, now + FUTURE_ALLOWANCE_MS),
    'formato o fecha de respuesta',
  );
  requireValid(
    text(value.staticVersion) &&
      typeof value.staticSourceSha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(value.staticSourceSha256) &&
      typeof value.staticCompatible === 'boolean',
    'identidad del horario',
  );
  const compatible =
    value.staticVersion === schedule.feedVersion &&
    value.staticSourceSha256 === schedule.sourceSha256;
  requireValid(value.staticCompatible === compatible, 'compatibilidad incorrecta');
  const health = object(value.health);
  for (const source of ['trips', 'vehicles', 'alerts']) {
    const h = object(health[source]);
    requireValid(
      ['ok', 'stale', 'error'].includes(h.status as string) &&
        timestamp(h.feedTimestamp, now) &&
        timestamp(h.fetchedAt, now) &&
        (h.error === null || text(h.error, 1_000)),
      'estado de fuente',
    );
    requireValid(
      h.status !== 'ok' || (h.feedTimestamp !== null && h.fetchedAt !== null && h.error === null),
      'fuente sin fecha',
    );
  }
  list(value.tripUpdates, 80);
  list(value.vehicles, 120);
  list(value.alerts, 120);
  const issues = object(value.issues);
  requireValid(
    ['unmatchedTrips', 'ambiguousStops', 'invalidEntities'].every((k) =>
      integer(issues[k], 0, 100_000),
    ) && typeof issues.truncated === 'boolean',
    'estado de validación',
  );
  requireValid(
    compatible || value.tripUpdates.length + value.vehicles.length + value.alerts.length === 0,
    'datos con horario incompatible',
  );
  const tripKeys = new Set<string>();
  let updates = 0;
  for (const rawTrip of value.tripUpdates) {
    const update = object(rawTrip);
    const trip = identity(update, schedule, query, now);
    requireValid(
      text(update.entityId) &&
        nullableId(update.vehicleId) &&
        timestamp(update.measuredAt, now) &&
        ['scheduled', 'canceled', 'unsupported'].includes(update.relationship as string) &&
        (update.delay === null || integer(update.delay, -86_400, 86_400)),
      'medición del viaje',
    );
    const key = `${update.tripId}/${update.serviceDate}`;
    requireValid(!tripKeys.has(key), 'viaje ambiguo');
    tripKeys.add(key);
    list(update.stops, 1_000);
    updates += update.stops.length;
    requireValid(updates <= 4_000, 'demasiadas predicciones');
    const sequences = new Set<number>();
    for (const rawStop of update.stops) {
      const stop = object(rawStop);
      requireValid(
        text(stop.stopId) &&
          integer(stop.stopSequence, 0, 100_000) &&
          !sequences.has(stop.stopSequence),
        'parada ambigua',
      );
      sequences.add(stop.stopSequence);
      requireValid(
        schedule.patterns[trip[6]].some(
          (t) => t[1] === stop.stopSequence && schedule.stops[t[0]][0] === stop.stopId,
        ),
        'orden o parada distintos',
      );
      requireValid(
        ['scheduled', 'skipped', 'no_data', 'unsupported'].includes(stop.relationship as string),
        'estado de parada',
      );
      event(stop.arrival, update.serviceDate as string);
      event(stop.departure, update.serviceDate as string);
    }
  }
  const vehicleIds = new Set<string>();
  for (const rawVehicle of value.vehicles) {
    const vehicle = object(rawVehicle);
    const trip = identity(vehicle, schedule, query, now);
    requireValid(
      text(vehicle.entityId) &&
        !vehicleIds.has(vehicle.entityId) &&
        nullableId(vehicle.vehicleId) &&
        timestamp(vehicle.measuredAt, now),
      'identidad o fecha del vehículo',
    );
    vehicleIds.add(vehicle.entityId);
    requireValid(
      nullableId(vehicle.stopId) &&
        (vehicle.stopSequence === null || integer(vehicle.stopSequence, 0, 100_000)) &&
        (vehicle.status === null ||
          ['incoming', 'stopped', 'in_transit'].includes(vehicle.status as string)),
      'estado del vehículo',
    );
    if (vehicle.stopId !== null || vehicle.stopSequence !== null) {
      requireValid(
        schedule.patterns[trip[6]].some(
          (t) =>
            (vehicle.stopId === null || schedule.stops[t[0]][0] === vehicle.stopId) &&
            (vehicle.stopSequence === null || t[1] === vehicle.stopSequence),
        ),
        'parada del vehículo',
      );
    }
    if (vehicle.position !== null) {
      const p = object(vehicle.position);
      requireValid(
        typeof p.lat === 'number' &&
          typeof p.lng === 'number' &&
          validCoordinates({ lat: p.lat, lng: p.lng }) &&
          (p.bearing === null ||
            (typeof p.bearing === 'number' &&
              Number.isFinite(p.bearing) &&
              p.bearing >= 0 &&
              p.bearing < 360)) &&
          (p.speed === null ||
            (typeof p.speed === 'number' &&
              Number.isFinite(p.speed) &&
              p.speed >= 0 &&
              p.speed <= 100)),
        'posición del vehículo',
      );
    }
  }
  const alertIds = new Set<string>();
  for (const rawAlert of value.alerts) {
    const alert = object(rawAlert);
    requireValid(
      text(alert.id) &&
        !alertIds.has(alert.id) &&
        text(alert.header, 5_000, true) &&
        text(alert.description, 15_000, true) &&
        (alert.cause === null || integer(alert.cause, 0, 100)) &&
        (alert.effect === null || integer(alert.effect, 0, 100)),
      'alerta',
    );
    alertIds.add(alert.id);
    requireValid(
      alert.url === null || (text(alert.url, 2_048) && /^https?:\/\//.test(alert.url)),
      'enlace de alerta',
    );
    list(alert.activePeriods, 30);
    for (const rawPeriod of alert.activePeriods) {
      const period = object(rawPeriod);
      requireValid(
        (period.start === null || integer(period.start, 1, 253_402_300_799_000)) &&
          (period.end === null || integer(period.end, 1, 253_402_300_799_000)) &&
          (period.start === null ||
            period.end === null ||
            (period.start as number) <= (period.end as number)),
        'vigencia de alerta',
      );
    }
    list(alert.selectors, 100);
    for (const rawSelector of alert.selectors) {
      const s = object(rawSelector);
      requireValid(
        nullableId(s.routeId) &&
          nullableId(s.stopId) &&
          nullableId(s.tripId) &&
          (s.serviceDate === null ||
            (typeof s.serviceDate === 'string' && isRealDate(s.serviceDate))) &&
          (s.directionId === null || s.directionId === 0 || s.directionId === 1),
        'alcance de alerta',
      );
    }
  }
  return value as unknown as LiveSnapshot;
}

export function liveFreshness(
  snapshot: LiveSnapshot,
  source: 'trips' | 'vehicles' | 'alerts',
  measuredAt: number | null,
  now = Date.now(),
): boolean {
  const health = snapshot.health[source];
  const maximumAge = source === 'alerts' ? REALTIME_ALERT_FRESH_MS : REALTIME_FRESH_MS;
  // LTC rewrites its alert file only when an alert changes, so that time says nothing about whether
  // the alerts are current; the service confirms them on every read instead.
  const times =
    source === 'alerts'
      ? [snapshot.generatedAt, measuredAt]
      : [snapshot.generatedAt, health.feedTimestamp, measuredAt];
  return (
    snapshot.staticCompatible &&
    health.status === 'ok' &&
    health.feedTimestamp !== null &&
    measuredAt !== null &&
    times.every((at) => at !== null && at <= now + FUTURE_ALLOWANCE_MS && now - at <= maximumAge)
  );
}

function sameTrip(value: LiveIdentity, departure: Departure, schedule: Schedule): boolean {
  return (
    value.tripId === departure.trip[0] &&
    value.serviceDate === departure.serviceDate &&
    value.routeId === departure.route[0] &&
    (value.directionId === null || value.directionId === departure.trip[4]) &&
    (value.startTime === null || value.startTime === tripStartTime(schedule, departure.trip))
  );
}

function usableSnapshot(
  snapshot: LiveSnapshot | null,
  schedule: Schedule,
  now: number,
): snapshot is LiveSnapshot {
  return (
    snapshot !== null &&
    snapshot.staticCompatible &&
    snapshot.staticVersion === schedule.feedVersion &&
    snapshot.staticSourceSha256 === schedule.sourceSha256 &&
    snapshot.generatedAt >= now - LIVE_LOCAL_MAX_AGE_MS
  );
}

function preserveFailedSources(
  previous: LiveSnapshot | null,
  incoming: LiveSnapshot,
  schedule: Schedule,
  now: number,
): LiveSnapshot {
  if (!usableSnapshot(previous, schedule, now)) return incoming;
  const result = { ...incoming, health: { ...incoming.health } };
  for (const source of ['trips', 'vehicles', 'alerts'] as const) {
    if (incoming.health[source].status !== 'error') continue;
    result.health[source] = {
      ...previous.health[source],
      status: 'stale',
      error: incoming.health[source].error,
    };
    if (source === 'trips') result.tripUpdates = previous.tripUpdates;
    else if (source === 'vehicles') result.vehicles = previous.vehicles;
    else result.alerts = previous.alerts;
  }
  return result;
}

export type LiveDeparture = {
  at: number;
  source: 'official' | 'schedule' | 'last-known';
  status:
    | 'live'
    | 'schedule'
    | 'unassigned'
    | 'stale'
    | 'canceled'
    | 'skipped'
    | 'no-data'
    | 'unsupported';
  measuredAt: number | null;
  reportedAt: number | null;
  uncertainty: number | null;
  eventKind: 'arrival' | 'departure' | 'schedule';
  relationship: LiveTripUpdate['relationship'] | LiveStopUpdate['relationship'] | null;
};

function prediction(event: LiveEvent | null, scheduled: number): number | null {
  if (!event) return null;
  return event.time ?? (event.delay === null ? null : scheduled + event.delay * 1_000);
}

function stopDeparture(
  update: LiveTripUpdate | undefined,
  stop: LiveStopUpdate | undefined,
  scheduled: number,
  fresh: boolean,
  scheduledArrival = scheduled,
  reportedAt: number | null = null,
  controlFresh = fresh,
): LiveDeparture {
  const fallback: LiveDeparture = {
    at: scheduled,
    source: 'schedule',
    status: 'schedule',
    measuredAt: update?.measuredAt ?? null,
    reportedAt: update?.measuredAt ?? null,
    uncertainty: null,
    eventKind: 'schedule',
    relationship: null,
  };
  if (!update) return fallback;
  const relationship =
    update.relationship !== 'scheduled' ? update.relationship : (stop?.relationship ?? null);
  if (relationship !== null && relationship !== 'scheduled') {
    const status = relationship === 'no_data' ? 'no-data' : relationship;
    const knownFact = relationship === 'canceled' || relationship === 'skipped';
    const factFresh = knownFact ? controlFresh : fresh;
    return {
      ...fallback,
      source: factFresh ? 'schedule' : 'last-known',
      status: factFresh ? status : 'stale',
      reportedAt: knownFact ? (update.measuredAt ?? reportedAt) : update.measuredAt,
      relationship,
    };
  }
  const departurePrediction = prediction(stop?.departure ?? null, scheduled);
  const arrivalPrediction = prediction(stop?.arrival ?? null, scheduledArrival);
  const at = departurePrediction ?? arrivalPrediction;
  if (at === null) return { ...fallback, status: 'no-data' };
  const event = departurePrediction !== null ? stop?.departure : stop?.arrival;
  // LTC also lists trips no bus is running yet, with the timetable time and no delay: that is the
  // schedule restated, not a live prediction.
  if (
    update.vehicleId === null &&
    event?.delay === null &&
    at === (departurePrediction !== null ? scheduled : scheduledArrival)
  )
    return { ...fallback, status: fresh ? 'unassigned' : 'schedule' };
  return {
    at,
    source: fresh ? 'official' : 'last-known',
    status: fresh ? 'live' : 'stale',
    measuredAt: update.measuredAt,
    reportedAt: update.measuredAt,
    uncertainty:
      departurePrediction !== null
        ? (stop?.departure?.uncertainty ?? null)
        : (stop?.arrival?.uncertainty ?? null),
    eventKind: departurePrediction !== null ? 'departure' : 'arrival',
    relationship,
  };
}

export function mergeLiveDeparture(
  schedule: Schedule,
  departure: Departure,
  snapshot: LiveSnapshot | null,
  now = Date.now(),
): LiveDeparture {
  const update = usableSnapshot(snapshot, schedule, now)
    ? snapshot.tripUpdates.find((t) => sameTrip(t, departure, schedule))
    : undefined;
  const stop = update?.stops.find(
    (s) =>
      s.stopSequence === departure.stopTime[1] &&
      s.stopId === schedule.stops[departure.stopTime[0]][0],
  );
  return stopDeparture(
    update,
    stop,
    departure.at,
    !!snapshot && liveFreshness(snapshot, 'trips', update?.measuredAt ?? null, now),
    scheduledTime(departure.serviceDate, departure.trip[7] + departure.stopTime[2]),
    snapshot?.health.trips.feedTimestamp ?? null,
    !!snapshot &&
      liveFreshness(
        snapshot,
        'trips',
        update?.measuredAt ?? snapshot.health.trips.feedTimestamp,
        now,
      ),
  );
}

export function relevantLiveAlerts(
  schedule: Schedule,
  departure: Departure,
  snapshot: LiveSnapshot | null,
  now = Date.now(),
  stopId: string | null = schedule.stops[departure.stopTime[0]][0],
): LiveAlert[] {
  if (!usableSnapshot(snapshot, schedule, now)) return [];
  return snapshot.alerts.filter(
    (alert) =>
      (alert.activePeriods.length === 0 ||
        alert.activePeriods.some(
          (p) => (p.start === null || p.start <= now) && (p.end === null || p.end > now),
        )) &&
      (alert.selectors.length === 0 ||
        alert.selectors.some(
          (s) =>
            (s.routeId === null || s.routeId === departure.route[0]) &&
            (s.stopId === null ||
              (stopId === null
                ? schedule.patterns[departure.trip[6]].some(
                    (t) => schedule.stops[t[0]][0] === s.stopId,
                  )
                : s.stopId === stopId)) &&
            (s.tripId === null || s.tripId === departure.trip[0]) &&
            (s.serviceDate === null || s.serviceDate === departure.serviceDate) &&
            (s.directionId === null || s.directionId === departure.trip[4]),
        )),
  );
}

export type LiveDetailStop = LiveDeparture & {
  stop: Stop;
  stopTime: StopTime;
  arrivalAt: number;
  departureAt: number;
  arrivalSource: LiveDeparture['source'];
  departureSource: LiveDeparture['source'];
  progress: 'previous' | 'current' | 'upcoming' | 'unknown';
};

export function tripLiveDetail(
  schedule: Schedule,
  departure: Departure,
  snapshot: LiveSnapshot | null,
  now = Date.now(),
): {
  stops: LiveDetailStop[];
  vehicles: LiveVehicle[];
  alerts: LiveAlert[];
  update: LiveTripUpdate | null;
} {
  const usable = usableSnapshot(snapshot, schedule, now);
  const update = usable
    ? snapshot.tripUpdates.find((t) => sameTrip(t, departure, schedule))
    : undefined;
  const vehicles = usable ? snapshot.vehicles.filter((v) => sameTrip(v, departure, schedule)) : [];
  const current = snapshot
    ? vehicles.find(
        (v) => v.stopSequence !== null && liveFreshness(snapshot, 'vehicles', v.measuredAt, now),
      )
    : undefined;
  const stops = schedule.patterns[departure.trip[6]].map((stopTime) => {
    const scheduledArrival = scheduledTime(departure.serviceDate, departure.trip[7] + stopTime[2]);
    const scheduledDeparture = scheduledTime(
      departure.serviceDate,
      departure.trip[7] + stopTime[3],
    );
    const stop = update?.stops.find(
      (s) => s.stopSequence === stopTime[1] && s.stopId === schedule.stops[stopTime[0]][0],
    );
    const fresh = !!snapshot && liveFreshness(snapshot, 'trips', update?.measuredAt ?? null, now);
    const merged = stopDeparture(
      update,
      stop,
      scheduledDeparture,
      fresh,
      scheduledArrival,
      snapshot?.health.trips.feedTimestamp ?? null,
      !!snapshot &&
        liveFreshness(
          snapshot,
          'trips',
          update?.measuredAt ?? snapshot.health.trips.feedTimestamp,
          now,
        ),
    );
    const applicable = update?.relationship === 'scheduled' && stop?.relationship === 'scheduled';
    const arrival = applicable ? prediction(stop.arrival, scheduledArrival) : null;
    const departurePrediction = applicable ? prediction(stop.departure, scheduledDeparture) : null;
    return {
      ...merged,
      stop: schedule.stops[stopTime[0]],
      stopTime,
      arrivalAt: arrival ?? scheduledArrival,
      departureAt: departurePrediction ?? scheduledDeparture,
      arrivalSource:
        arrival === null
          ? ('schedule' as const)
          : fresh
            ? ('official' as const)
            : ('last-known' as const),
      departureSource:
        departurePrediction === null
          ? ('schedule' as const)
          : fresh
            ? ('official' as const)
            : ('last-known' as const),
      progress:
        current?.stopSequence == null
          ? ('unknown' as const)
          : stopTime[1] < current.stopSequence
            ? ('previous' as const)
            : stopTime[1] === current.stopSequence
              ? ('current' as const)
              : ('upcoming' as const),
    };
  });
  return {
    stops,
    vehicles,
    alerts: relevantLiveAlerts(schedule, departure, snapshot, now, null),
    update: update ?? null,
  };
}

export type LiveCacheStorage = {
  read: () => Promise<string | null>;
  write: (content: string) => Promise<void>;
  remove: () => Promise<void>;
};
export type TransitLiveState = {
  query: LiveQuery | null;
  snapshot: LiveSnapshot | null;
  loading: boolean;
  reason: string | null;
  nextRefreshAt: number | null;
  lastSuccessAt: number | null;
};
export type LiveClientOptions = {
  schedule: Schedule;
  config: TransitLiveConfig | null;
  onState: (state: TransitLiveState) => void;
  fetcher?: typeof fetch;
  cache?: LiveCacheStorage;
  now?: () => number;
  timeoutMs?: number;
};

async function boundedJson(
  response: Response,
  signal: AbortSignal,
  credential: string,
): Promise<unknown> {
  requireValid(
    Number(response.headers.get('content-length')) <= REALTIME_MAX_RESPONSE_BYTES,
    'respuesta demasiado grande',
  );
  let bytes: Uint8Array;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const cancel = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (signal.aborted) throw new Error('Consulta en vivo cancelada.');
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > REALTIME_MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error('La respuesta en vivo supera el tamaño permitido.');
        }
        chunks.push(chunk.value);
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
    bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    const buffer = await response.arrayBuffer();
    requireValid(buffer.byteLength <= REALTIME_MAX_RESPONSE_BYTES, 'respuesta demasiado grande');
    bytes = new Uint8Array(buffer);
  }
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (content.includes(credential)) throw new Error('credential reflection');
    return JSON.parse(content);
  } catch {
    throw new Error('No se pudo verificar la respuesta en vivo. Se conserva el horario.');
  }
}

export async function fetchLiveSnapshot(
  config: TransitLiveConfig,
  schedule: Schedule,
  query: LiveQuery,
  options: {
    signal?: AbortSignal;
    fetcher?: typeof fetch;
    now?: () => number;
    timeoutMs?: number;
  } = {},
): Promise<LiveSnapshot> {
  const checked = validateTransitLiveConfig(config);
  validateLiveQuery(query, schedule);
  const controller = new AbortController();
  let rejectDeadline: (error: Error) => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
  });
  const cancel = () => {
    controller.abort();
    rejectDeadline(new Error('Consulta en vivo cancelada.'));
  };
  if (options.signal?.aborted) throw new Error('Consulta en vivo cancelada.');
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    controller.abort();
    rejectDeadline(new Error('La conexión en vivo tardó demasiado. Se conserva el horario.'));
  }, options.timeoutMs ?? 12_000);
  try {
    return await Promise.race([
      (async () => {
        let response: Response;
        try {
          response = await (options.fetcher ?? fetch)(checked.endpoint, {
            method: 'POST',
            redirect: 'error',
            headers: {
              Authorization: `Bearer ${checked.credential}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(query),
            signal: controller.signal,
          });
        } catch {
          throw new Error(
            controller.signal.aborted
              ? 'Consulta en vivo cancelada.'
              : 'No hay conexión en vivo. Revisa internet. Se conserva el horario.',
          );
        }
        if (response.url && response.url !== checked.endpoint)
          throw new Error('La conexión en vivo cambió de dirección. Revisa la configuración.');
        if (response.status === 401 || response.status === 403)
          throw new Error(
            'La clave de instalación de Transit no fue aceptada. Revisa la conexión.',
          );
        if (response.status === 429 || response.status === 503)
          throw new Error(
            'La conexión en vivo está pausada o alcanzó su límite. Se conserva el horario.',
          );
        if (!response.ok)
          throw new Error(
            `No hay datos en vivo ahora (HTTP ${response.status}). Se conserva el horario.`,
          );
        const snapshot = validateLiveSnapshot(
          await boundedJson(response, controller.signal, checked.credential),
          schedule,
          query,
          (options.now ?? Date.now)(),
        );
        if (!snapshot.staticCompatible)
          throw new Error(
            'El servicio en vivo usa otra versión de horarios. Toca Actualizar en Horario guardado; si ya está al día, el servicio se pone al día en unos minutos.',
          );
        return snapshot;
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export function createLiveClient(options: LiveClientOptions) {
  const now = options.now ?? Date.now;
  let state: TransitLiveState = {
    query: null,
    snapshot: null,
    loading: false,
    reason: options.config
      ? null
      : 'Configura la conexión de Transit para consultar datos en vivo.',
    nextRefreshAt: null,
    lastSuccessAt: null,
  };
  let foreground = false;
  let disposed = false;
  let generation = 0;
  let departureAt: number | undefined;
  let request: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastAttempt = -Infinity;
  let attemptedKey: string | null = null;
  let failures = 0;
  let retryAfter = 0;
  const emit = (changes: Partial<TransitLiveState>) => {
    if (disposed) return;
    state = { ...state, ...changes };
    options.onState(state);
  };
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const useful = () => foreground && !!state.query && !!options.config && !disposed;
  const near = () =>
    departureAt === undefined ||
    (departureAt >= now() - 10 * 60_000 && departureAt <= now() + 30 * 60_000);
  const schedule = (at: number, initialRead = false) => {
    clearTimer();
    if (!useful() || (!near() && !initialRead)) {
      emit({ nextRefreshAt: null });
      return;
    }
    emit({ nextRefreshAt: at });
    timer = setTimeout(
      () => {
        timer = null;
        void refresh();
      },
      Math.max(0, at - now()),
    );
  };
  const refresh = async (): Promise<void> => {
    if (!useful() || request) return;
    const key = liveQueryKey(state.query!);
    const allowedAt = Math.max(
      lastAttempt + (key === attemptedKey ? LIVE_MANUAL_MIN_MS : LIVE_CHANGE_MIN_MS),
      retryAfter,
    );
    if (now() < allowedAt) {
      schedule(allowedAt, true);
      return;
    }
    clearTimer();
    const query = state.query!;
    const token = generation;
    const controller = new AbortController();
    request = controller;
    lastAttempt = now();
    attemptedKey = key;
    emit({ loading: true, reason: null, nextRefreshAt: null });
    try {
      const received = await fetchLiveSnapshot(options.config!, options.schedule, query, {
        signal: controller.signal,
        fetcher: options.fetcher,
        now,
        timeoutMs: options.timeoutMs,
      });
      if (token !== generation || controller.signal.aborted || !useful()) return;
      const snapshot = preserveFailedSources(state.snapshot, received, options.schedule, now());
      const sourceFailure = Object.values(snapshot.health).some((h) => h.status !== 'ok');
      failures = sourceFailure ? failures + 1 : 0;
      retryAfter = sourceFailure
        ? now() + Math.min(5 * 60_000, REFRESH_MS * 2 ** Math.min(failures - 1, 4))
        : 0;
      emit({
        snapshot,
        lastSuccessAt: now(),
        reason: sourceFailure
          ? 'Parte de la información en vivo no está disponible o es antigua. Se conserva el horario.'
          : null,
      });
      if (options.cache) {
        const content = JSON.stringify({ schema: 1, query, snapshot, storedAt: now() });
        if (new TextEncoder().encode(content).byteLength <= LIVE_LOCAL_MAX_BYTES) {
          try {
            await options.cache.write(content);
          } catch {
            if (token === generation)
              emit({
                reason:
                  'Llegaron datos en vivo, pero no se pudo guardar la última lectura en este teléfono.',
              });
          }
        }
      }
    } catch (error) {
      if (token !== generation || controller.signal.aborted || !useful()) return;
      failures += 1;
      retryAfter = now() + Math.min(5 * 60_000, REFRESH_MS * 2 ** Math.min(failures - 1, 4));
      emit({
        snapshot: usableSnapshot(state.snapshot, options.schedule, now()) ? state.snapshot : null,
        reason:
          error instanceof Error ? error.message : 'Sin datos en vivo. Se conserva el horario.',
      });
    } finally {
      if (request === controller) request = null;
      if (token === generation && !disposed) {
        emit({ loading: false });
        schedule(Math.max(lastAttempt + REFRESH_MS, retryAfter));
      }
    }
  };
  const readCache = async (query: LiveQuery, token: number) => {
    if (!options.cache) return;
    try {
      const content = await options.cache.read();
      if (content === null || token !== generation || state.snapshot) return;
      requireValid(
        new TextEncoder().encode(content).byteLength <= LIVE_LOCAL_MAX_BYTES,
        'caché demasiado grande',
      );
      const value = object(JSON.parse(content));
      requireValid(
        value.schema === 1 &&
          integer(value.storedAt, now() - LIVE_LOCAL_MAX_AGE_MS, now() + FUTURE_ALLOWANCE_MS),
        'lectura local vencida',
      );
      const cachedQuery = validateLiveQuery(value.query, options.schedule);
      if (liveQueryKey(query) !== liveQueryKey(cachedQuery)) return;
      const snapshot = validateLiveSnapshot(value.snapshot, options.schedule, query, now());
      requireValid(
        snapshot.staticCompatible && snapshot.generatedAt >= now() - LIVE_LOCAL_MAX_AGE_MS,
        'lectura antigua',
      );
      if (token === generation && !state.snapshot)
        emit({
          snapshot,
          lastSuccessAt: value.storedAt,
          reason:
            state.reason ?? 'Última lectura guardada. Las edades conservan la hora de la fuente.',
        });
    } catch (error) {
      if (token === generation && !state.snapshot)
        emit({
          reason:
            error instanceof Error
              ? error.message
              : 'No se pudo leer la última información en vivo. Se conserva el horario.',
        });
    }
  };
  return {
    getState: () => state,
    setQuery: (query: LiveQuery | null, selection: { departureAt?: number } = {}) => {
      if (disposed) return;
      if (query) validateLiveQuery(query, options.schedule);
      departureAt = selection.departureAt;
      if (
        (query ? liveQueryKey(query) : null) === (state.query ? liveQueryKey(state.query) : null)
      ) {
        if (useful()) schedule(Math.max(lastAttempt + REFRESH_MS, retryAfter));
        return;
      }
      generation += 1;
      request?.abort();
      request = null;
      clearTimer();
      // Opening or closing a departure keeps the stop, so its live data stays on screen until the
      // trip's own arrives.
      const sameStop =
        !!query && !!state.query && query.stopIds.join() === state.query.stopIds.join();
      emit({
        query,
        snapshot: sameStop ? state.snapshot : null,
        lastSuccessAt: sameStop ? state.lastSuccessAt : null,
        loading: false,
        nextRefreshAt: null,
        reason: options.config ? null : state.reason,
      });
      if (query) {
        void readCache(query, generation);
        void refresh();
      }
    },
    setForeground: (active: boolean) => {
      if (disposed || foreground === active) return;
      foreground = active;
      if (!active) {
        generation += 1;
        request?.abort();
        request = null;
        clearTimer();
        emit({ loading: false, nextRefreshAt: null });
      } else void refresh();
    },
    refresh,
    dispose: () => {
      disposed = true;
      generation += 1;
      request?.abort();
      request = null;
      clearTimer();
    },
  };
}
