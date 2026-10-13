import { createHash, timingSafeEqual } from 'node:crypto';
import { addDays, isRealDate } from '../generated/core/dates.ts';
import { agencyDate, type Schedule } from '../generated/transit/schedule.ts';
import {
  REALTIME_MAX_RESPONSE_BYTES,
  type RealtimeQuery,
  type RealtimeResponse,
} from '../generated/transit/realtime-contract.ts';
import {
  indexes,
  normalizeAlerts,
  normalizeTrips,
  normalizeVehicles,
  type StaticIndex,
} from './normalize.ts';
import { readBounded, Sources } from './source.ts';

const QUERY_KEYS = [
  'includeReportedTrips',
  'schema',
  'staticVersion',
  'staticSourceSha256',
  'stopIds',
  'trips',
  'routeIds',
];

function identifiers(value: unknown, maximum: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    new Set(value).size === value.length &&
    value.every((id) => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(id))
  );
}

export function validateQuery(
  raw: unknown,
  schedule: Schedule,
  index: StaticIndex,
  now: number,
): RealtimeQuery {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_query');
  const value = raw as RealtimeQuery;
  if (
    Object.keys(value).some((key) => !QUERY_KEYS.includes(key)) ||
    value.schema !== 1 ||
    (value.includeReportedTrips !== undefined && value.includeReportedTrips !== true) ||
    typeof value.staticVersion !== 'string' ||
    value.staticVersion.length < 1 ||
    value.staticVersion.length > 200 ||
    typeof value.staticSourceSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.staticSourceSha256) ||
    !identifiers(value.stopIds, 8) ||
    !identifiers(value.routeIds, 4) ||
    !Array.isArray(value.trips) ||
    value.trips.length > 4 ||
    !value.trips.every(
      (trip) =>
        trip &&
        typeof trip === 'object' &&
        Object.keys(trip).every((key) => key === 'tripId' || key === 'serviceDate') &&
        identifiers([trip.tripId], 1) &&
        typeof trip.serviceDate === 'string' &&
        isRealDate(trip.serviceDate),
    ) ||
    new Set(value.trips.map((trip) => `${trip.tripId}/${trip.serviceDate}`)).size !==
      value.trips.length ||
    value.stopIds.length + value.routeIds.length + value.trips.length === 0
  )
    throw new Error('invalid_query');
  if (
    value.staticVersion !== schedule.feedVersion ||
    value.staticSourceSha256 !== schedule.sourceSha256
  )
    return value;
  const day = agencyDate(now);
  if (
    value.stopIds.some((stop) => !index.stops.has(stop)) ||
    value.routeIds.some((route) => !index.routes.has(route)) ||
    value.trips.some((ref) => {
      const trip = index.trips.get(ref.tripId);
      return !trip || ref.serviceDate < addDays(day, -2) || ref.serviceDate > addDays(day, 1);
    })
  )
    throw new Error('unknown_or_inactive_identifier');
  return value;
}

export async function buildResponse(
  schedule: Schedule,
  sources: Sources,
  query: RealtimeQuery,
  now: number,
  index = indexes(schedule),
): Promise<RealtimeResponse> {
  const compatible =
    query.staticVersion === schedule.feedVersion &&
    query.staticSourceSha256 === schedule.sourceSha256;
  const emptyHealth = {
    status: 'error' as const,
    feedTimestamp: null,
    fetchedAt: null,
    error: 'static_mismatch',
  };
  const result: RealtimeResponse = {
    schema: 1,
    generatedAt: now,
    staticVersion: schedule.feedVersion,
    staticSourceSha256: schedule.sourceSha256,
    staticCompatible: compatible,
    health: { trips: { ...emptyHealth }, vehicles: { ...emptyHealth }, alerts: { ...emptyHealth } },
    tripUpdates: [],
    vehicles: [],
    alerts: [],
    issues: { unmatchedTrips: 0, ambiguousStops: 0, invalidEntities: 0, truncated: false },
  };
  if (!compatible) return result;
  const [trips, vehicles, alerts] = await Promise.all([
    sources.get('trips'),
    sources.get('vehicles'),
    sources.get('alerts'),
  ]);
  result.health = { trips: trips.health, vehicles: vehicles.health, alerts: alerts.health };
  const feeds = { trips, vehicles, alerts };
  for (const source of ['trips', 'vehicles', 'alerts'] as const) {
    const feed = feeds[source].feed;
    if (
      feed &&
      Object.hasOwn(feed.header, 'feedVersion') &&
      feed.header.feedVersion !== schedule.feedVersion
    ) {
      result.health[source] = {
        ...result.health[source],
        status: 'error',
        error: 'static_feed_mismatch',
      };
      feeds[source].feed = null;
    }
  }
  if (trips.feed)
    result.tripUpdates = normalizeTrips(trips.feed, schedule, index, query, now, result.issues);
  if (vehicles.feed)
    result.vehicles = normalizeVehicles(vehicles.feed, schedule, index, query, now, result.issues);
  if (alerts.feed)
    result.alerts = normalizeAlerts(alerts.feed, schedule, index, query, now, result.issues);
  while (Buffer.byteLength(JSON.stringify(result)) > REALTIME_MAX_RESPONSE_BYTES) {
    result.issues.truncated = true;
    if (result.tripUpdates.length > 0) result.tripUpdates.pop();
    else if (result.alerts.length > 0) result.alerts.pop();
    else result.vehicles.pop();
  }
  return result;
}

export type ServiceConfig = { tokenHash: string | undefined; enabled: boolean; webOrigin?: string };

export function createHandler(
  schedule: Schedule,
  sources: Sources,
  config: ServiceConfig,
  now: () => number = Date.now,
) {
  const index = indexes(schedule);
  let windowStart = 0;
  let requests = 0;
  return async (request: Request): Promise<Response> => {
    const headers: Record<string, string> = {
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    };
    if (config.webOrigin && request.headers.get('origin') === config.webOrigin) {
      headers['access-control-allow-origin'] = config.webOrigin;
      headers.vary = 'Origin';
      headers['access-control-allow-methods'] = 'POST, OPTIONS';
      headers['access-control-allow-headers'] = 'authorization, content-type';
    }
    const error = (reason: string, status: number) =>
      Response.json({ error: reason }, { status, headers });
    if (!config.enabled || !config.tokenHash || !/^[a-f0-9]{64}$/.test(config.tokenHash))
      return error('service_disabled', 503);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const token = request.headers.get('authorization') ?? '';
    if (
      !/^Bearer [A-Za-z0-9_-]{32,128}$/.test(token) ||
      !timingSafeEqual(
        createHash('sha256').update(token.slice(7)).digest(),
        Buffer.from(config.tokenHash, 'hex'),
      )
    )
      return error('unauthorized', 401);
    if (request.method !== 'POST') return error('method_not_allowed', 405);
    if (new URL(request.url).search) return error('query_parameters_not_allowed', 400);
    const at = now();
    if (at - windowStart >= 60_000) {
      windowStart = at;
      requests = 0;
    }
    if (++requests > 12) {
      headers['retry-after'] = String(Math.max(1, Math.ceil((windowStart + 60_000 - at) / 1000)));
      return error('request_limit', 429);
    }
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? ''))
      return error('json_required', 415);
    let timer: ReturnType<typeof setTimeout>;
    let query: RealtimeQuery;
    try {
      const bytes = await Promise.race([
        readBounded(new Response(request.body, { headers: request.headers }), 4096),
        new Promise<Uint8Array>((_, reject) => {
          timer = setTimeout(() => reject(new Error('request_timeout')), 3000);
        }),
      ]);
      query = validateQuery(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        schedule,
        index,
        at,
      );
    } catch (failure) {
      return error(
        failure instanceof Error && failure.message === 'payload_too_large'
          ? 'payload_too_large'
          : 'invalid_query',
        400,
      );
    } finally {
      clearTimeout(timer!);
    }
    const start = performance.now();
    const result = await buildResponse(schedule, sources, query, at, index);
    const body = JSON.stringify(result);
    console.info(
      JSON.stringify({
        event: 'transit_live',
        bytes: Buffer.byteLength(body),
        elapsedMs: Math.round(performance.now() - start),
        health: Object.fromEntries(
          Object.entries(result.health).map(([source, health]) => [source, health.status]),
        ),
      }),
    );
    return new Response(body, { headers: { ...headers, 'content-type': 'application/json' } });
  };
}
