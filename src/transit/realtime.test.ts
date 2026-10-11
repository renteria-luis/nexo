import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';

import { scheduleFixture } from './fixtures.ts';
import { scheduledTime, type Departure } from './schedule.ts';
import {
  buildLiveQuery,
  createLiveClient,
  createTransitLiveConfigStore,
  fetchLiveSnapshot,
  LIVE_LOCAL_MAX_AGE_MS,
  LIVE_MANUAL_MIN_MS,
  liveFreshness,
  mergeLiveDeparture,
  relevantLiveAlerts,
  tripLiveDetail,
  validateLiveQuery,
  validateLiveSnapshot,
  validateTransitLiveConfig,
  type LiveCacheStorage,
  type LiveSnapshot,
  type TransitLiveState,
} from './realtime.ts';
import { REALTIME_MAX_RESPONSE_BYTES } from './realtime-contract.ts';

const NOW = scheduledTime('2026-10-11', 8 * 3_600) - 60_000;
const CONFIG = {
  endpoint: 'https://fixture.vercel.app/api/live',
  credential: 'fixture-installation-placeholder-32',
};

function fixture() {
  const schedule = scheduleFixture();
  const trip = schedule.trips[1];
  const departure: Departure = {
    trip,
    route: schedule.routes[0],
    stopTime: schedule.patterns[0][0],
    serviceDate: '2026-10-11',
    at: scheduledTime('2026-10-11', trip[7]),
  };
  const query = buildLiveQuery(schedule, {
    stopIds: ['A'],
    trips: [{ tripId: trip[0], serviceDate: departure.serviceDate }],
  });
  const health = {
    status: 'ok' as const,
    feedTimestamp: NOW - 5_000,
    fetchedAt: NOW - 3_000,
    error: null,
  };
  const snapshot: LiveSnapshot = {
    schema: 1,
    generatedAt: NOW,
    staticVersion: schedule.feedVersion,
    staticSourceSha256: schedule.sourceSha256,
    staticCompatible: true,
    health: { trips: { ...health }, vehicles: { ...health }, alerts: { ...health } },
    tripUpdates: [
      {
        tripId: trip[0],
        routeId: '02',
        serviceDate: departure.serviceDate,
        directionId: 1,
        startTime: '08:00:00',
        entityId: 'update-1',
        vehicleId: 'bus-1',
        measuredAt: NOW - 10_000,
        relationship: 'scheduled',
        delay: null,
        stops: [
          {
            stopId: 'A',
            stopSequence: 1,
            relationship: 'scheduled',
            arrival: null,
            departure: { time: departure.at + 90_000, delay: null, uncertainty: null },
          },
        ],
      },
    ],
    vehicles: [
      {
        tripId: trip[0],
        routeId: '02',
        serviceDate: departure.serviceDate,
        directionId: 1,
        startTime: '08:00:00',
        entityId: 'position-1',
        vehicleId: 'bus-1',
        measuredAt: NOW - 15_000,
        stopId: 'A',
        stopSequence: 1,
        status: 'incoming',
        position: { lat: 43, lng: -81, bearing: null, speed: null },
      },
    ],
    alerts: [],
    issues: { unmatchedTrips: 0, ambiguousStops: 0, invalidEntities: 0, truncated: false },
  };
  return { schedule, departure, query, snapshot };
}

const response = (snapshot: LiveSnapshot) =>
  new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json' } });
const flush = async () => {
  await setImmediate();
  await setImmediate();
};

test('live configuration requires explicit HTTPS endpoint and installation credential', () => {
  assert.deepEqual(validateTransitLiveConfig(CONFIG), CONFIG);
  for (const endpoint of [
    'http://fixture.vercel.app/api/live',
    'https://user:pass@fixture.vercel.app/api/live',
    `${CONFIG.endpoint}?url=http://upstream.invalid`,
    `${CONFIG.endpoint}#secret`,
    'https://fixture.vercel.app/other',
    'https://localhost/api/live',
  ]) {
    assert.throws(() => validateTransitLiveConfig({ ...CONFIG, endpoint }), /HTTPS/);
  }
  assert.throws(() => validateTransitLiveConfig({ ...CONFIG, credential: 'short' }), /clave/);
  assert.throws(
    () => validateTransitLiveConfig({ ...CONFIG, credential: 'x'.repeat(33) + '\r\nHeader' }),
    /clave/,
  );
});

test('config store serializes writes, retains old config on failure and reports corruption', async () => {
  let stored: string | null = null;
  let fail = false;
  const store = createTransitLiveConfigStore({
    read: async () => stored,
    write: async (content) => {
      if (fail) throw new Error('disk');
      stored = content;
    },
    remove: async () => {
      stored = null;
    },
  });
  assert.equal(await store.load(), null);
  await store.save(CONFIG);
  fail = true;
  await assert.rejects(
    store.save({ ...CONFIG, credential: 'another-placeholder-credential-32' }),
    /conserva la anterior/,
  );
  assert.deepEqual(await store.load(), CONFIG);
  stored = '{bad';
  await assert.rejects(store.load(), /configurarla/);
  await store.clear();
  assert.equal(await store.load(), null);
});

test('query surface keeps leading zeros, calendars, finite size and known identifiers', () => {
  const { schedule, query } = fixture();
  assert.deepEqual(validateLiveQuery(query, schedule), query);
  assert.throws(() => validateLiveQuery({ ...query, routeIds: ['2'] }, schedule), /línea/);
  assert.throws(
    () => validateLiveQuery({ ...query, upstream: 'http://private.invalid' }, schedule),
    /parámetros/,
  );
  assert.throws(
    () =>
      validateLiveQuery(
        { ...query, trips: [{ tripId: 'weekend-trip', serviceDate: '2026-10-12' }] },
        schedule,
      ),
    /sin servicio/,
  );
  assert.throws(
    () => validateLiveQuery({ ...query, stopIds: Array(9).fill('A') }, schedule),
    /grande/,
  );
  assert.throws(() => buildLiveQuery(schedule, {}), /vacía/);
});

test('snapshot validates source/entity times, explicit absent fields and exact static identity', () => {
  const { schedule, query, snapshot } = fixture();
  assert.equal(validateLiveSnapshot(snapshot, schedule, query, NOW), snapshot);
  for (const mutate of [
    (s: LiveSnapshot) => {
      s.tripUpdates[0].measuredAt = NOW + 31_000;
    },
    (s: LiveSnapshot) => {
      delete (s.tripUpdates[0] as Partial<LiveSnapshot['tripUpdates'][number]>).directionId;
    },
    (s: LiveSnapshot) => {
      s.tripUpdates[0].routeId = '2';
    },
    (s: LiveSnapshot) => {
      s.tripUpdates[0].directionId = 0;
    },
    (s: LiveSnapshot) => {
      s.tripUpdates[0].startTime = '09:00:00';
    },
    (s: LiveSnapshot) => {
      s.tripUpdates[0].serviceDate = '2026-10-12';
    },
    (s: LiveSnapshot) => {
      s.tripUpdates[0].stops[0].stopSequence = 2;
    },
    (s: LiveSnapshot) => {
      s.tripUpdates[0].stops[0].departure!.uncertainty = -1;
    },
    (s: LiveSnapshot) => {
      s.vehicles[0].position!.lat = NaN;
    },
    (s: LiveSnapshot) => {
      s.staticSourceSha256 = 'b'.repeat(64);
    },
  ]) {
    const broken = structuredClone(snapshot);
    mutate(broken);
    assert.throws(() => validateLiveSnapshot(broken, schedule, query, NOW), /inválidos/);
  }
  snapshot.tripUpdates[0].directionId = null;
  snapshot.tripUpdates[0].startTime = null;
  snapshot.tripUpdates[0].stops[0].departure!.time = null;
  snapshot.tripUpdates[0].stops[0].departure!.delay = 0;
  snapshot.tripUpdates[0].stops[0].departure!.uncertainty = 0;
  assert.equal(
    validateLiveSnapshot(snapshot, schedule, query, NOW).tripUpdates[0].stops[0].departure!.delay,
    0,
  );
});

test('new HTTP response cannot refresh old measurements or unknown measurement time', () => {
  const { schedule, departure, snapshot } = fixture();
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).source, 'official');
  snapshot.tripUpdates[0].measuredAt = NOW - 91_000;
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).source, 'last-known');
  snapshot.tripUpdates[0].measuredAt = null;
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).status, 'stale');
  snapshot.tripUpdates[0].measuredAt = NOW;
  snapshot.health.trips.feedTimestamp = NOW - 91_000;
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).source, 'last-known');
  snapshot.generatedAt = NOW - LIVE_LOCAL_MAX_AGE_MS - 1;
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).source, 'schedule');
});

test('missing trip and NO_DATA stay schedule-only; canceled/skipped evidence preserves age', () => {
  const { schedule, departure, snapshot } = fixture();
  assert.equal(mergeLiveDeparture(schedule, departure, null, NOW).status, 'schedule');
  snapshot.tripUpdates[0].stops[0].relationship = 'no_data';
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).status, 'no-data');
  snapshot.tripUpdates[0].stops[0].relationship = 'skipped';
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).status, 'skipped');
  snapshot.tripUpdates[0].relationship = 'canceled';
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).status, 'canceled');
  snapshot.tripUpdates[0].measuredAt = NOW - 120_000;
  const old = mergeLiveDeparture(schedule, departure, snapshot, NOW);
  assert.equal(old.status, 'stale');
  assert.equal(old.relationship, 'canceled');
});

test('a trip LTC lists without a bus, at its timetable time and no delay, reads as schedule', () => {
  const { schedule, departure, snapshot } = fixture();
  const update = snapshot.tripUpdates[0];
  update.vehicleId = null;
  update.stops[0].departure = { time: departure.at, delay: null, uncertainty: null };
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).status, 'unassigned');
  update.measuredAt = NOW - 120_000;
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).status, 'schedule');
  update.measuredAt = NOW - 10_000;
  update.stops[0].departure = { time: departure.at + 60_000, delay: null, uncertainty: null };
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).status, 'live');
  update.stops[0].departure = { time: null, delay: 0, uncertainty: null };
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).status, 'live');
  update.stops[0].departure = { time: departure.at, delay: null, uncertainty: null };
  update.vehicleId = 'bus-1';
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).status, 'live');
});

test('arrival-only predictions are labeled arrival; detail keeps arrival/departure sources distinct', () => {
  const { schedule, departure, snapshot } = fixture();
  const stop = snapshot.tripUpdates[0].stops[0];
  stop.arrival = { time: departure.at + 25_000, delay: null, uncertainty: null };
  stop.departure = null;
  const merged = mergeLiveDeparture(schedule, departure, snapshot, NOW);
  assert.equal(merged.at, stop.arrival.time);
  assert.equal(merged.source, 'official');
  assert.equal(merged.eventKind, 'arrival');
  const detail = tripLiveDetail(schedule, departure, snapshot, NOW);
  assert.equal(detail.stops[0].arrivalSource, 'official');
  assert.equal(detail.stops[0].departureSource, 'schedule');
  assert.equal(detail.stops[0].departureAt, departure.at);
  assert.deepEqual(
    detail.stops.map((s) => s.progress),
    ['passed', 'next'],
  );
  snapshot.vehicles[0].measuredAt = NOW - 100_000;
  const stale = tripLiveDetail(schedule, departure, snapshot, NOW);
  assert.equal(stale.bus, null, 'an old position does not place the bus');
  assert.deepEqual(
    stale.stops.map((s) => s.progress),
    ['upcoming', 'upcoming'],
    'the predictions still say the assigned bus has not reached the first stop',
  );
});

test('the bus sits where its GPS and the predictions put it, not at the stop number LTC reports', () => {
  const { schedule, departure, snapshot } = fixture();
  schedule.stops.push(['C', '12', 'Road far', 43.002, -81.002]);
  schedule.patterns[0].push([2, 3, 1_200, 1_200, 0, 0, 1, '']);
  const update = snapshot.tripUpdates[0];
  update.stops = [
    {
      stopId: 'B',
      stopSequence: 2,
      relationship: 'scheduled',
      arrival: null,
      departure: { time: NOW + 120_000, delay: 30, uncertainty: null },
    },
    {
      stopId: 'C',
      stopSequence: 3,
      relationship: 'scheduled',
      arrival: null,
      departure: { time: NOW + 600_000, delay: 30, uncertainty: null },
    },
  ];
  const vehicle = snapshot.vehicles[0];
  vehicle.stopId = 'C';
  vehicle.stopSequence = 3;
  vehicle.position = { lat: 43.00004, lng: -81.00004, bearing: null, speed: 8 };
  const detail = tripLiveDetail(schedule, departure, snapshot, NOW);
  assert.equal(detail.bus?.after, 0);
  assert.equal(detail.bus?.measured, true);
  assert.ok(detail.bus!.fraction > 0.3 && detail.bus!.fraction < 0.5);
  assert.deepEqual(
    detail.stops.map((s) => s.progress),
    ['passed', 'next', 'upcoming'],
  );
  vehicle.position = { lat: 44, lng: -80, bearing: null, speed: 8 };
  const off = tripLiveDetail(schedule, departure, snapshot, NOW);
  assert.equal(off.bus?.measured, false, 'a position off the trip falls back to the predictions');
  assert.equal(off.bus?.after, 0);
  assert.deepEqual(
    off.stops.map((s) => s.progress),
    ['passed', 'next', 'upcoming'],
  );
});

test('timestamp-absent cancellation uses current feed evidence without inventing an entity time', () => {
  const { schedule, departure, snapshot } = fixture();
  snapshot.tripUpdates[0].measuredAt = null;
  snapshot.tripUpdates[0].relationship = 'canceled';
  snapshot.tripUpdates[0].stops = [];
  const freshFact = mergeLiveDeparture(schedule, departure, snapshot, NOW);
  assert.equal(freshFact.status, 'canceled');
  assert.equal(freshFact.measuredAt, null);
  assert.equal(freshFact.reportedAt, snapshot.health.trips.feedTimestamp);
  assert.equal(freshFact.source, 'schedule');
  snapshot.health.trips.feedTimestamp = NOW - 120_000;
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).status, 'stale');
  snapshot.tripUpdates[0].relationship = 'scheduled';
  snapshot.tripUpdates[0].stops = fixture().snapshot.tripUpdates[0].stops;
  snapshot.health.trips.feedTimestamp = NOW;
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).source, 'last-known');
});

test('loop stops and changing physical vehicles match full trip/day/ordered sequence', () => {
  const { schedule, departure, snapshot, query } = fixture();
  schedule.patterns[0].push([0, 3, 1_200, 1_200, 0, 0, 1, '']);
  const repeated = {
    ...departure,
    stopTime: schedule.patterns[0][2],
    at: scheduledTime(departure.serviceDate, departure.trip[7] + 1_200),
  };
  snapshot.tripUpdates[0].stops.push({
    stopId: 'A',
    stopSequence: 3,
    relationship: 'scheduled',
    arrival: null,
    departure: { time: repeated.at + 120_000, delay: null, uncertainty: null },
  });
  validateLiveSnapshot(snapshot, schedule, query, NOW);
  assert.equal(mergeLiveDeparture(schedule, repeated, snapshot, NOW).at, repeated.at + 120_000);
  assert.equal(mergeLiveDeparture(schedule, departure, snapshot, NOW).at, departure.at + 90_000);
  snapshot.vehicles[0].tripId = 'weekday-late';
  assert.equal(tripLiveDetail(schedule, departure, snapshot, NOW).vehicles.length, 0);
});

test('official delay applies service-day arithmetic over 24:00 and both DST boundaries', () => {
  for (const day of ['2026-03-08', '2026-11-01']) {
    const { schedule, snapshot } = fixture();
    const trip = schedule.trips[1];
    trip[7] = 25 * 3_600;
    const at = scheduledTime(day, trip[7]);
    const departure: Departure = {
      trip,
      route: schedule.routes[0],
      stopTime: schedule.patterns[0][0],
      serviceDate: day,
      at,
    };
    snapshot.tripUpdates[0].serviceDate = day;
    snapshot.tripUpdates[0].startTime = '25:00:00';
    snapshot.tripUpdates[0].stops[0].departure = { time: null, delay: 60, uncertainty: null };
    snapshot.generatedAt = at - 30_000;
    snapshot.tripUpdates[0].measuredAt = at - 30_000;
    snapshot.health.trips.feedTimestamp = at - 30_000;
    assert.equal(mergeLiveDeparture(schedule, departure, snapshot, at - 20_000).at, at + 60_000);
  }
});

test('alerts combine selector fields and current periods, with separate alert freshness', () => {
  const { schedule, departure, snapshot } = fixture();
  snapshot.alerts = [
    {
      id: 'closure',
      activePeriods: [{ start: NOW - 1_000, end: NOW + 10_000 }],
      selectors: [
        { routeId: '02', stopId: 'B', tripId: null, serviceDate: null, directionId: null },
      ],
      cause: null,
      effect: 9,
      header: 'Closure',
      description: 'Actual source wording',
      url: null,
    },
  ];
  assert.equal(relevantLiveAlerts(schedule, departure, snapshot, NOW).length, 0);
  assert.equal(tripLiveDetail(schedule, departure, snapshot, NOW).alerts.length, 1);
  snapshot.alerts[0].selectors[0].directionId = 0;
  assert.equal(tripLiveDetail(schedule, departure, snapshot, NOW).alerts.length, 0);
  snapshot.alerts[0].selectors[0].directionId = null;
  assert.equal(tripLiveDetail(schedule, departure, snapshot, NOW + 10_000).alerts.length, 0);
  snapshot.health.alerts.feedTimestamp = NOW - 6 * 3_600_000;
  assert.equal(liveFreshness(snapshot, 'alerts', snapshot.generatedAt, NOW), true);
  assert.equal(liveFreshness(snapshot, 'alerts', snapshot.generatedAt, NOW + 601_000), false);
  assert.equal(liveFreshness(snapshot, 'trips', NOW - 300_000, NOW), false);
});

test('HTTPS fetch sends bounded public IDs only and rejects redirect, quota, oversized and malformed responses', async () => {
  const { schedule, query, snapshot } = fixture();
  let sent: RequestInit | undefined;
  const fetcher = (async (url, init) => {
    assert.equal(url, CONFIG.endpoint);
    sent = init;
    return response(snapshot);
  }) as typeof fetch;
  const received = await fetchLiveSnapshot(CONFIG, schedule, query, { fetcher, now: () => NOW });
  assert.deepEqual(received, snapshot);
  assert.equal(sent!.redirect, 'error');
  assert.equal(
    (sent!.headers as Record<string, string>).Authorization,
    `Bearer ${CONFIG.credential}`,
  );
  assert.equal(String(sent!.body).includes('lat'), false);
  const rejected = [
    new Response('', { status: 429 }),
    new Response('{broken'),
    new Response(
      JSON.stringify({
        ...snapshot,
        health: {
          ...snapshot.health,
          trips: { ...snapshot.health.trips, error: CONFIG.credential },
        },
      }),
    ),
    new Response('x'.repeat(REALTIME_MAX_RESPONSE_BYTES + 1)),
    new Response('{}', { headers: { 'content-length': String(REALTIME_MAX_RESPONSE_BYTES + 1) } }),
    new Response(
      JSON.stringify({
        ...snapshot,
        staticCompatible: false,
        staticVersion: 'other',
        tripUpdates: [],
        vehicles: [],
        alerts: [],
      }),
    ),
  ];
  for (const result of rejected)
    await assert.rejects(
      fetchLiveSnapshot(CONFIG, schedule, query, {
        fetcher: (async () => result) as typeof fetch,
        now: () => NOW,
      }),
    );
});

test('deadline and abort complete even when transport ignores AbortSignal', async () => {
  const { schedule, query } = fixture();
  await assert.rejects(
    fetchLiveSnapshot(CONFIG, schedule, query, {
      fetcher: (() => new Promise<Response>(() => {})) as typeof fetch,
      timeoutMs: 5,
    }),
    /tardó/,
  );
  const controller = new AbortController();
  const pending = fetchLiveSnapshot(CONFIG, schedule, query, {
    fetcher: (() => new Promise<Response>(() => {})) as typeof fetch,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, /cancelada/);
});

test('foreground controller polls useful queries, bounds manual taps, stops on blur and rejects late results', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  const { schedule, query, snapshot } = fixture();
  const states: TransitLiveState[] = [];
  let calls = 0;
  let hold: ((r: Response) => void) | undefined;
  const client = createLiveClient({
    schedule,
    config: CONFIG,
    onState: (state) => states.push(state),
    fetcher: (async () => {
      calls++;
      if (calls === 3)
        return await new Promise<Response>((resolve) => {
          hold = resolve;
        });
      return response(snapshot);
    }) as typeof fetch,
  });
  client.setQuery(query);
  await flush();
  assert.equal(calls, 0);
  client.setForeground(true);
  await flush();
  assert.equal(calls, 1);
  await client.refresh();
  assert.equal(calls, 1);
  t.mock.timers.tick(LIVE_MANUAL_MIN_MS);
  await flush();
  assert.equal(calls, 2);
  t.mock.timers.tick(45_000);
  await flush();
  assert.equal(calls, 3);
  client.setForeground(false);
  hold!(response(snapshot));
  await flush();
  const count = states.length;
  t.mock.timers.tick(300_000);
  await flush();
  assert.equal(calls, 3);
  assert.equal(states.length, count);
  assert.equal(client.getState().loading, false);
  assert.equal(client.getState().nextRefreshAt, null);
  client.dispose();
});

test('far departure gets one on-demand read, with no continuing poll', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  const { schedule, query, snapshot } = fixture();
  let calls = 0;
  const client = createLiveClient({
    schedule,
    config: CONFIG,
    onState: () => {},
    fetcher: (async () => {
      calls++;
      return response(snapshot);
    }) as typeof fetch,
  });
  client.setQuery(query, { departureAt: NOW + 2 * 3_600_000 });
  client.setForeground(true);
  await flush();
  assert.equal(calls, 1);
  assert.equal(client.getState().nextRefreshAt, null);
  t.mock.timers.tick(300_000);
  await flush();
  assert.equal(calls, 1);
  client.dispose();
});

test('opening a departure keeps the stop data and asks for the trip after five seconds', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  const { schedule, query, snapshot, departure } = fixture();
  const sent: { trips: unknown[] }[] = [];
  const client = createLiveClient({
    schedule,
    config: CONFIG,
    onState: () => {},
    fetcher: (async (_url, init) => {
      sent.push(JSON.parse(String(init!.body)));
      return response({ ...snapshot, generatedAt: Date.now() });
    }) as typeof fetch,
  });
  client.setQuery(buildLiveQuery(schedule, { stopIds: ['A'] }));
  client.setForeground(true);
  await flush();
  assert.equal(sent.length, 1);
  client.setQuery(query, { departureAt: departure.at });
  assert.ok(client.getState().snapshot, 'the stop data stays while the trip loads');
  t.mock.timers.tick(4_999);
  await flush();
  assert.equal(sent.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].trips.length, 1);
  client.setQuery(buildLiveQuery(schedule, { stopIds: ['B'] }));
  assert.equal(client.getState().snapshot, null, 'another stop starts without the old stop data');
  client.dispose();
});

test('failure backoff retains last-good cache, expires stored data and recovers without reinstall', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  const { schedule, query, snapshot } = fixture();
  let raw: string | null = JSON.stringify({ schema: 1, query, snapshot, storedAt: NOW });
  const cache: LiveCacheStorage = {
    read: async () => raw,
    write: async (content) => {
      raw = content;
    },
    remove: async () => {
      raw = null;
    },
  };
  let fail = true;
  let calls = 0;
  const client = createLiveClient({
    schedule,
    config: CONFIG,
    cache,
    onState: () => {},
    fetcher: (async () => {
      calls++;
      if (fail) throw new Error('offline');
      return response({ ...snapshot, generatedAt: Date.now() });
    }) as typeof fetch,
  });
  client.setQuery(query);
  client.setForeground(true);
  await flush();
  assert.equal(client.getState().snapshot!.tripUpdates[0].measuredAt, NOW - 10_000);
  const initialCache = raw;
  await client.refresh();
  assert.equal(calls, 1);
  t.mock.timers.tick(45_000);
  await flush();
  assert.equal(calls, 2);
  assert.equal(client.getState().nextRefreshAt, NOW + 135_000);
  assert.equal(raw, initialCache);
  fail = false;
  t.mock.timers.tick(90_000);
  await flush();
  assert.equal(calls, 3);
  assert.equal(client.getState().reason, null);
  assert.equal(client.getState().snapshot!.tripUpdates[0].measuredAt, NOW - 10_000);
  client.dispose();
  t.mock.timers.tick(LIVE_LOCAL_MAX_AGE_MS + 1);
  const restored = createLiveClient({ schedule, config: null, cache, onState: () => {} });
  restored.setQuery(query);
  await flush();
  assert.equal(restored.getState().snapshot, null);
  restored.dispose();
});

test('partial source failure retains source evidence with stale health and old source timestamps', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  const { schedule, query, snapshot } = fixture();
  let calls = 0;
  const client = createLiveClient({
    schedule,
    config: CONFIG,
    onState: () => {},
    fetcher: (async () => {
      calls++;
      const next = structuredClone(snapshot);
      if (calls > 1) {
        next.health.trips = {
          status: 'error',
          fetchedAt: null,
          feedTimestamp: null,
          error: 'upstream timeout',
        };
        next.tripUpdates = [];
        next.generatedAt = Date.now();
      }
      return response(next);
    }) as typeof fetch,
  });
  client.setQuery(query);
  client.setForeground(true);
  await flush();
  t.mock.timers.tick(45_000);
  await flush();
  const latest = client.getState().snapshot!;
  assert.equal(latest.tripUpdates[0].measuredAt, snapshot.tripUpdates[0].measuredAt);
  assert.equal(latest.health.trips.feedTimestamp, snapshot.health.trips.feedTimestamp);
  assert.equal(latest.health.trips.status, 'stale');
  assert.equal(
    mergeLiveDeparture(schedule, fixture().departure, latest, Date.now()).source,
    'last-known',
  );
  client.dispose();
});
