import { addDays, isRealDate, type IsoDate } from '../core/dates.ts';
import { distanceMetres, type Coordinates } from '../core/geo.ts';

export const SCHEDULE_SCHEMA = 2;
export const SCHEDULE_MAX_BYTES = 12_000_000;
export const SCHEDULE_SOURCE = 'https://www.londontransit.ca/gtfsfeed/google_transit.zip';

export type Stop = [id: string, code: string, name: string, lat: number, lng: number];
export type Route = [id: string, shortName: string, name: string, color: string];
export type Service = [id: string, weekdays: number, start: IsoDate, end: IsoDate];
export type Exception = [service: string, date: IsoDate, kind: number];
export type StopTime = [
  stop: number,
  sequence: number,
  arrival: number,
  departure: number,
  pickup: number,
  dropOff: number,
  timepoint: number,
  headsign: string,
];
export type Trip = [
  id: string,
  route: number,
  service: string,
  headsign: string,
  direction: number | null,
  shape: string,
  pattern: number,
  start: number,
];
export type Schedule = {
  schema: number;
  source: string;
  sourceSha256: string;
  createdAt: number;
  feedVersion: string;
  timezone: 'America/Toronto';
  validFrom: IsoDate;
  validTo: IsoDate;
  stops: Stop[];
  routes: Route[];
  services: Service[];
  exceptions: Exception[];
  patterns: StopTime[][];
  trips: Trip[];
  shapes: Record<string, [lat: number, lng: number, sequence: number][]>;
  transfers: [from: number, to: number, kind: number, minimum: number | null][];
};

function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(`Horario inválido: ${reason}`);
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function text(value: unknown, nonempty = false): value is string {
  return typeof value === 'string' && value.length <= 500 && (!nonempty || value.trim() !== '');
}

function date(value: unknown): value is string {
  return typeof value === 'string' && isRealDate(value);
}

function tuple(value: unknown, length: number): asserts value is unknown[] {
  check(Array.isArray(value) && value.length === length, 'fila incompleta');
}

function rows(value: unknown, maximum: number): asserts value is unknown[][] {
  check(Array.isArray(value) && value.length <= maximum, 'lista ausente o demasiado grande');
}

export function validCoordinates(point: Coordinates): boolean {
  return (
    Number.isFinite(point.lat) &&
    Math.abs(point.lat) <= 90 &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lng) <= 180
  );
}

export function validateSchedule(raw: unknown): Schedule {
  check(raw && typeof raw === 'object' && !Array.isArray(raw), 'falta el paquete');
  const p = raw as Record<string, unknown>;
  check(p.schema === SCHEDULE_SCHEMA, 'versión de formato no compatible');
  check(p.source === SCHEDULE_SOURCE && p.timezone === 'America/Toronto', 'fuente o zona horaria');
  check(
    typeof p.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(p.sourceSha256),
    'identidad de origen',
  );
  check(
    integer(p.createdAt, 1, Date.now() + 86_400_000) && text(p.feedVersion, true),
    'fecha o versión',
  );
  check(date(p.validFrom) && date(p.validTo) && p.validFrom <= p.validTo, 'vigencia');
  rows(p.stops, 10_000);
  rows(p.routes, 500);
  rows(p.services, 5_000);
  rows(p.exceptions, 50_000);
  rows(p.patterns, 30_000);
  rows(p.trips, 100_000);
  rows(p.transfers, 10_000);
  check(p.stops.length && p.routes.length && p.trips.length && p.patterns.length, 'paquete vacío');
  const stopIds = new Set<string>();
  for (const row of p.stops) {
    tuple(row, 5);
    check(
      text(row[0], true) && !stopIds.has(row[0]) && text(row[1]) && text(row[2], true),
      'parada',
    );
    check(
      typeof row[3] === 'number' &&
        typeof row[4] === 'number' &&
        validCoordinates({ lat: row[3], lng: row[4] }),
      'coordenadas',
    );
    stopIds.add(row[0]);
  }
  const routeIds = new Set<string>();
  for (const row of p.routes) {
    tuple(row, 4);
    check(
      text(row[0], true) &&
        !routeIds.has(row[0]) &&
        text(row[1]) &&
        text(row[2]) &&
        typeof row[3] === 'string' &&
        /^([0-9A-F]{6})?$/.test(row[3]),
      'línea',
    );
    routeIds.add(row[0]);
  }
  const serviceIds = new Set<string>();
  for (const row of p.services) {
    tuple(row, 4);
    check(
      text(row[0], true) &&
        !serviceIds.has(row[0]) &&
        integer(row[1], 0, 127) &&
        date(row[2]) &&
        date(row[3]) &&
        row[2] <= row[3],
      'calendario',
    );
    serviceIds.add(row[0]);
  }
  const exceptionIds = new Set<string>();
  for (const row of p.exceptions) {
    tuple(row, 3);
    check(text(row[0], true) && date(row[1]) && (row[2] === 1 || row[2] === 2), 'excepción');
    const key = `${row[0]}/${row[1]}`;
    check(!exceptionIds.has(key), 'excepción duplicada');
    exceptionIds.add(key);
    if (row[2] === 1) serviceIds.add(row[0]);
  }
  for (const row of p.exceptions) check(serviceIds.has(row[0] as string), 'servicio desconocido');
  let total = 0;
  for (const pattern of p.patterns) {
    rows(pattern, 1_000);
    check(pattern.length >= 2, 'viaje incompleto');
    total += pattern.length;
    check(total <= 1_000_000, 'demasiadas horas');
    let sequence = -1;
    let departure = -1;
    for (const row of pattern) {
      tuple(row, 8);
      check(
        integer(row[0], 0, p.stops.length - 1) && integer(row[1], 0, 100_000) && row[1] > sequence,
        'referencia u orden de parada',
      );
      check(
        integer(row[2], 0, 259_199) &&
          integer(row[3], 0, 259_199) &&
          row[2] >= departure &&
          row[3] >= row[2],
        'horas fuera de orden',
      );
      check(
        integer(row[4], 0, 3) && integer(row[5], 0, 3) && integer(row[6], 0, 1) && text(row[7]),
        'restricción de parada',
      );
      sequence = row[1];
      departure = row[3];
    }
    check(pattern[0][2] === 0, 'inicio de patrón');
  }
  check(p.shapes && typeof p.shapes === 'object' && !Array.isArray(p.shapes), 'faltan trazados');
  const shapes = p.shapes as Record<string, unknown>;
  check(Object.keys(shapes).length <= 10_000, 'demasiados trazados');
  total = 0;
  for (const [id, points] of Object.entries(shapes)) {
    check(text(id, true), 'identidad de trazado');
    rows(points, 30_000);
    total += points.length;
    check(total <= 1_000_000, 'demasiados puntos');
    let sequence = -1;
    for (const point of points) {
      tuple(point, 3);
      check(
        typeof point[0] === 'number' &&
          typeof point[1] === 'number' &&
          validCoordinates({ lat: point[0], lng: point[1] }) &&
          integer(point[2], 0, 100_000) &&
          point[2] > sequence,
        'punto de trazado',
      );
      sequence = point[2];
    }
  }
  const tripIds = new Set<string>();
  for (const row of p.trips) {
    tuple(row, 8);
    check(
      text(row[0], true) &&
        !tripIds.has(row[0]) &&
        integer(row[1], 0, p.routes.length - 1) &&
        text(row[2], true) &&
        serviceIds.has(row[2]) &&
        text(row[3]) &&
        (row[4] === null || row[4] === 0 || row[4] === 1) &&
        text(row[5]) &&
        (!row[5] || Object.hasOwn(shapes, row[5])) &&
        integer(row[6], 0, p.patterns.length - 1) &&
        integer(row[7], 0, 259_199),
      'viaje o referencia desconocida',
    );
    const pattern = p.patterns[row[6]] as unknown as StopTime[];
    check(row[7] + pattern.at(-1)![3] <= 259_199, 'viaje fuera del día de servicio');
    tripIds.add(row[0]);
  }
  for (const row of p.transfers) {
    tuple(row, 4);
    check(
      integer(row[0], 0, p.stops.length - 1) &&
        integer(row[1], 0, p.stops.length - 1) &&
        integer(row[2], 0, 3) &&
        (row[3] === null || integer(row[3], 0, 86_400)) &&
        (row[2] !== 2 || row[3] !== null),
      'transbordo',
    );
  }
  return p as unknown as Schedule;
}

export function activeServices(schedule: Schedule, day: IsoDate): Set<string> {
  const active = new Set<string>();
  if (!isRealDate(day) || day < schedule.validFrom || day > schedule.validTo) return active;
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  for (const [id, mask, from, to] of schedule.services) {
    if (day >= from && day <= to && mask & (1 << weekday)) active.add(id);
  }
  for (const [id, when, kind] of schedule.exceptions) {
    if (when === day) {
      if (kind === 1) active.add(id);
      else active.delete(id);
    }
  }
  return active;
}

const zoned = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function zoneParts(at: number): Record<string, string> {
  return Object.fromEntries(zoned.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
}

export function agencyDate(at: number): IsoDate {
  const p = zoneParts(at);
  return `${p.year}-${p.month}-${p.day}`;
}

// Every live merge asks for its day's start, and each answer costs three time zone conversions;
// the planner merges hundreds of times per reading.
const dayStarts = new Map<IsoDate, number>();

// GTFS defines service time from local noon minus twelve hours, including DST days.
export function serviceDayStart(day: IsoDate): number {
  const known = dayStarts.get(day);
  if (known !== undefined) return known;
  if (!isRealDate(day)) throw new Error('Fecha inválida; usa AAAA-MM-DD.');
  const noon = Date.parse(`${day}T12:00:00Z`);
  let instant = noon;
  for (let i = 0; i < 3; i++) {
    const p = zoneParts(instant);
    const observed = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    instant += noon - observed;
  }
  dayStarts.set(day, instant - 43_200_000);
  return instant - 43_200_000;
}

export function scheduledTime(day: IsoDate, seconds: number): number {
  return serviceDayStart(day) + seconds * 1_000;
}

export function agencyClock(at: number): string {
  const p = zoneParts(at);
  return `${p.hour}:${p.minute}`;
}

export function queryInstant(day: IsoDate, clock: string): number {
  if (!isRealDate(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) {
    throw new Error('Usa una fecha AAAA-MM-DD y una hora HH:MM entre 00:00 y 23:59.');
  }
  const [hours, minutes] = clock.split(':').map(Number);
  // Match the requested wall clock; a skipped DST hour has no matching instant.
  const expected = serviceDayStart(day) + (hours * 60 + minutes) * 60_000;
  for (let offset = -120; offset <= 120; offset++) {
    const at = expected + offset * 60_000;
    const p = zoneParts(at);
    if (`${p.year}-${p.month}-${p.day}` === day && `${p.hour}:${p.minute}` === clock) return at;
  }
  throw new Error(
    `La hora ${hours}:${String(minutes).padStart(2, '0')} no existe en London ese día.`,
  );
}

export type Departure = {
  trip: Trip;
  route: Route;
  stopTime: StopTime;
  serviceDate: IsoDate;
  at: number;
};

export function buildStopIndex(
  schedule: Schedule,
): Map<number, { trips: Trip[]; time: StopTime }[]> {
  const index = new Map<number, { trips: Trip[]; time: StopTime }[]>();
  const patternTrips = schedule.patterns.map(() => [] as Trip[]);
  for (const trip of schedule.trips) {
    patternTrips[trip[6]].push(trip);
  }
  for (const [pattern, times] of schedule.patterns.entries()) {
    for (const time of times) {
      const list = index.get(time[0]) ?? [];
      list.push({ trips: patternTrips[pattern], time });
      index.set(time[0], list);
    }
  }
  return index;
}

export function departures(
  schedule: Schedule,
  index: ReturnType<typeof buildStopIndex>,
  stop: number,
  from: number,
  limit = 20,
  observedTrips: readonly { tripId: string; serviceDate: IsoDate }[] = [],
): Departure[] {
  const day = agencyDate(from);
  const result: Departure[] = [];
  for (let offset = -2; offset <= 1; offset++) {
    const serviceDate = addDays(day, offset);
    const active = activeServices(schedule, serviceDate);
    const observed = new Set(
      observedTrips.filter((trip) => trip.serviceDate === serviceDate).map((trip) => trip.tripId),
    );
    const start = serviceDayStart(serviceDate);
    for (const { trips, time } of index.get(stop) ?? [])
      for (const trip of trips) {
        if ((!active.has(trip[2]) && !observed.has(trip[0])) || time[4] === 1) continue;
        const at = start + (trip[7] + time[3]) * 1_000;
        if (at >= from && at < from + 86_400_000)
          result.push({ trip, route: schedule.routes[trip[1]], stopTime: time, serviceDate, at });
      }
  }
  return result.sort((a, b) => a.at - b.at || a.stopTime[1] - b.stopTime[1]).slice(0, limit);
}

export function nearbyStops(schedule: Schedule, point: Coordinates, limit = 12) {
  return schedule.stops
    .map((stop, index) => ({
      stop,
      index,
      distanceM: distanceMetres(point, { lat: stop[3], lng: stop[4] }),
    }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

/**
 * The lines a stop serves, one per route and direction, from the trips that let people on there.
 */
export function stopLines(
  schedule: Schedule,
  index: ReturnType<typeof buildStopIndex>,
  stop: number,
): { key: string; route: Route }[] {
  const lines = new Map<string, Route>();
  for (const { trips, time } of index.get(stop) ?? []) {
    if (time[4] === 1) continue;
    for (const trip of trips)
      lines.set(`${trip[1]}/${trip[4] ?? trip[3]}`, schedule.routes[trip[1]]);
  }
  return [...lines].map(([key, route]) => ({ key, route }));
}

// A nearby stop makes the short list only when it adds a line, or a direction of one, that a
// closer stop does not already serve: the next stop down the same street is one tap away.
export function usefulStops<T extends { index: number }>(
  schedule: Schedule,
  index: ReturnType<typeof buildStopIndex>,
  candidates: T[],
  limit = 6,
): { main: T[]; more: T[] } {
  const served = new Set<string>();
  const main: T[] = [];
  const more: T[] = [];
  for (const candidate of candidates) {
    const keys = stopLines(schedule, index, candidate.index).map((line) => line.key);
    if (main.length < limit && keys.some((key) => !served.has(key))) {
      main.push(candidate);
      for (const key of keys) served.add(key);
    } else more.push(candidate);
  }
  return { main, more };
}
