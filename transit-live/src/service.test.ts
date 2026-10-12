import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import Bindings from 'gtfs-realtime-bindings';
import { SCHEDULE_SOURCE, validateSchedule } from '../generated/transit/schedule.ts';
import type { RealtimeQuery, RealtimeResponse } from '../generated/transit/realtime-contract.ts';
import {
  decodeFeed,
  indexes,
  normalizeAlerts,
  normalizeTrips,
  normalizeVehicles,
} from './normalize.ts';
import { buildResponse, createHandler, validateQuery } from './service.ts';
import { readBounded, Sources, UPSTREAMS, type SharedCache, type Snapshot } from './source.ts';

const now = Date.parse('2026-10-11T20:00:00Z');
const seconds = now / 1000;
const schedule = validateSchedule({
  schema: 2,
  source: SCHEDULE_SOURCE,
  sourceSha256: 'a'.repeat(64),
  createdAt: now,
  feedVersion: 'fixture',
  timezone: 'America/Toronto',
  validFrom: '2026-09-28',
  validTo: '2026-11-28',
  stops: [
    ['A', '', 'First', 43, -81],
    ['B', '', 'Second', 43.001, -81.001],
  ],
  routes: [
    ['02', '2', 'North', ''],
    ['2', '2', 'Other', ''],
  ],
  services: [['S', 127, '2026-09-28', '2026-11-28']],
  exceptions: [],
  patterns: [
    [
      [0, 1, 0, 0, 0, 0, 1, ''],
      [1, 2, 60, 60, 0, 0, 1, ''],
      [0, 3, 120, 120, 0, 0, 1, ''],
    ],
  ],
  trips: [
    ['T', 0, 'S', 'North', 0, '', 0, 57_600],
    ['U', 1, 'S', 'Other', 1, '', 0, 57_600],
  ],
  shapes: {},
  transfers: [],
});
const index = indexes(schedule);
const query: RealtimeQuery = {
  schema: 1,
  staticVersion: schedule.feedVersion,
  staticSourceSha256: schedule.sourceSha256,
  stopIds: ['A'],
  trips: [{ tripId: 'T', serviceDate: '2026-10-11' }],
  routeIds: ['02'],
};
const issues = (): RealtimeResponse['issues'] => ({
  unmatchedTrips: 0,
  ambiguousStops: 0,
  invalidEntities: 0,
  truncated: false,
});
const descriptor = { tripId: 'T', routeId: '02', startDate: '20261011', startTime: '16:00:00' };
const encode = (
  entities: Bindings.transit_realtime.IFeedEntity[],
  header: Partial<Bindings.transit_realtime.IFeedHeader> = {},
) =>
  Uint8Array.from(
    Bindings.transit_realtime.FeedMessage.encode({
      header: { gtfsRealtimeVersion: '2.0', timestamp: seconds, ...header },
      entity: entities,
    }).finish(),
  );
const feed = (entities: Bindings.transit_realtime.IFeedEntity[]) =>
  decodeFeed(encode(entities), now);

class Cache implements SharedCache {
  values = new Map<string, Snapshot>();
  async get(key: string) {
    return structuredClone(this.values.get(key) ?? null);
  }
  async set(key: string, value: Snapshot) {
    this.values.set(key, structuredClone(value));
  }
}

test('binary decode preserves missing optional fields separately from explicit zero', () => {
  const parsed = feed([
    {
      id: 'one',
      tripUpdate: {
        trip: descriptor,
        timestamp: seconds,
        stopTimeUpdate: [
          { stopSequence: 1, arrival: { delay: 0, uncertainty: 0 } },
          { stopSequence: 3, arrival: {} },
        ],
      },
    },
  ]);
  const result = normalizeTrips(parsed, schedule, index, query, now, issues())[0];
  assert.deepEqual(result.stops[0].arrival, { delay: 0, uncertainty: 0, time: null });
  assert.deepEqual(result.stops[1].arrival, { delay: null, uncertainty: null, time: null });
  assert.equal(result.directionId, null);
  assert.equal(result.delay, null);
  const vehicles = normalizeVehicles(
    feed([{ id: 'v', vehicle: { trip: descriptor, position: { latitude: 43, longitude: -81 } } }]),
    schedule,
    index,
    query,
    now,
    issues(),
  );
  assert.equal(vehicles[0].status, null);
  assert.equal(vehicles[0].measuredAt, null);
});

test('keeps cancel and skipped status, predictions, source age and physical identity', () => {
  const result = normalizeTrips(
    feed([
      {
        id: 'one',
        tripUpdate: {
          trip: { ...descriptor, scheduleRelationship: 3 },
          timestamp: seconds - 100,
          vehicle: { id: 'BUS' },
          stopTimeUpdate: [
            {
              stopId: 'A',
              stopSequence: 3,
              scheduleRelationship: 1,
              arrival: { time: seconds + 60, delay: 90 },
            },
          ],
        },
      },
    ]),
    schedule,
    index,
    query,
    now,
    issues(),
  )[0];
  assert.equal(result.relationship, 'canceled');
  assert.equal(result.stops[0].relationship, 'skipped');
  assert.equal(result.stops[0].arrival?.time, now + 60_000);
  assert.equal(result.vehicleId, 'BUS');
  assert.equal(result.measuredAt, now - 100_000);
});

test('strict joins reject wrong leading zero, start, invalid date and unknown trip', () => {
  const invalid = [
    { ...descriptor, routeId: '2' },
    { ...descriptor, startTime: '17:00:00' },
    { ...descriptor, startDate: '20260231' },
    { ...descriptor, tripId: 'not-known' },
    { ...descriptor, startDate: '20260927' },
  ];
  const counts = issues();
  const result = normalizeTrips(
    feed(invalid.map((trip, i) => ({ id: String(i), tripUpdate: { trip, timestamp: seconds } }))),
    schedule,
    index,
    query,
    now,
    counts,
  );
  assert.equal(result.length, 0);
  assert.equal(counts.unmatchedTrips, invalid.length);
});

test('a direction that contradicts the trip ID is dropped, not the trip', () => {
  const counts = issues();
  const [contradicted, agreeing] = [1, 0].map(
    (directionId) =>
      normalizeTrips(
        feed([
          {
            id: 'one',
            tripUpdate: {
              trip: { ...descriptor, directionId },
              timestamp: seconds,
              stopTimeUpdate: [{ stopSequence: 1, departure: { delay: 60 } }],
            },
          },
        ]),
        schedule,
        index,
        query,
        now,
        counts,
      )[0],
  );
  assert.equal(contradicted.directionId, null);
  assert.equal(contradicted.stops[0].departure?.delay, 60);
  assert.equal(agreeing.directionId, 0);
  const vehicles = normalizeVehicles(
    feed([{ id: 'v', vehicle: { trip: { ...descriptor, directionId: 11 }, timestamp: seconds } }]),
    schedule,
    index,
    query,
    now,
    counts,
  );
  assert.equal(vehicles[0].directionId, null);
  assert.equal(counts.unmatchedTrips, 0);
});

test('a repeated trip keeps the copy that names the bus, and two buses leave neither', () => {
  const restated = {
    id: 'T',
    tripUpdate: {
      trip: descriptor,
      timestamp: seconds,
      stopTimeUpdate: [{ stopSequence: 1, departure: { time: seconds } }],
    },
  };
  const tracked = {
    id: 'T',
    tripUpdate: {
      ...restated.tripUpdate,
      timestamp: seconds - 20,
      vehicle: { id: 'BUS' },
      stopTimeUpdate: [{ stopSequence: 1, departure: { time: seconds + 87, delay: 87 } }],
    },
  };
  for (const order of [
    [restated, tracked],
    [tracked, restated],
  ]) {
    const result = normalizeTrips(feed(order), schedule, index, query, now, issues());
    assert.equal(result.length, 1);
    assert.equal(result[0].vehicleId, 'BUS');
    assert.equal(result[0].stops[0].departure?.delay, 87);
  }
  const counts = issues();
  const other = { ...tracked, tripUpdate: { ...tracked.tripUpdate, vehicle: { id: 'OTHER' } } };
  assert.equal(
    normalizeTrips(feed([tracked, restated, other]), schedule, index, query, now, counts).length,
    0,
  );
  assert.equal(counts.unmatchedTrips, 1);
});

test('loop stop occurrence must have unique sequence and both IDs must agree', () => {
  const counts = issues();
  const result = normalizeTrips(
    feed([
      {
        id: 'one',
        tripUpdate: {
          trip: descriptor,
          timestamp: seconds,
          stopTimeUpdate: [
            { stopId: 'A', arrival: { time: seconds } },
            { stopId: 'A', stopSequence: 2, arrival: { time: seconds } },
            { stopId: 'A', stopSequence: 3, arrival: { time: seconds } },
          ],
        },
      },
    ]),
    schedule,
    index,
    query,
    now,
    counts,
  );
  assert.equal(counts.ambiguousStops, 2);
  assert.deepEqual(
    result[0].stops.map((stop) => stop.stopSequence),
    [3],
  );
});

test('rejects future measured timestamps and unsupported vehicle trip relationships', () => {
  const counts = issues();
  const result = normalizeVehicles(
    feed([
      { id: 'future', vehicle: { trip: descriptor, timestamp: seconds + 31 } },
      {
        id: 'added',
        vehicle: { trip: { ...descriptor, scheduleRelationship: 1 }, timestamp: seconds },
      },
      {
        id: 'invalid',
        vehicle: {
          trip: descriptor,
          timestamp: seconds,
          position: { latitude: 500, longitude: -81 },
        },
      },
      {
        id: 'zero',
        vehicle: {
          trip: descriptor,
          timestamp: seconds,
          currentStatus: 0,
          position: { latitude: 0, longitude: 0, bearing: 360, speed: 0 },
        },
      },
    ]),
    schedule,
    index,
    query,
    now,
    counts,
  );
  assert.equal(result.length, 1);
  assert.equal(counts.invalidEntities, 3);
  assert.equal(result[0].status, 'incoming');
  assert.equal(result[0].position?.bearing, 0);
  assert.equal(result[0].position?.speed, 0);
});

test('alerts use AND within selector, OR between selectors, original text and active periods', () => {
  const alert = { descriptionText: { translation: [{ text: 'Actual detour', language: 'en' }] } };
  const result = normalizeAlerts(
    feed([
      {
        id: 'wrong-combination',
        alert: { ...alert, informedEntity: [{ routeId: '2', stopId: 'A' }] },
      },
      {
        id: 'or',
        alert: {
          ...alert,
          informedEntity: [{ routeId: '2' }, { routeId: '02', stopId: 'A' }],
          activePeriod: [{ start: seconds - 60 }],
        },
      },
      {
        id: 'expired',
        alert: {
          ...alert,
          informedEntity: [{ routeId: '02' }],
          activePeriod: [{ end: seconds - 1 }],
        },
      },
      {
        id: 'future',
        alert: {
          ...alert,
          informedEntity: [{ routeId: '02' }],
          activePeriod: [{ start: seconds + 1 }],
        },
      },
      { id: 'global', alert },
    ]),
    schedule,
    index,
    { ...query, stopIds: [] },
    now,
    issues(),
  );
  assert.deepEqual(
    result.map((item) => item.id),
    ['or', 'global'],
  );
  assert.equal(result[0].description, 'Actual detour');
  assert.deepEqual(result[0].activePeriods, [{ start: now - 60_000, end: null }]);
});

test('differential, corrupt and future-header feeds fail explicitly', () => {
  assert.throws(() => decodeFeed(encode([], { incrementality: 1 }), now), /unsupported_feed/);
  assert.throws(
    () => decodeFeed(encode([], { timestamp: seconds + 31 }), now),
    /invalid_feed_timestamp/,
  );
  assert.throws(() => decodeFeed(new Uint8Array([255, 255]), now));
});

test('query surface rejects arbitrary URLs, unknown IDs, duplicates, oversize and inactive dates', () => {
  for (const invalid of [
    { ...query, url: 'http://localhost' },
    { ...query, stopIds: ['UNKNOWN'] },
    { ...query, stopIds: ['A', 'A'] },
    { ...query, stopIds: Array.from({ length: 9 }, (_, i) => String(i)) },
    { ...query, trips: [{ tripId: 'T', serviceDate: '2026-10-16' }] },
    { ...query, stopIds: [], routeIds: [], trips: [] },
    { ...query, schema: 2 },
  ])
    assert.throws(() => validateQuery(invalid, schedule, index, now));
  assert.deepEqual(validateQuery(query, schedule, index, now), query);
});

test('static mismatch does not contact upstream or join unknown IDs', async () => {
  let calls = 0;
  const sources = new Sources(
    new Cache(),
    async () => {
      calls++;
      throw new Error('unexpected');
    },
    () => now,
  );
  const mismatch = { ...query, staticVersion: 'other', stopIds: ['unknown'] };
  validateQuery(mismatch, schedule, index, now);
  const result = await buildResponse(schedule, sources, mismatch, now);
  assert.equal(result.staticCompatible, false);
  assert.equal(result.health.trips.error, 'static_mismatch');
  assert.equal(calls, 0);
});

test('two distinct service instances reuse fixed shared source keys for mixed queries', async () => {
  const cache = new Cache();
  let calls = 0;
  const fetcher: typeof fetch = async (url) => {
    assert.ok(Object.values(UPSTREAMS).includes(String(url)));
    calls++;
    return new Response(
      encode([{ id: 'one', tripUpdate: { trip: descriptor, timestamp: seconds } }]),
    );
  };
  await buildResponse(schedule, new Sources(cache, fetcher, () => now), query, now);
  const result = await buildResponse(
    schedule,
    new Sources(cache, fetcher, () => now),
    { ...query, stopIds: ['B'] },
    now,
  );
  assert.equal(calls, 3);
  assert.equal(cache.values.size, 3);
  assert.equal(result.health.trips.feedTimestamp, now);
  assert.equal(result.tripUpdates[0].measuredAt, now);
});

test('same-instance concurrent queries coalesce while separate cold misses remain explicit', async () => {
  let calls = 0;
  let release: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetcher: typeof fetch = async () => {
    calls++;
    await gate;
    return new Response(encode([]));
  };
  const cache = new Cache();
  const a = new Sources(cache, fetcher, () => now);
  const p1 = a.get('trips');
  const p2 = a.get('trips');
  const p3 = new Sources(cache, fetcher, () => now).get('trips');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  release!();
  await Promise.all([p1, p2, p3]);
});

test('conditional 304 preserves original fetch, feed and entity timestamps', async () => {
  let at = now;
  let calls = 0;
  const sources = new Sources(
    new Cache(),
    async (_url, init) => {
      calls++;
      if (calls === 1)
        return new Response(
          encode([{ id: 'one', tripUpdate: { trip: descriptor, timestamp: seconds - 60 } }]),
          { headers: { etag: 'known' } },
        );
      assert.equal(new Headers(init?.headers).get('if-none-match'), 'known');
      return new Response(null, { status: 304 });
    },
    () => at,
  );
  await sources.get('trips');
  at += 31_000;
  const cached = await sources.get('trips');
  assert.equal(calls, 2);
  assert.equal(cached.health.fetchedAt, now);
  assert.equal(cached.health.feedTimestamp, now);
  assert.equal(cached.feed!.entity[0].tripUpdate!.timestamp!.toString(), String(seconds - 60));
});

test('partial source failure and a malformed refresh retain successful public data', async () => {
  let at = now;
  let broken = false;
  const sources = new Sources(
    new Cache(),
    async (url) => {
      if (String(url) === UPSTREAMS.vehicles) return new Response(null, { status: 503 });
      return new Response(
        broken
          ? new Uint8Array([255])
          : encode([{ id: 'one', tripUpdate: { trip: descriptor, timestamp: seconds } }]),
      );
    },
    () => at,
  );
  const result = await buildResponse(schedule, sources, query, now);
  assert.equal(result.health.vehicles.status, 'error');
  assert.equal(result.health.trips.status, 'ok');
  assert.equal(result.tripUpdates.length, 1);
  at += 31_000;
  broken = true;
  const failed = await sources.get('trips');
  assert.equal(failed.health.status, 'error');
  assert.equal(failed.health.fetchedAt, now);
  assert.equal(failed.feed!.entity.length, 1);
});

test('HTTP quota pauses upstream retries across fresh instances', async () => {
  let calls = 0;
  const cache = new Cache();
  const fetcher: typeof fetch = async () => {
    calls++;
    return new Response(null, { status: 429, headers: { 'retry-after': '120' } });
  };
  const first = await new Sources(cache, fetcher, () => now).get('trips');
  assert.equal(first.health.error, 'upstream_quota');
  await new Sources(cache, fetcher, () => now + 60_000).get('trips');
  assert.equal(calls, 1);
});

test('alerts LTC last changed hours ago stay current after a successful check; trips do not', async () => {
  const sources = new Sources(
    new Cache(),
    async () => new Response(encode([], { timestamp: seconds - 6 * 3600 })),
    () => now,
  );
  const alerts = await sources.get('alerts');
  assert.equal(alerts.health.status, 'ok');
  assert.equal(alerts.health.feedTimestamp, now - 6 * 3_600_000);
  assert.equal((await sources.get('trips')).health.status, 'stale');
});

test('declared realtime static version mismatch isolates only that source', async () => {
  const sources = new Sources(
    new Cache(),
    async (url) =>
      new Response(
        encode(
          [{ id: 'one', tripUpdate: { trip: descriptor, timestamp: seconds } }],
          String(url) === UPSTREAMS.trips ? { feedVersion: 'different' } : {},
        ),
      ),
    () => now,
  );
  const result = await buildResponse(schedule, sources, query, now);
  assert.equal(result.health.trips.error, 'static_feed_mismatch');
  assert.equal(result.tripUpdates.length, 0);
  assert.equal(result.health.vehicles.status, 'ok');
});

test('payload limit applies to declared and streaming sizes', async () => {
  await assert.rejects(
    () =>
      readBounded(new Response(new Uint8Array(3), { headers: { 'content-length': '100' } }), 10),
    /payload_too_large/,
  );
  await assert.rejects(
    () => readBounded(new Response(new Uint8Array(11)), 10),
    /payload_too_large/,
  );
});

test('handler credential, method, shutdown, body and request limiting avoid upstream work', async () => {
  let calls = 0;
  const sources = new Sources(
    new Cache(),
    async () => {
      calls++;
      return new Response(encode([]));
    },
    () => now,
  );
  const token = 'c'.repeat(64);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const handler = createHandler(schedule, sources, { tokenHash, enabled: true }, () => now);
  const request = (body: unknown = query, auth = `Bearer ${token}`, method = 'POST') =>
    new Request('https://fixture.example/api/live', {
      method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    });
  assert.equal((await handler(request(query, 'Bearer wrong'))).status, 401);
  assert.equal((await handler(request(query, `Bearer ${token}`, 'GET'))).status, 405);
  assert.equal(
    (await handler(request({ ...query, upstream: 'https://evil.example' }))).status,
    400,
  );
  assert.equal(calls, 0);
  const disabled = createHandler(schedule, sources, { tokenHash, enabled: false }, () => now);
  assert.equal((await disabled(request())).status, 503);
  const unconfigured = createHandler(
    schedule,
    sources,
    { tokenHash: undefined, enabled: true },
    () => now,
  );
  assert.equal((await unconfigured(request())).status, 503);
  for (let i = 0; i < 11; i++) assert.equal((await handler(request())).status, 200);
  assert.equal((await handler(request())).status, 429);
  assert.equal(calls, 3);
});
