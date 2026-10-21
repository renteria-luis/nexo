import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';

import { scheduleFixture } from './fixtures.ts';
import { scheduledTime, type Departure, type Stop, type StopTime } from './schedule.ts';
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
  stopClosure,
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

test('query surface keeps leading zeros, finite size and known identifiers; reports validate service', () => {
  const { schedule, query } = fixture();
  assert.deepEqual(validateLiveQuery(query, schedule), query);
  assert.throws(() => validateLiveQuery({ ...query, routeIds: ['2'] }, schedule), /línea/);
  assert.throws(
    () => validateLiveQuery({ ...query, upstream: 'http://private.invalid' }, schedule),
    /parámetros/,
  );
  assert.doesNotThrow(() =>
    validateLiveQuery(
      { ...query, trips: [{ tripId: 'weekend-trip', serviceDate: '2026-10-12' }] },
      schedule,
    ),
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
  assert.equal(detail.bus?.placedBy, 'gps');
  assert.deepEqual(
    detail.stops.map((s) => s.progress),
    ['next', 'upcoming'],
    'a bus waiting at the first stop has passed nothing',
  );
  snapshot.vehicles[0].measuredAt = NOW - 100_000;
  const stale = tripLiveDetail(schedule, departure, snapshot, NOW);
  assert.equal(stale.bus?.placedBy, 'last-gps', 'an old position stays, as the last report');
  assert.equal(stale.bus?.vehicle?.measuredAt, NOW - 100_000, 'with its own time');
  assert.deepEqual(
    stale.stops.map((s) => s.progress),
    ['next', 'upcoming'],
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
  assert.equal(detail.bus?.along?.after, 0);
  assert.equal(detail.bus?.placedBy, 'gps');
  assert.ok(detail.bus!.along!.fraction > 0.3 && detail.bus!.along!.fraction < 0.5);
  assert.deepEqual(detail.bus?.point, { lat: 43.00004, lng: -81.00004 }, 'the map gets the report');
  assert.deepEqual(
    detail.stops.map((s) => s.progress),
    ['passed', 'next', 'upcoming'],
  );
  vehicle.position = { lat: 44, lng: -80, bearing: null, speed: 8 };
  const off = tripLiveDetail(schedule, departure, snapshot, NOW);
  assert.equal(off.bus?.why, 'off-trip', 'a position off the trip is not forced onto the line');
  assert.equal(off.bus?.along, null);
  assert.deepEqual(off.bus?.point, { lat: 44, lng: -80 }, 'the map still shows where it is');
  assert.deepEqual(
    off.stops.map((s) => s.progress),
    ['passed', 'next', 'upcoming'],
    'the predictions still say how far the trip has gone',
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

test('a stop reads as closed by an alert that closes it or when every bus LTC reports skips it', () => {
  const { schedule, snapshot } = fixture();
  assert.equal(stopClosure(schedule, snapshot, 'A', NOW), null, 'a bus that stops there');
  const alert = (changes: Partial<LiveSnapshot['alerts'][number]>) => ({
    id: 'closure',
    activePeriods: [{ start: NOW - 1_000, end: NOW + 10_000 }],
    selectors: [{ routeId: null, stopId: 'B', tripId: null, serviceDate: null, directionId: null }],
    cause: null,
    effect: 4,
    header: 'Detour downtown',
    description: 'Buses run on King.',
    url: null,
    ...changes,
  });
  snapshot.alerts = [alert({})];
  assert.equal(stopClosure(schedule, snapshot, 'B', NOW), null, 'a detour alone is not a closure');
  // LTC's detours list the stops they close and name one they still serve, often a temporary one.
  snapshot.alerts = [
    alert({
      header: 'DETOUR',
      description:
        'The following stops will be closed:\r\nMain at First EB\r\n\r\nAlternate stops can be found at:\r\nRoad SB',
    }),
  ];
  assert.equal(stopClosure(schedule, snapshot, 'B', NOW), null, 'the stop a detour names stays');
  snapshot.alerts = [
    alert({ header: 'STOP CLOSURE', description: 'Road SB will be closed until further notice.' }),
  ];
  assert.equal(stopClosure(schedule, snapshot, 'B', NOW), 'STOP CLOSURE');
  snapshot.alerts = [alert({ effect: 7, header: 'Notice', description: 'Road SB is closed.' })];
  assert.equal(stopClosure(schedule, snapshot, 'B', NOW), 'Notice');
  snapshot.alerts = [alert({ effect: 1, header: '' })];
  assert.equal(stopClosure(schedule, snapshot, 'B', NOW), 'LTC avisa que está cerrado.');
  assert.equal(stopClosure(schedule, snapshot, 'B', NOW + 10_000), null, 'once the alert ends');
  assert.equal(stopClosure(schedule, snapshot, 'A', NOW), null, 'only the stop it names');
  snapshot.alerts = [];
  snapshot.tripUpdates[0].stops[0].relationship = 'skipped';
  assert.equal(
    stopClosure(schedule, snapshot, 'A', NOW),
    'Los buses que LTC reporta no paran ahí.',
  );
  assert.equal(stopClosure(schedule, null, 'A', NOW), null, 'without a reading nothing is known');
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
  const atB = { ...departure, stopTime: schedule.patterns[0][1] };
  assert.equal(
    mergeLiveDeparture(schedule, atB, client.getState().snapshot, Date.now()).status,
    'schedule',
    'a stop that reading did not ask about reads as schedule, not as missing a prediction',
  );
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
  assert.ok(
    client.getState().snapshot,
    'another stop keeps the last reading until its own arrives',
  );
  client.dispose();
});

test('a lost connection keeps the last-good cache, retries every 15 s and expires stored data', async (t) => {
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
  assert.equal(client.getState().nextRefreshAt, NOW + 15_000);
  t.mock.timers.tick(15_000);
  await flush();
  assert.equal(calls, 2);
  assert.equal(client.getState().nextRefreshAt, NOW + 30_000, 'the wait does not grow');
  assert.equal(raw, initialCache);
  fail = false;
  t.mock.timers.tick(15_000);
  await flush();
  assert.equal(calls, 3);
  assert.equal(client.getState().nextRefreshAt, NOW + 75_000, 'back to the usual pace');
  assert.equal(client.getState().reason, null);
  assert.equal(client.getState().snapshot!.tripUpdates[0].measuredAt, NOW - 10_000);
  client.dispose();
  t.mock.timers.tick(LIVE_LOCAL_MAX_AGE_MS + 1);
  const restored = createLiveClient({ schedule, config: null, cache, onState: () => {} });
  restored.setQuery(query);
  await flush();
  assert.equal(restored.getState().snapshot, null);
  assert.equal(
    restored.getState().reason,
    'Configura la conexión de Transit para consultar datos en vivo.',
    'an old reading is not reported as invalid over the real reason',
  );
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

// Eight stops 300 m apart going north, two minutes apart, on a straight drawn path: the
// weekend trip leaves S0 at 08:00 on 2026-10-11.
function lineFixture() {
  const schedule = scheduleFixture();
  schedule.stops = Array.from({ length: 8 }, (_, i): Stop => [
    `S${i}`,
    String(i),
    `Stop ${i}`,
    43 + i * 0.0027,
    -81,
  ]);
  schedule.patterns = [
    schedule.stops.map((_, i): StopTime => [i, i + 1, i * 120, i * 120, 0, 0, 1, '']),
  ];
  schedule.shapes = { shape: schedule.stops.map((s, i) => [s[3], s[4], i + 1]) };
  const trip = schedule.trips[1];
  const day = '2026-10-11';
  const at = (index: number) => scheduledTime(day, trip[7] + index * 120);
  const departure: Departure = {
    trip,
    route: schedule.routes[0],
    stopTime: schedule.patterns[0][0],
    serviceDate: day,
    at: at(0),
  };
  const identity = {
    tripId: trip[0],
    routeId: '02',
    serviceDate: day,
    directionId: null,
    startTime: null,
  };
  const reading = (generatedAt: number): LiveSnapshot => {
    const health = {
      status: 'ok' as const,
      feedTimestamp: generatedAt,
      fetchedAt: generatedAt,
      error: null,
    };
    return {
      schema: 1,
      generatedAt,
      staticVersion: schedule.feedVersion,
      staticSourceSha256: schedule.sourceSha256,
      staticCompatible: true,
      health: { trips: { ...health }, vehicles: { ...health }, alerts: { ...health } },
      tripUpdates: [],
      vehicles: [],
      alerts: [],
      issues: { unmatchedTrips: 0, ambiguousStops: 0, invalidEntities: 0, truncated: false },
    };
  };
  const update = (measuredAt: number, times: Record<number, number>, vehicleId = 'bus-7') => ({
    ...identity,
    entityId: `update-${vehicleId}`,
    vehicleId,
    measuredAt,
    relationship: 'scheduled' as const,
    delay: null,
    stops: Object.entries(times).map(([index, time]) => ({
      stopId: `S${index}`,
      stopSequence: Number(index) + 1,
      relationship: 'scheduled' as const,
      arrival: { time, delay: null, uncertainty: null },
      departure: null,
    })),
  });
  const vehicle = (measuredAt: number, lat: number, vehicleId = 'bus-7') => ({
    ...identity,
    entityId: `position-${vehicleId}`,
    vehicleId,
    measuredAt,
    stopId: null,
    stopSequence: null,
    status: null,
    position: { lat, lng: -81, bearing: null, speed: null },
  });
  return { schedule, departure, at, reading, update, vehicle, identity };
}

test('a reading stays current until the next one is due, then its reports turn into last reports', () => {
  const { schedule, departure, at, reading, update, vehicle } = lineFixture();
  const read = at(4) + 30_000;
  const snapshot = reading(read);
  // As LTC's files arrive: a GPS report about a minute old when the service answers.
  snapshot.tripUpdates.push(update(read - 60_000, { 5: at(5), 6: at(6), 7: at(7) }));
  snapshot.vehicles.push(vehicle(read - 60_000, 43 + 4.5 * 0.0027));
  const boarding = { ...departure, stopTime: schedule.patterns[0][5], at: at(5) };
  const due = read + 45_000;
  assert.equal(mergeLiveDeparture(schedule, boarding, snapshot, due).status, 'live');
  assert.equal(tripLiveDetail(schedule, departure, snapshot, due).bus?.placedBy, 'gps');
  const missed = read + 91_000;
  assert.equal(mergeLiveDeparture(schedule, boarding, snapshot, missed).status, 'stale');
  const last = tripLiveDetail(schedule, departure, snapshot, missed);
  assert.equal(last.bus?.placedBy, 'last-gps', 'two missed reads leave the last report, not a gap');
  assert.equal(last.bus?.vehicle?.measuredAt, read - 60_000);
  snapshot.vehicles[0].measuredAt = read - 91_000;
  const old = tripLiveDetail(schedule, departure, snapshot, read).bus;
  assert.equal(old?.placedBy, 'estimate', 'a report already old when read is never current');
  assert.equal(old?.vehicle?.measuredAt, read - 91_000, 'the estimate still names that report');
  assert.equal(
    tripLiveDetail(schedule, departure, snapshot, read - 31_000).bus,
    null,
    'a reading from the future is not used at all',
  );
});

test('a prediction LTC left on a passed stop does not pull the bus back to it', () => {
  const { schedule, departure, at, reading, update, vehicle } = lineFixture();
  const now = at(4) + 60_000;
  const snapshot = reading(now);
  // Stop 1 was passed long ago but LTC still lists it, at a time near now; stops 5 to 7 are
  // where the bus is actually heading, as its GPS between stops 4 and 5 says.
  snapshot.tripUpdates.push(update(now, { 1: now - 10_000, 5: at(5), 6: at(6), 7: at(7) }));
  snapshot.vehicles.push(vehicle(now - 10_000, 43 + 4.5 * 0.0027));
  const detail = tripLiveDetail(schedule, departure, snapshot, now);
  assert.equal(detail.bus?.placedBy, 'gps');
  assert.equal(detail.bus?.along?.after, 4);
  assert.deepEqual(
    detail.stops.map((s) => s.progress),
    ['passed', 'passed', 'passed', 'passed', 'passed', 'next', 'upcoming', 'upcoming'],
  );
});

test('without a current GPS the bus is estimated by the clock up to the next stop, and waits there', () => {
  const { schedule, departure, at, reading, update } = lineFixture();
  const read = at(4) + 60_000;
  const snapshot = reading(read);
  // No position for this bus; LTC predicts stop 5 half a minute early.
  snapshot.tripUpdates.push(update(read, { 5: at(5) - 30_000, 6: at(6) - 30_000 }));
  const place = (now: number) => tripLiveDetail(schedule, departure, snapshot, now).bus;
  const now = place(read)!;
  assert.equal(now.placedBy, 'estimate');
  assert.deepEqual(now.along, { after: 4, fraction: 0.75 }, 'it left stop 4 half a minute early');
  assert.ok(
    Math.abs(now.point.lat - (43 + 4.75 * 0.0027)) < 1e-6,
    'the map draws it on the trip path, at the same point as the line',
  );
  assert.equal(place(read + 15_000)!.along!.fraction, 0.875, 'it moves with the clock');
  assert.deepEqual(
    place(read + 45_000)!.along,
    { after: 4, fraction: 1 },
    'late, it waits at the stop',
  );
  assert.equal(place(read + 91_000), null, 'the estimate ends with the predictions');
});

test('a bus named for this trip while it finishes its previous one is shown there, not as under way', () => {
  const { schedule, departure, at, reading, update, vehicle, identity } = lineFixture();
  const now = at(0) - 5 * 60_000;
  const snapshot = reading(now);
  // The same physical bus runs the trip before, on the same line, and LTC already names it here.
  snapshot.tripUpdates.push(update(now, { 0: at(0), 1: at(1) }, 'bus-9'));
  snapshot.vehicles.push({
    ...vehicle(now - 5_000, 43.01, 'bus-9'),
    tripId: 'weekday-late',
    entityId: 'position-previous',
  });
  const detail = tripLiveDetail(schedule, departure, snapshot, now);
  assert.equal(detail.phase, 'not-started');
  assert.equal(detail.bus?.why, 'other-trip');
  assert.equal(detail.bus?.along, null, 'it is not drawn on this trip');
  assert.deepEqual(detail.bus?.point, { lat: 43.01, lng: -81 });
  assert.equal(identity.tripId, departure.trip[0]);
});

test('a route that comes back along its own street keeps the bus on the leg the timetable says', () => {
  const { schedule, departure, at, reading, vehicle } = lineFixture();
  // Out north to S3 and back south along the same street to S0's corner.
  const pattern = schedule.patterns[0];
  pattern.splice(
    4,
    4,
    [2, 5, 480, 480, 0, 0, 1, ''],
    [1, 6, 600, 600, 0, 0, 1, ''],
    [0, 7, 720, 720, 0, 0, 1, ''],
  );
  const position = 43 + 0.5 * 0.0027;
  // No current predictions: only the timetable tells the two legs apart.
  const early = reading(at(0) + 60_000);
  early.vehicles.push(vehicle(at(0) + 55_000, position));
  assert.equal(tripLiveDetail(schedule, departure, early, at(0) + 60_000).bus?.along?.after, 0);
  const late = reading(at(5) + 60_000);
  late.vehicles.push(vehicle(at(5) + 55_000, position));
  assert.equal(tripLiveDetail(schedule, departure, late, at(5) + 60_000).bus?.along?.after, 5);
});

test('a followed bus a new reading leaves out keeps its last report, not when its trip says otherwise', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  const { schedule, departure, at, reading, update, vehicle } = lineFixture();
  t.mock.timers.setTime(at(4));
  const query = buildLiveQuery(schedule, {
    stopIds: ['S0'],
    trips: [{ tripId: departure.trip[0], serviceDate: departure.serviceDate }],
  });
  const answers: ((now: number) => LiveSnapshot)[] = [
    (now) => {
      const first = reading(now);
      first.tripUpdates.push(update(now, { 5: at(5), 6: at(6) }));
      first.vehicles.push(vehicle(now - 10_000, 43 + 4.2 * 0.0027));
      return first;
    },
    // A healthy reading that has neither the bus nor its trip this time.
    (now) => reading(now),
    (now) => {
      const canceled = reading(now);
      canceled.tripUpdates.push({ ...update(now, {}), relationship: 'canceled' });
      return canceled;
    },
  ];
  const client = createLiveClient({
    schedule,
    config: CONFIG,
    onState: () => {},
    fetcher: (async () => response(answers.shift()!(Date.now()))) as typeof fetch,
  });
  client.setQuery(query, { departureAt: departure.at });
  client.setForeground(true);
  await flush();
  const measured = client.getState().snapshot!.vehicles[0].measuredAt;
  t.mock.timers.tick(45_000);
  await flush();
  const second = client.getState().snapshot!;
  assert.equal(second.vehicles.length, 0);
  assert.equal(second.retainedVehicles?.[0].measuredAt, measured, 'kept with its own time');
  const shown = tripLiveDetail(schedule, departure, second, Date.now());
  assert.equal(shown.bus?.placedBy, 'last-gps', 'shown as the last report, never as current');
  t.mock.timers.tick(45_000);
  await flush();
  assert.deepEqual(client.getState().snapshot!.retainedVehicles, [], 'a cancellation wins');
  client.dispose();
});

test('trouble in one LTC file keeps the pace; a failed connection retries in 15 s; a return retries at once unless paused', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  const { schedule, query, snapshot } = fixture();
  const answers: (() => Response)[] = [
    () => {
      const alertsDown = structuredClone(snapshot);
      alertsDown.generatedAt = Date.now();
      alertsDown.health.alerts = {
        status: 'error',
        feedTimestamp: null,
        fetchedAt: null,
        error: 'upstream_timeout',
      };
      return response(alertsDown);
    },
    () => {
      throw new Error('offline');
    },
    () => new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }),
    () => response({ ...snapshot, generatedAt: Date.now() }),
  ];
  let calls = 0;
  const client = createLiveClient({
    schedule,
    config: CONFIG,
    onState: () => {},
    fetcher: (async () => {
      calls++;
      return answers.shift()!();
    }) as typeof fetch,
  });
  client.setQuery(query);
  client.setForeground(true);
  await flush();
  assert.equal(client.getState().nextRefreshAt, NOW + 45_000, 'old alerts do not slow the buses');
  t.mock.timers.tick(45_000);
  await flush();
  assert.equal(calls, 2);
  assert.equal(client.getState().nextRefreshAt, NOW + 60_000, 'no connection: again in 15 s');
  client.setForeground(false);
  t.mock.timers.tick(20_000);
  client.setForeground(true);
  await flush();
  assert.equal(calls, 3, 'back from another app, it tries again at once');
  client.setForeground(false);
  t.mock.timers.tick(20_000);
  client.setForeground(true);
  await flush();
  assert.equal(calls, 3, 'the service asked to wait two minutes, and that holds');
  t.mock.timers.tick(100_000);
  await flush();
  assert.equal(calls, 4);
  client.dispose();
});

test('reads continue while the followed trip runs and stop after it ends', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  const { schedule, query, snapshot } = fixture();
  let calls = 0;
  const client = createLiveClient({
    schedule,
    config: CONFIG,
    onState: () => {},
    fetcher: (async () => {
      calls++;
      return response({ ...snapshot, generatedAt: Date.now() });
    }) as typeof fetch,
  });
  // He boarded twenty minutes ago; the trip ends in ten.
  client.setQuery(query, { departureAt: NOW - 20 * 60_000, endsAt: NOW + 10 * 60_000 });
  client.setForeground(true);
  await flush();
  t.mock.timers.tick(45_000);
  await flush();
  assert.equal(calls, 2, 'still following the bus he is on');
  t.mock.timers.tick(25 * 60_000);
  await flush();
  const stopped = calls;
  t.mock.timers.tick(10 * 60_000);
  await flush();
  assert.equal(calls, stopped, 'nothing more once the trip is over');
  assert.equal(client.getState().nextRefreshAt, null);
  client.dispose();
});
