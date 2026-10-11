import Bindings from 'gtfs-realtime-bindings';
import { addDays, isRealDate } from '../generated/core/dates.ts';
import {
  activeServices,
  agencyDate,
  scheduledTime,
  type Schedule,
  type Trip,
} from '../generated/transit/schedule.ts';
import type {
  LiveAlert,
  LiveAlertSelector,
  LiveEvent,
  LiveIdentity,
  LiveStopUpdate,
  LiveTripUpdate,
  LiveVehicle,
  RealtimeQuery,
  RealtimeResponse,
} from '../generated/transit/realtime-contract.ts';

export const own = (value: object, field: string) => Object.hasOwn(value, field);
type Descriptor = Bindings.transit_realtime.ITripDescriptor;
type Issues = RealtimeResponse['issues'];

export function numeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(String(value));
  return Number.isSafeInteger(number) ? number : null;
}

export function timestamp(value: unknown, now: number): number | null {
  const seconds = numeric(value);
  return seconds !== null && seconds >= 946_684_800 && seconds * 1000 <= now + 30_000
    ? seconds * 1000
    : null;
}

export function decodeFeed(bytes: Uint8Array, now: number) {
  const feed = Bindings.transit_realtime.FeedMessage.decode(bytes);
  if (!feed.header.gtfsRealtimeVersion || feed.header.incrementality === 1) {
    throw new Error('unsupported_feed');
  }
  if (own(feed.header, 'timestamp') && timestamp(feed.header.timestamp, now) === null) {
    throw new Error('invalid_feed_timestamp');
  }
  if (feed.entity.length > 5000) throw new Error('too_many_entities');
  let stopUpdates = 0;
  for (const entity of feed.entity) {
    stopUpdates += entity.tripUpdate?.stopTimeUpdate?.length ?? 0;
    if (stopUpdates > 500_000) throw new Error('too_many_stop_updates');
  }
  return feed;
}

export function indexes(schedule: Schedule) {
  const stopPatterns = new Map<string, Set<number>>();
  for (const [pattern, stops] of schedule.patterns.entries()) {
    for (const stop of stops) {
      const id = schedule.stops[stop[0]][0];
      const patterns = stopPatterns.get(id) ?? new Set<number>();
      patterns.add(pattern);
      stopPatterns.set(id, patterns);
    }
  }
  return {
    trips: new Map(schedule.trips.map((trip) => [trip[0], trip])),
    stops: new Map(schedule.stops.map((stop, index) => [stop[0], index])),
    routes: new Set(schedule.routes.map((route) => route[0])),
    stopPatterns,
  };
}
export type StaticIndex = ReturnType<typeof indexes>;

export function tripStartTime(schedule: Schedule, trip: Trip): string {
  const seconds = trip[7] + schedule.patterns[trip[6]][0][3];
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

function serviceDate(value: string): string | null {
  if (!/^\d{8}$/.test(value)) return null;
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  return isRealDate(date) ? date : null;
}

function identity(
  descriptor: Descriptor | null | undefined,
  schedule: Schedule,
  index: StaticIndex,
  measuredAt: number | null,
  now: number,
): { identity: LiveIdentity; trip: Trip } | null {
  const trip = index.trips.get(descriptor?.tripId ?? '');
  if (!descriptor || !trip) return null;
  const routeId = schedule.routes[trip[1]][0];
  if (own(descriptor, 'routeId') && descriptor.routeId !== routeId) return null;
  // LTC sends 1, and on route 10 even 11, for trips its own schedule lists as direction 0. The trip
  // ID and date already pick one trip, and its stop updates are still checked against that trip.
  const directionId =
    own(descriptor, 'directionId') && numeric(descriptor.directionId) === trip[4] ? trip[4] : null;
  const startTime = own(descriptor, 'startTime') ? (descriptor.startTime ?? null) : null;
  if (startTime !== null && startTime !== tripStartTime(schedule, trip)) return null;
  let date = own(descriptor, 'startDate') ? serviceDate(descriptor.startDate ?? '') : null;
  if (own(descriptor, 'startDate') && date === null) return null;
  if (date === null) {
    const observed = measuredAt ?? now;
    const day = agencyDate(observed);
    const candidates = [-2, -1, 0, 1]
      .map((offset) => addDays(day, offset))
      .filter((candidate) => {
        const start = scheduledTime(candidate, trip[7] + schedule.patterns[trip[6]][0][3]);
        return (
          activeServices(schedule, candidate).has(trip[2]) &&
          Math.abs(start - observed) <= 64_800_000
        );
      });
    if (candidates.length !== 1) return null;
    date = candidates[0];
  }
  if (!activeServices(schedule, date).has(trip[2])) return null;
  const currentDay = agencyDate(now);
  if (date < addDays(currentDay, -2) || date > addDays(currentDay, 1)) return null;
  return {
    identity: { tripId: trip[0], routeId, directionId, serviceDate: date, startTime },
    trip,
  };
}

function boundedInteger(value: unknown, min: number, max: number): number | null {
  const result = numeric(value);
  return result !== null && result >= min && result <= max ? result : null;
}

function event(
  value: Bindings.transit_realtime.TripUpdate.IStopTimeEvent | null | undefined,
  dayStart: number,
): LiveEvent | null {
  if (!value) return null;
  const seconds = own(value, 'time') ? numeric(value.time) : null;
  return {
    time:
      seconds !== null &&
      seconds * 1000 >= dayStart - 43_200_000 &&
      seconds * 1000 <= dayStart + 345_600_000
        ? seconds * 1000
        : null,
    delay: own(value, 'delay') ? boundedInteger(value.delay, -86_400, 86_400) : null,
    uncertainty: own(value, 'uncertainty') ? boundedInteger(value.uncertainty, 0, 86_400) : null,
  };
}

function relevant(id: LiveIdentity, trip: Trip, index: StaticIndex, query: RealtimeQuery): boolean {
  return (
    query.routeIds.includes(id.routeId) ||
    query.trips.some((ref) => ref.tripId === id.tripId && ref.serviceDate === id.serviceDate) ||
    query.stopIds.some((stopId) => index.stopPatterns.get(stopId)?.has(trip[6]))
  );
}

function stopUpdate(
  update: Bindings.transit_realtime.TripUpdate.IStopTimeUpdate,
  trip: Trip,
  schedule: Schedule,
  issues: Issues,
  dayStart: number,
): LiveStopUpdate | null {
  const pattern = schedule.patterns[trip[6]];
  let matches = pattern;
  if (own(update, 'stopSequence'))
    matches = matches.filter((stop) => stop[1] === update.stopSequence);
  if (own(update, 'stopId'))
    matches = matches.filter((stop) => schedule.stops[stop[0]][0] === update.stopId);
  if ((!own(update, 'stopSequence') && !own(update, 'stopId')) || matches.length !== 1) {
    issues.ambiguousStops++;
    return null;
  }
  const stop = matches[0];
  const relation = own(update, 'scheduleRelationship') ? update.scheduleRelationship : 0;
  return {
    stopId: schedule.stops[stop[0]][0],
    stopSequence: stop[1],
    relationship:
      relation === 0
        ? 'scheduled'
        : relation === 1
          ? 'skipped'
          : relation === 2
            ? 'no_data'
            : 'unsupported',
    arrival: event(update.arrival, dayStart),
    departure: event(update.departure, dayStart),
  };
}

export function normalizeTrips(
  feed: Bindings.transit_realtime.FeedMessage,
  schedule: Schedule,
  index: StaticIndex,
  query: RealtimeQuery,
  now: number,
  issues: Issues,
): LiveTripUpdate[] {
  const result: LiveTripUpdate[] = [];
  const positions = new Map<string, number>();
  const contested = new Set<string>();
  const entities = [...feed.entity].sort(
    (a, b) =>
      Number(query.trips.some((ref) => ref.tripId === b.tripUpdate?.trip?.tripId)) -
      Number(query.trips.some((ref) => ref.tripId === a.tripUpdate?.trip?.tripId)),
  );
  for (const entity of entities) {
    const update = entity.tripUpdate;
    if (!update || entity.isDeleted) continue;
    const measuredAt = own(update, 'timestamp') ? timestamp(update.timestamp, now) : null;
    if (own(update, 'timestamp') && measuredAt === null) {
      issues.invalidEntities++;
      continue;
    }
    const joined = identity(update.trip, schedule, index, measuredAt, now);
    if (!joined) {
      issues.unmatchedTrips++;
      continue;
    }
    if (!relevant(joined.identity, joined.trip, index, query)) continue;
    const vehicleId =
      update.vehicle && own(update.vehicle, 'id')
        ? (update.vehicle.id?.slice(0, 150) ?? null)
        : null;
    // LTC repeats some trips: one copy names the bus and carries its delays, the other restates the
    // schedule. Keep the copy with the bus; two buses on one trip leave no way to know which is right.
    const key = `${joined.identity.tripId}/${joined.identity.serviceDate}`;
    const earlier = positions.get(key);
    if (earlier !== undefined) {
      if (result[earlier].vehicleId !== null && vehicleId !== null) contested.add(key);
      if (result[earlier].vehicleId !== null || vehicleId === null) continue;
    } else if (result.length >= 80) {
      issues.truncated = true;
      continue;
    }
    const selected = query.trips.some(
      (ref) =>
        ref.tripId === joined.identity.tripId && ref.serviceDate === joined.identity.serviceDate,
    );
    const stops: LiveStopUpdate[] = [];
    for (const source of update.stopTimeUpdate ?? []) {
      const normalized = stopUpdate(
        source,
        joined.trip,
        schedule,
        issues,
        scheduledTime(joined.identity.serviceDate, 0),
      );
      if (normalized && (selected || query.stopIds.includes(normalized.stopId))) {
        if (stops.length < 200) stops.push(normalized);
        else issues.truncated = true;
      }
    }
    const relation = own(update.trip!, 'scheduleRelationship')
      ? update.trip!.scheduleRelationship
      : 0;
    const entry: LiveTripUpdate = {
      ...joined.identity,
      entityId: entity.id.slice(0, 150),
      vehicleId,
      measuredAt,
      relationship:
        relation === 0
          ? 'scheduled'
          : relation === 3 || relation === 7
            ? 'canceled'
            : 'unsupported',
      delay: own(update, 'delay') ? boundedInteger(update.delay, -86_400, 86_400) : null,
      stops,
    };
    if (earlier !== undefined) result[earlier] = entry;
    else positions.set(key, result.push(entry) - 1);
  }
  issues.unmatchedTrips += contested.size;
  return result.filter((entry) => !contested.has(`${entry.tripId}/${entry.serviceDate}`));
}

export function normalizeVehicles(
  feed: Bindings.transit_realtime.FeedMessage,
  schedule: Schedule,
  index: StaticIndex,
  query: RealtimeQuery,
  now: number,
  issues: Issues,
): LiveVehicle[] {
  const result: LiveVehicle[] = [];
  for (const entity of feed.entity) {
    const vehicle = entity.vehicle;
    if (!vehicle || entity.isDeleted) continue;
    if (
      vehicle.trip &&
      own(vehicle.trip, 'scheduleRelationship') &&
      vehicle.trip.scheduleRelationship !== 0
    ) {
      issues.invalidEntities++;
      continue;
    }
    const measuredAt = own(vehicle, 'timestamp') ? timestamp(vehicle.timestamp, now) : null;
    if (own(vehicle, 'timestamp') && measuredAt === null) {
      issues.invalidEntities++;
      continue;
    }
    const joined = identity(vehicle.trip, schedule, index, measuredAt, now);
    if (!joined) {
      issues.unmatchedTrips++;
      continue;
    }
    if (!relevant(joined.identity, joined.trip, index, query)) continue;
    if (result.length >= 120) {
      issues.truncated = true;
      continue;
    }
    const point = vehicle.position;
    const validPoint =
      point &&
      own(point, 'latitude') &&
      own(point, 'longitude') &&
      typeof point.latitude === 'number' &&
      Number.isFinite(point.latitude) &&
      Math.abs(point.latitude) <= 90 &&
      typeof point.longitude === 'number' &&
      Number.isFinite(point.longitude) &&
      Math.abs(point.longitude) <= 180;
    if (point && !validPoint) {
      issues.invalidEntities++;
      continue;
    }
    const stopSequence = own(vehicle, 'currentStopSequence')
      ? boundedInteger(vehicle.currentStopSequence, 0, 100_000)
      : null;
    const pattern = schedule.patterns[joined.trip[6]];
    const stopId = own(vehicle, 'stopId') ? (vehicle.stopId ?? null) : null;
    if (
      stopId !== null &&
      !pattern.some(
        (stop) =>
          schedule.stops[stop[0]][0] === stopId &&
          (stopSequence === null || stop[1] === stopSequence),
      )
    ) {
      issues.ambiguousStops++;
      continue;
    }
    if (stopSequence !== null && !pattern.some((stop) => stop[1] === stopSequence)) {
      issues.ambiguousStops++;
      continue;
    }
    const status = own(vehicle, 'currentStatus') ? vehicle.currentStatus : null;
    result.push({
      ...joined.identity,
      entityId: entity.id.slice(0, 150),
      vehicleId:
        vehicle.vehicle && own(vehicle.vehicle, 'id')
          ? (vehicle.vehicle.id?.slice(0, 150) ?? null)
          : null,
      measuredAt,
      stopId,
      stopSequence,
      status:
        status === 0 ? 'incoming' : status === 1 ? 'stopped' : status === 2 ? 'in_transit' : null,
      position: validPoint
        ? {
            lat: point!.latitude!,
            lng: point!.longitude!,
            bearing:
              own(point!, 'bearing') &&
              Number.isFinite(point!.bearing) &&
              point!.bearing! >= 0 &&
              point!.bearing! <= 360
                ? point!.bearing! % 360
                : null,
            speed:
              own(point!, 'speed') &&
              Number.isFinite(point!.speed) &&
              point!.speed! >= 0 &&
              point!.speed! <= 100
                ? point!.speed!
                : null,
          }
        : null,
    });
  }
  return result;
}

function translated(
  value: Bindings.transit_realtime.ITranslatedString | null | undefined,
  limit: number,
  issues: Issues,
): string {
  const translations = value?.translation ?? [];
  const selected = translations.find((item) => item.language === 'en') ?? translations[0];
  const text = selected?.text ?? '';
  if (text.length > limit) issues.truncated = true;
  return text.slice(0, limit);
}

function selectorMatches(
  selector: LiveAlertSelector,
  query: RealtimeQuery,
  schedule: Schedule,
  index: StaticIndex,
  candidates: Trip[],
): boolean {
  const selectedTrips = query.trips.map((ref) => ({ ref, trip: index.trips.get(ref.tripId)! }));
  const routeIds = new Set([
    ...query.routeIds,
    ...selectedTrips.map(({ trip }) => schedule.routes[trip[1]][0]),
  ]);
  const tripCandidates =
    selector.tripId !== null
      ? candidates.filter((trip) => trip[0] === selector.tripId)
      : candidates;
  return tripCandidates.some((trip) => {
    const routeId = schedule.routes[trip[1]][0];
    if (selector.routeId !== null && selector.routeId !== routeId) return false;
    if (selector.directionId !== null && selector.directionId !== trip[4]) return false;
    if (selector.stopId !== null && !index.stopPatterns.get(selector.stopId)?.has(trip[6]))
      return false;
    const requestedTrip = selectedTrips.some(
      ({ ref }) =>
        ref.tripId === trip[0] &&
        (selector.serviceDate === null || selector.serviceDate === ref.serviceDate),
    );
    const requestedStop = query.stopIds.some(
      (stopId) =>
        (selector.stopId === null || selector.stopId === stopId) &&
        index.stopPatterns.get(stopId)?.has(trip[6]),
    );
    return requestedTrip || requestedStop || routeIds.has(routeId);
  });
}

export function normalizeAlerts(
  feed: Bindings.transit_realtime.FeedMessage,
  schedule: Schedule,
  index: StaticIndex,
  query: RealtimeQuery,
  now: number,
  issues: Issues,
): LiveAlert[] {
  const result: LiveAlert[] = [];
  const candidates = schedule.trips.filter((trip) =>
    relevant(
      {
        tripId: trip[0],
        routeId: schedule.routes[trip[1]][0],
        serviceDate: '',
        startTime: null,
        directionId: trip[4],
      },
      trip,
      index,
      { ...query, trips: query.trips.map((ref) => ({ ...ref, serviceDate: '' })) },
    ),
  );
  for (const entity of feed.entity) {
    const alert = entity.alert;
    if (!alert || entity.isDeleted) continue;
    const activePeriods = (alert.activePeriod ?? []).map((period) => ({
      start: own(period, 'start') ? numeric(period.start) : null,
      end: own(period, 'end') ? numeric(period.end) : null,
    }));
    if (
      activePeriods.some(
        (period) => period.start !== null && period.end !== null && period.start > period.end,
      )
    ) {
      issues.invalidEntities++;
      continue;
    }
    if (
      activePeriods.length &&
      !activePeriods.some(
        (period) =>
          (period.start === null || period.start * 1000 <= now) &&
          (period.end === null || period.end * 1000 > now),
      )
    )
      continue;
    const selectors: LiveAlertSelector[] = [];
    for (const selector of alert.informedEntity ?? []) {
      if (own(selector, 'agencyId') && selector.agencyId) {
        issues.invalidEntities++;
        continue;
      }
      const date =
        selector.trip && own(selector.trip, 'startDate')
          ? serviceDate(selector.trip.startDate ?? '')
          : null;
      if (selector.trip && own(selector.trip, 'startDate') && date === null) {
        issues.invalidEntities++;
        continue;
      }
      const normalized = {
        routeId: own(selector, 'routeId') ? (selector.routeId ?? null) : null,
        stopId: own(selector, 'stopId') ? (selector.stopId ?? null) : null,
        tripId:
          selector.trip && own(selector.trip, 'tripId') ? (selector.trip.tripId ?? null) : null,
        serviceDate: date,
        directionId: own(selector, 'directionId')
          ? numeric(selector.directionId)
          : selector.trip && own(selector.trip, 'directionId')
            ? numeric(selector.trip.directionId)
            : null,
      };
      if (selector.trip && own(selector.trip, 'routeId')) {
        if (normalized.routeId !== null && normalized.routeId !== selector.trip.routeId) {
          issues.invalidEntities++;
          continue;
        }
        normalized.routeId = selector.trip.routeId ?? null;
      }
      if (selectorMatches(normalized, query, schedule, index, candidates))
        selectors.push(normalized);
    }
    if ((alert.informedEntity?.length ?? 0) > 0 && selectors.length === 0) continue;
    if (result.length >= 40) {
      issues.truncated = true;
      continue;
    }
    result.push({
      id: entity.id.slice(0, 150),
      activePeriods: activePeriods.slice(0, 20).map((period) => ({
        start: period.start === null ? null : period.start * 1000,
        end: period.end === null ? null : period.end * 1000,
      })),
      selectors: selectors.slice(0, 30),
      cause: own(alert, 'cause') ? numeric(alert.cause) : null,
      effect: own(alert, 'effect') ? numeric(alert.effect) : null,
      header: translated(alert.headerText, 500, issues),
      description: translated(alert.descriptionText, 3000, issues),
      url: translated(alert.url, 500, issues) || null,
    });
    if (activePeriods.length > 20 || selectors.length > 30) issues.truncated = true;
  }
  return result;
}
