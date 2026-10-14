import { addDays, isRealDate } from '../core/dates.ts';
import type { CredentialStorage } from '../core/cloud-credentials.ts';
import type { Coordinates } from '../core/geo.ts';
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
export type LiveSnapshot = RealtimeResponse & {
  /** What the reading asked for: it says nothing about the other stops of a trip it did not follow. */
  coverage?: { stopIds: string[]; trips: LiveTripRef[] };
  /** Followed buses a newer reading left out, kept with their own report times, never as current. */
  retainedVehicles?: LiveVehicle[];
};
export type TransitLiveConfig = { endpoint: string; credential: string };
export const LIVE_LOCAL_MAX_BYTES = REALTIME_MAX_RESPONSE_BYTES + 8_000;
export const LIVE_LOCAL_MAX_AGE_MS = 30 * 60_000;
export const LIVE_MANUAL_MIN_MS = 15_000;
// A new selection needs its own data sooner than a repeated tap does; five seconds still keeps
// rapid taps inside the service's twelve requests a minute.
export const LIVE_CHANGE_MIN_MS = 5_000;
const REFRESH_MS = 45_000;
// Following a trip stays useful this long after its timetable end, the room LTC's delays usually
// need; later, a read still happens on returning to the screen or on a tap.
const FOLLOW_AFTER_END_MS = 15 * 60_000;
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
    includeReportedTrips: true,
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
      [
        'schema',
        'includeReportedTrips',
        'staticVersion',
        'staticSourceSha256',
        'stopIds',
        'trips',
        'routeIds',
      ].includes(k),
    ),
    'parámetros desconocidos',
  );
  requireValid(
    q.includeReportedTrips === undefined || q.includeReportedTrips === true,
    'capacidad de consulta',
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
    requireValid(trip, 'viaje desconocido');
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
    query.includeReportedTrips === true,
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
      (activeServices(schedule, value.serviceDate).has(trip[2]) ||
        (value.calendarException === true &&
          value.serviceDate >= schedule.validFrom &&
          value.serviceDate <= schedule.validTo &&
          value.startTime === tripStartTime(schedule, trip) &&
          text(value.vehicleId) &&
          typeof value.measuredAt === 'number')),
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
  const reported = source === 'alerts' ? [measuredAt] : [health.feedTimestamp, measuredAt];
  // LTC writes every 30 s, the service may reuse its copy for 30 s and the phone reads every 45 s,
  // so a report two minutes old can be the newest there is. It counts as current while it was
  // under the limit when read and that reading is under the limit itself; judging it by its age
  // alone flipped buses to old reports every cycle with nothing wrong.
  return (
    snapshot.staticCompatible &&
    health.status === 'ok' &&
    health.feedTimestamp !== null &&
    measuredAt !== null &&
    snapshot.generatedAt <= now + FUTURE_ALLOWANCE_MS &&
    now - snapshot.generatedAt <= maximumAge &&
    reported.every(
      (at) =>
        at !== null && at <= now + FUTURE_ALLOWANCE_MS && snapshot.generatedAt - at <= maximumAge,
    )
  );
}

/** Actual reported trips only: a holiday report never activates its whole weekday/weekend service. */
export function observedServiceTrips(
  schedule: Schedule,
  snapshot: LiveSnapshot | null,
  now: number,
): LiveTripRef[] {
  if (
    !snapshot ||
    !snapshot.staticCompatible ||
    snapshot.staticSourceSha256 !== schedule.sourceSha256
  )
    return [];
  const observed = new Map<string, LiveTripRef>();
  for (const source of ['trips', 'vehicles'] as const) {
    const reports = source === 'trips' ? snapshot.tripUpdates : snapshot.vehicles;
    for (const report of reports) {
      if (
        !report.calendarException ||
        !report.vehicleId ||
        !liveFreshness(snapshot, source, report.measuredAt, now)
      )
        continue;
      if ('relationship' in report && report.relationship !== 'scheduled') continue;
      observed.set(`${report.tripId}/${report.serviceDate}`, {
        tripId: report.tripId,
        serviceDate: report.serviceDate,
      });
    }
  }
  return [...observed.values()].sort(
    (a, b) => a.tripId.localeCompare(b.tripId) || a.serviceDate.localeCompare(b.serviceDate),
  );
}

/** Whether a reading asked about this stop of this trip, so a missing prediction means LTC sent none. */
function asked(snapshot: LiveSnapshot, departure: Departure, stopId: string): boolean {
  const coverage = snapshot.coverage;
  return (
    !coverage ||
    coverage.stopIds.includes(stopId) ||
    coverage.trips.some(
      (t) => t.tripId === departure.trip[0] && t.serviceDate === departure.serviceDate,
    )
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
    snapshot.generatedAt >= now - LIVE_LOCAL_MAX_AGE_MS &&
    // A reading from ahead of the phone's clock says the clock is wrong, not where buses are.
    snapshot.generatedAt <= now + FUTURE_ALLOWANCE_MS
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

// A followed bus that a new reading leaves out keeps its last report, with its own time, for
// five minutes, and never counts as current. Not when the new reading cancels its trip, names
// another bus for it, or reports this bus on another trip: those say it is no longer this one.
function retainFollowed(
  previous: LiveSnapshot | null,
  incoming: LiveSnapshot,
  query: LiveQuery,
  schedule: Schedule,
  now: number,
): LiveVehicle[] {
  if (!usableSnapshot(previous, schedule, now)) return [];
  const kept = new Map<string, LiveVehicle>();
  for (const vehicle of [...previous.vehicles, ...(previous.retainedVehicles ?? [])]) {
    const trip = (v: { tripId: string; serviceDate: string }) =>
      v.tripId === vehicle.tripId && v.serviceDate === vehicle.serviceDate;
    if (
      vehicle.position !== null &&
      vehicle.measuredAt !== null &&
      now - vehicle.measuredAt <= LAST_REPORT_MS &&
      query.trips.some(trip) &&
      !incoming.vehicles.some(
        (v) => trip(v) || (vehicle.vehicleId !== null && v.vehicleId === vehicle.vehicleId),
      ) &&
      !incoming.tripUpdates.some(
        (u) =>
          trip(u) &&
          (u.relationship === 'canceled' ||
            (u.vehicleId !== null && u.vehicleId !== vehicle.vehicleId)),
      )
    )
      kept.set(`${vehicle.tripId}/${vehicle.serviceDate}/${vehicle.entityId}`, vehicle);
  }
  return [...kept.values()];
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
  askedStop = true,
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
  if (!askedStop) return fallback;
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
  const stopId = schedule.stops[departure.stopTime[0]][0];
  const stop = update?.stops.find(
    (s) => s.stopSequence === departure.stopTime[1] && s.stopId === stopId,
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
    !snapshot || asked(snapshot, departure, stopId),
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
  scheduledAt: number;
  arrivalAt: number;
  departureAt: number;
  arrivalSource: LiveDeparture['source'];
  departureSource: LiveDeparture['source'];
  progress: 'passed' | 'next' | 'upcoming' | 'unknown';
};

/**
 * The followed bus: where its line card and the map draw it, and what says so. Its GPS report
 * while that is current; its last report, with its age, once it is not; or, without a current
 * report, an estimate from LTC's predictions and the clock that never passes the next stop and
 * ends with the predictions. `along` is missing when the report cannot place it on the trip.
 */
export type FollowedBus = {
  placedBy: 'gps' | 'last-gps' | 'estimate';
  /** The last stop it has passed, as an index into the trip's stops, and how far it is towards the next one. */
  along: { after: number; fraction: number } | null;
  /** Off the trip by more than 400 m, on it but not where LTC's predictions put it, or still on the trip before this one. */
  why: 'off-trip' | 'disagrees' | 'other-trip' | null;
  /** Where the map draws it: the reported position, or the estimate on the trip's path. */
  point: Coordinates;
  /** The report it comes from; for an estimate, the last one if there was any. */
  vehicle: LiveVehicle | null;
};

// A reported position further than this from every segment of the trip is not on it (a
// detour, or a bus still on another trip), so it cannot say how far along the trip it is.
const OFF_TRIP_M = 400;
// A followed bus's last report stays on screen, with its age, this long after it was measured.
export const LAST_REPORT_MS = 5 * 60_000;

// LTC drops from a trip update the stops its bus has passed, so the first stop still predicted
// ahead of now is the one it is heading to. Its vehicle feed's own stop number runs one to
// seventeen stops ahead of the bus and is not used. LTC can also leave a passed stop behind with
// a time near now (a route 7 trip on 2026-10-12, 22 stops back): the next predicted stop then
// comes sooner than a bus could cover a quarter of the timetable between them, so it is skipped.
function nextStopIndex(
  schedule: Schedule,
  departure: Departure,
  update: LiveTripUpdate,
  now: number,
): number {
  const pattern = schedule.patterns[departure.trip[6]];
  const times = pattern.map((stopTime) => {
    const stop = update.stops.find((s) => s.stopSequence === stopTime[1]);
    if (!stop || stop.relationship !== 'scheduled') return null;
    return (
      prediction(
        stop.departure,
        scheduledTime(departure.serviceDate, departure.trip[7] + stopTime[3]),
      ) ??
      prediction(
        stop.arrival,
        scheduledTime(departure.serviceDate, departure.trip[7] + stopTime[2]),
      )
    );
  });
  for (let i = 0; i < pattern.length; i++) {
    const at = times[i];
    if (at === null || at < now - 30_000) continue;
    let j = i + 1;
    while (j < pattern.length && times[j] === null) j++;
    if (
      j > i + 1 &&
      j < pattern.length &&
      times[j]! - at < ((pattern[j][2] - pattern[i][3]) * 1_000) / 4
    )
      continue;
    return i;
  }
  return pattern.length;
}

// The segment between two consecutive stops of the trip closest to a reported position, and how
// far along it the position falls. `near` keeps the search around the stop the predictions point
// at, so a route that returns along the same street cannot land on the other leg. Without it, the
// candidates within reach are told apart by the timetable: each costs its distance plus 5 m for
// every minute between its timetable time and now.
function alongStops(
  schedule: Schedule,
  departure: Departure,
  position: Coordinates,
  near: number | null,
  now: number,
): { after: number; fraction: number; distance: number } | null {
  const pattern = schedule.patterns[departure.trip[6]];
  if (pattern.length < 2) return null;
  const metres = (stop: Stop) => ({
    x: (stop[4] - position.lng) * 111_320 * Math.cos((position.lat * Math.PI) / 180),
    y: (stop[3] - position.lat) * 110_540,
  });
  const first = near === null ? 0 : Math.max(0, near - 3);
  const last = near === null ? pattern.length - 2 : Math.min(pattern.length - 2, near);
  let best: { after: number; fraction: number; distance: number; cost: number } | null = null;
  for (let k = first; k <= last; k++) {
    const a = metres(schedule.stops[pattern[k][0]]);
    const b = metres(schedule.stops[pattern[k + 1][0]]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const fraction = length === 0 ? 0 : Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / length));
    const distance = Math.hypot(a.x + fraction * dx, a.y + fraction * dy);
    if (near === null && distance > OFF_TRIP_M) continue;
    const cost =
      near === null
        ? distance +
          Math.abs(
            scheduledTime(
              departure.serviceDate,
              departure.trip[7] + pattern[k][3] + fraction * (pattern[k + 1][2] - pattern[k][3]),
            ) - now,
          ) /
            12_000
        : distance;
    if (!best || cost < best.cost) best = { after: k, fraction, distance, cost };
  }
  return best;
}

type PathStops = { points: Coordinates[]; along: number[]; stops: number[] } | null;
const paths = new WeakMap<Schedule, Map<string, PathStops>>();

// How far along the trip's drawn path each of its stops sits, so an estimate is drawn on the
// street the bus takes. Stops are matched in order, each at the first close pass after the one
// before, so a loop that passes a stop twice keeps the right pass. Null when a stop is far from
// the path; the estimate then runs straight between the two stops.
export function pathStops(schedule: Schedule, trip: Trip): PathStops {
  const key = `${trip[6]}/${trip[5]}`;
  let known = paths.get(schedule);
  if (!known) paths.set(schedule, (known = new Map()));
  if (known.has(key)) return known.get(key)!;
  const shape = schedule.shapes[trip[5]] ?? [];
  let result: PathStops = null;
  if (shape.length >= 2) {
    const cos = Math.cos((shape[0][0] * Math.PI) / 180);
    const xy = (lat: number, lng: number) => ({ x: lng * 111_320 * cos, y: lat * 110_540 });
    const points = shape.map((p) => xy(p[0], p[1]));
    const along = [0];
    for (let i = 1; i < points.length; i++)
      along.push(
        along[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
      );
    const stops: number[] = [];
    let from = 0;
    for (const stopTime of schedule.patterns[trip[6]]) {
      const stop = xy(schedule.stops[stopTime[0]][3], schedule.stops[stopTime[0]][4]);
      let best: { k: number; distance: number; at: number } | null = null;
      for (let k = from; k < points.length - 1; k++) {
        const a = points[k];
        const b = points[k + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = dx * dx + dy * dy;
        const f =
          length === 0
            ? 0
            : Math.min(1, Math.max(0, ((stop.x - a.x) * dx + (stop.y - a.y) * dy) / length));
        const distance = Math.hypot(a.x + f * dx - stop.x, a.y + f * dy - stop.y);
        if (!best || distance < best.distance)
          best = { k, distance, at: along[k] + f * (along[k + 1] - along[k]) };
        else if (best.distance < 150 && distance > best.distance + 500) break;
      }
      if (!best || best.distance > 150) {
        stops.length = 0;
        break;
      }
      stops.push(Math.max(best.at, stops.at(-1) ?? 0));
      from = best.k;
    }
    if (stops.length === schedule.patterns[trip[6]].length)
      result = { points: shape.map((p) => ({ lat: p[0], lng: p[1] })), along, stops };
  }
  known.set(key, result);
  return result;
}

function estimatedPoint(schedule: Schedule, trip: Trip, after: number, fraction: number) {
  const pattern = schedule.patterns[trip[6]];
  const path = pathStops(schedule, trip);
  if (!path) {
    const a = schedule.stops[pattern[after][0]];
    const b = schedule.stops[pattern[Math.min(after + 1, pattern.length - 1)][0]];
    return { lat: a[3] + fraction * (b[3] - a[3]), lng: a[4] + fraction * (b[4] - a[4]) };
  }
  const target = path.stops[after] + fraction * (path.stops[after + 1] - path.stops[after]);
  let k = 0;
  while (k < path.along.length - 2 && path.along[k + 1] < target) k++;
  const span = path.along[k + 1] - path.along[k];
  const f = span === 0 ? 0 : Math.min(1, Math.max(0, (target - path.along[k]) / span));
  const a = path.points[k];
  const b = path.points[k + 1];
  return { lat: a.lat + f * (b.lat - a.lat), lng: a.lng + f * (b.lng - a.lng) };
}

// Between the stop it left and the one LTC predicts next, by the clock: it leaves with the delay
// that prediction carries and gets there at the predicted time, and waits there if it is late.
// Never past that stop, never from an old reading.
function estimatedFraction(
  schedule: Schedule,
  departure: Departure,
  update: LiveTripUpdate,
  next: number,
  now: number,
): number {
  const pattern = schedule.patterns[departure.trip[6]];
  const at = (index: number, field: 2 | 3) =>
    scheduledTime(departure.serviceDate, departure.trip[7] + pattern[index][field]);
  const stop = update.stops.find((s) => s.stopSequence === pattern[next][1]);
  const arrive =
    (stop && (prediction(stop.arrival, at(next, 2)) ?? prediction(stop.departure, at(next, 3)))) ??
    at(next, 2);
  const leave = at(next - 1, 3) + (arrive - at(next, 2));
  if (arrive <= leave) return now >= arrive ? 1 : 0;
  return Math.min(1, Math.max(0, (now - leave) / (arrive - leave)));
}

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
  bus: FollowedBus | null;
  /** From the current predictions: not started, under way, or no stop left ahead. Null without them. */
  phase: 'not-started' | 'under-way' | 'ended' | null;
} {
  const usable = usableSnapshot(snapshot, schedule, now);
  const update = usable
    ? snapshot.tripUpdates.find((t) => sameTrip(t, departure, schedule))
    : undefined;
  const vehicles = usable ? snapshot.vehicles.filter((v) => sameTrip(v, departure, schedule)) : [];
  const pattern = schedule.patterns[departure.trip[6]];
  const followed =
    usable &&
    (!snapshot.coverage ||
      snapshot.coverage.trips.some(
        (t) => t.tripId === departure.trip[0] && t.serviceDate === departure.serviceDate,
      ));
  const recent = (v: LiveVehicle) =>
    v.position !== null &&
    v.measuredAt !== null &&
    v.measuredAt <= now + FUTURE_ALLOWANCE_MS &&
    now - v.measuredAt <= LAST_REPORT_MS;
  const newest = (list: LiveVehicle[]) =>
    list.filter(recent).sort((a, b) => b.measuredAt! - a.measuredAt!)[0] ?? null;
  const current =
    (usable &&
      vehicles.find(
        (v) => v.position !== null && liveFreshness(snapshot, 'vehicles', v.measuredAt, now),
      )) ||
    null;
  const last =
    current ??
    (usable
      ? newest([
          ...vehicles,
          ...(snapshot.retainedVehicles ?? []).filter((v) => sameTrip(v, departure, schedule)),
        ])
      : null);
  const next =
    followed &&
    update?.relationship === 'scheduled' &&
    (last !== null || update.vehicleId !== null) &&
    liveFreshness(snapshot, 'trips', update.measuredAt, now)
      ? nextStopIndex(schedule, departure, update, now)
      : null;
  const reported = (vehicle: LiveVehicle, placedBy: 'gps' | 'last-gps'): FollowedBus => {
    const position = vehicle.position!;
    const point = { lat: position.lat, lng: position.lng };
    const near = next !== null && next < pattern.length ? next : null;
    const placed = alongStops(schedule, departure, point, near, now);
    if (placed && placed.distance <= OFF_TRIP_M)
      return {
        placedBy,
        along: { after: placed.after, fraction: placed.fraction },
        why: null,
        point,
        vehicle,
      };
    const anywhere = near === null ? null : alongStops(schedule, departure, point, null, now);
    return { placedBy, along: null, why: anywhere ? 'disagrees' : 'off-trip', point, vehicle };
  };
  let bus: FollowedBus | null = null;
  if (current) bus = reported(current, 'gps');
  else if (update && next !== null && next > 0 && next < pattern.length) {
    const fraction = estimatedFraction(schedule, departure, update, next, now);
    bus = {
      placedBy: 'estimate',
      along: { after: next - 1, fraction },
      why: null,
      point: estimatedPoint(schedule, departure.trip, next - 1, fraction),
      vehicle: last,
    };
  } else if (last) bus = reported(last, 'last-gps');
  else if (usable && update?.vehicleId && (next === null || next === 0)) {
    // The same bus is often named on its next trip while it still runs the one before.
    const elsewhere = newest(
      [...snapshot.vehicles, ...(snapshot.retainedVehicles ?? [])].filter(
        (v) => v.vehicleId === update.vehicleId && !sameTrip(v, departure, schedule),
      ),
    );
    if (elsewhere)
      bus = {
        placedBy:
          snapshot.vehicles.includes(elsewhere) &&
          liveFreshness(snapshot, 'vehicles', elsewhere.measuredAt, now)
            ? 'gps'
            : 'last-gps',
        along: null,
        why: 'other-trip',
        point: { lat: elsewhere.position!.lat, lng: elsewhere.position!.lng },
        vehicle: elsewhere,
      };
  }
  const along = bus?.along ?? null;
  const reached = along ? along.after + (along.fraction > 0 ? 1 : 0) : next;
  const fresh = !!snapshot && liveFreshness(snapshot, 'trips', update?.measuredAt ?? null, now);
  const controlFresh =
    !!snapshot &&
    liveFreshness(
      snapshot,
      'trips',
      update?.measuredAt ?? snapshot.health.trips.feedTimestamp,
      now,
    );
  const stops = pattern.map((stopTime, index) => {
    const scheduledArrival = scheduledTime(departure.serviceDate, departure.trip[7] + stopTime[2]);
    const scheduledDeparture = scheduledTime(
      departure.serviceDate,
      departure.trip[7] + stopTime[3],
    );
    const stopId = schedule.stops[stopTime[0]][0];
    const stop = update?.stops.find((s) => s.stopSequence === stopTime[1] && s.stopId === stopId);
    const askedStop = !snapshot || asked(snapshot, departure, stopId);
    const merged = stopDeparture(
      update,
      stop,
      scheduledDeparture,
      fresh,
      scheduledArrival,
      snapshot?.health.trips.feedTimestamp ?? null,
      controlFresh,
      askedStop,
    );
    const applicable =
      askedStop && update?.relationship === 'scheduled' && stop?.relationship === 'scheduled';
    const arrival = applicable ? prediction(stop.arrival, scheduledArrival) : null;
    const departurePrediction = applicable ? prediction(stop.departure, scheduledDeparture) : null;
    return {
      ...merged,
      stop: schedule.stops[stopTime[0]],
      stopTime,
      scheduledAt: scheduledDeparture,
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
      // A bus standing at a stop has not passed it yet. Without a placed bus, the current
      // predictions say how far the trip has gone.
      progress:
        reached === null
          ? ('unknown' as const)
          : index < reached
            ? ('passed' as const)
            : index === reached && (along || next !== 0)
              ? ('next' as const)
              : ('upcoming' as const),
    };
  });
  return {
    stops,
    vehicles,
    alerts: relevantLiveAlerts(schedule, departure, snapshot, now, null),
    update: update ?? null,
    bus,
    phase:
      next === null
        ? null
        : next === 0
          ? 'not-started'
          : next >= pattern.length
            ? 'ended'
            : 'under-way',
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

/** The service asked to wait, at its limit or switched off, for as long as it said. */
class LivePaused extends Error {
  waitMs: number;
  constructor(waitMs: number) {
    super('La conexión en vivo está pausada o alcanzó su límite. Se conserva el horario.');
    this.waitMs = waitMs;
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
        if (response.status === 429 || response.status === 503) {
          const seconds = Number(response.headers.get('retry-after'));
          throw new LivePaused(Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 0);
        }
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
  let endsAt: number | undefined;
  let request: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastAttempt = -Infinity;
  let attemptedKey: string | null = null;
  let failures = 0;
  let retryAfter = 0;
  // Until when the service itself asked to wait; that wait outlasts a trip to another app.
  let pausedUntil = 0;
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
  // From half an hour before the chosen departure until its trip is over: following a bus that
  // left his stop ten minutes ago is still useful while it runs.
  const near = () =>
    departureAt === undefined ||
    (now() >= departureAt - 30 * 60_000 &&
      now() <= Math.max(departureAt + 10 * 60_000, (endsAt ?? -Infinity) + FOLLOW_AFTER_END_MS));
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
      // An answer arrived, so the connection works: an old or failing LTC file is shown as such
      // and read again at the usual pace. Backing off for it, alerts included, kept healthy buses
      // waiting up to five minutes; the service already limits its own retries to LTC.
      failures = 0;
      retryAfter = 0;
      pausedUntil = 0;
      const sourceFailure =
        snapshot.health.trips.status !== 'ok' || snapshot.health.vehicles.status !== 'ok';
      emit({
        snapshot: {
          ...snapshot,
          coverage:
            snapshot.tripUpdates === received.tripUpdates
              ? { stopIds: query.stopIds, trips: query.trips }
              : state.snapshot?.coverage,
          retainedVehicles: retainFollowed(
            state.snapshot,
            snapshot,
            query,
            options.schedule,
            now(),
          ),
        },
        lastSuccessAt: now(),
        reason: sourceFailure
          ? 'Parte de la información en vivo no está disponible o es antigua. Se conserva el horario.'
          : null,
      });
      if (options.cache) {
        // The answer itself: a source kept from an earlier reading may belong to another query.
        const content = JSON.stringify({ schema: 1, query, snapshot: received, storedAt: now() });
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
      if (error instanceof LivePaused)
        pausedUntil = retryAfter = Math.max(retryAfter, now() + Math.min(5 * 60_000, error.waitMs));
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
          snapshot: {
            ...snapshot,
            coverage: { stopIds: cachedQuery.stopIds, trips: cachedQuery.trips },
          },
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
    setQuery: (
      query: LiveQuery | null,
      selection: { departureAt?: number; endsAt?: number } = {},
    ) => {
      if (disposed) return;
      if (query) validateLiveQuery(query, options.schedule);
      departureAt = selection.departureAt;
      endsAt = selection.endsAt;
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
      // The last reading stays on screen until the new one arrives: each report keeps its own trip
      // and times, and a stop it did not ask about reads as schedule meanwhile. Clearing it on
      // every change, such as the planner's stops moving, blanked the followed bus.
      emit({
        query,
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
        return;
      }
      // Back from another app it reads at once, within the usual 15 s between reads: a failure
      // from before leaving, often the network dropping meanwhile, says little about now. A wait
      // the service asked for still holds.
      if (now() >= pausedUntil) retryAfter = 0;
      void refresh();
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
