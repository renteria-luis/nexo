import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Fix, TripAlarm, TripEvent } from '../transit/active-trip.ts';
import { database, plannerFixture } from '../transit/fixtures.ts';
import { buildPlannerIndex, liveOptions, startPlan } from '../transit/planner.ts';
import type { LiveSnapshot } from '../transit/realtime.ts';
import { queryInstant } from '../transit/schedule.ts';
import { savePlace } from '../transit/store.ts';
import { listWalkObservations, readActiveTrip, saveTrip } from '../transit/trip-store.ts';
import { BACKGROUND_LIVE_MS, createTripTracker, type TrackerDeps } from './trip-tracker.ts';

const at = (clock: string) => queryInstant('2026-10-13', clock);
const fix = (lat: number, lng: number, when: number, speed: number | null = null): Fix => ({
  lat,
  lng,
  accuracy: 8,
  speed,
  at: when,
});
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

async function setup() {
  const { db, raw } = await database();
  const origin = await savePlace(db, { name: 'Origin', address: '', lat: 43.0015, lng: -81.2001 });
  const destination = await savePlace(db, {
    name: 'Destination',
    address: '',
    lat: 42.987,
    lng: -81.1701,
  });
  const schedule = plannerFixture();
  const search = startPlan(buildPlannerIndex(schedule), {
    origin: { lat: 43.0015, lng: -81.2001 },
    destination: { lat: 42.987, lng: -81.1701 },
    originWalks: new Map(),
    destinationWalks: new Map(),
    stopWalks: [],
    mode: 'depart',
    at: at('08:00'),
  });
  while (!search.step(1_000));
  const option = liveOptions(search.result(), null, at('08:00')).find(
    (o) => o.itinerary.rides.map((r) => r.trip[0]).join('>') === '16S-4>20E-4',
  )!;
  let now = at('08:25');
  let active = true;
  let running = false;
  let permission: 'granted' | 'denied' | 'unavailable' = 'granted';
  const calls: string[] = [];
  const presented: TripEvent[] = [];
  const alarms: TripAlarm[][] = [];
  const errors: unknown[] = [];
  const snapshot: LiveSnapshot = {
    schema: 1,
    generatedAt: at('08:25'),
    staticVersion: schedule.feedVersion,
    staticSourceSha256: schedule.sourceSha256,
    staticCompatible: true,
    health: {
      trips: { status: 'ok', feedTimestamp: at('08:25'), fetchedAt: at('08:25'), error: null },
      vehicles: { status: 'ok', feedTimestamp: at('08:25'), fetchedAt: at('08:25'), error: null },
      alerts: { status: 'ok', feedTimestamp: at('08:25'), fetchedAt: at('08:25'), error: null },
    },
    tripUpdates: [],
    vehicles: [],
    alerts: [],
    issues: { unmatchedTrips: 0, ambiguousStops: 0, invalidEntities: 0, truncated: false },
  };
  const deps: TrackerDeps = {
    now: () => now,
    database: async () => db,
    appActive: () => active,
    location: {
      permission: async () => permission,
      start: async (mode) => {
        calls.push(`start:${mode.activity}:${mode.deferMs}`);
        running = true;
        return 'background';
      },
      stop: async () => {
        calls.push('stop');
        running = false;
      },
      running: async () => running,
    },
    notify: {
      present: async (_, events) => {
        presented.push(...events);
      },
      alarms: async (_, list) => {
        alarms.push([...list]);
      },
    },
    readLive: async () => {
      calls.push('live');
      return { snapshot, bytes: 1_234 };
    },
    report: (error) => errors.push(error),
  };
  const tracker = createTripTracker(deps);
  const start = () =>
    tracker.start({
      option,
      schedule,
      origin: { id: origin, name: 'Origin', lat: 43.0015, lng: -81.2001 },
      destination: { id: destination, name: 'Destination', lat: 42.987, lng: -81.1701 },
      journeyId: 'journey',
    });
  return {
    deps,
    db,
    raw,
    tracker,
    start,
    calls,
    presented,
    alarms,
    errors,
    schedule,
    advance: (ms: number) => {
      now += ms;
    },
    set: (value: { active?: boolean; permission?: typeof permission; running?: boolean }) => {
      active = value.active ?? active;
      permission = value.permission ?? permission;
      running = value.running ?? running;
    },
  };
}

const walkToStop = [
  fix(43.0015, -81.2001, at('08:25') + 5_000),
  fix(43.0011, -81.2001, at('08:25') + 40_000),
  fix(43.0007, -81.2001, at('08:25') + 75_000),
  fix(43.0004, -81.2001, at('08:25') + 105_000),
];
const boardAndRide = [
  fix(43.0003, -81.2001, at('08:29') + 30_000),
  fix(42.9985, -81.2001, at('08:30') + 20_000, 10),
  fix(42.9967, -81.2001, at('08:30') + 40_000, 11),
  fix(42.9949, -81.2001, at('08:31'), 11),
  fix(42.9937, -81.2001, at('08:31') + 10_000, 11),
];

test('a started trip is saved, asks for location once and follows it in the background', async () => {
  const f = await setup();
  const trip = await f.start();
  assert.equal(f.tracker.getState().gps, 'background');
  assert.deepEqual(f.calls, ['start:fitness:10000']);
  assert.deepEqual(await readActiveTrip(f.db), trip);
  assert.deepEqual(
    f.alarms.at(-1)?.map((a) => a.key),
    ['expiry'],
  );
  await assert.rejects(f.start(), /Ya hay un viaje en curso/);
});

test('readings move the trip, keep its walk for review and retune for the bus', async () => {
  const f = await setup();
  await f.start();
  f.advance(105_000);
  await f.tracker.handleLocations(walkToStop);
  assert.equal(f.tracker.getState().trip?.phase, 'waiting');
  const walks = await listWalkObservations(f.db);
  assert.equal(walks.length, 1);
  assert.equal(walks[0].status, 'new');
  f.advance(6 * 60_000);
  await f.tracker.handleLocations(boardAndRide);
  const state = f.tracker.getState();
  assert.equal(state.trip?.phase, 'riding');
  assert.equal(state.trip?.stats.batches, 2);
  assert.deepEqual(f.calls, ['start:fitness:10000', 'start:transit:5000']);
  assert.deepEqual(
    f.presented.map((e) => e.key),
    ['alight:0'],
  );
  assert.deepEqual(
    f.alarms.at(-1)?.map((a) => a.key),
    ['expiry'],
  );
  assert.equal((await readActiveTrip(f.db))?.phase, 'riding');
});

test('ending a trip stops the GPS and clears its held warnings', async () => {
  const f = await setup();
  await f.start();
  await f.tracker.act('cancel');
  assert.equal(f.tracker.getState().gps, 'off');
  assert.equal(f.tracker.getState().trip?.phase, 'canceled');
  assert.deepEqual(f.calls, ['start:fitness:10000', 'stop']);
  assert.deepEqual(f.alarms.at(-1), []);
  assert.equal(await readActiveTrip(f.db), null);
  await f.tracker.handleLocations([fix(43, -81.2, at('08:40'))]);
  assert.deepEqual(f.calls, ['start:fitness:10000', 'stop']);
  await f.tracker.dismiss();
  assert.equal(f.tracker.getState().trip, null);
});

test('without location permission the trip is followed by his taps', async () => {
  const f = await setup();
  f.set({ permission: 'denied' });
  await f.start();
  assert.equal(f.tracker.getState().gps, 'denied');
  assert.deepEqual(f.calls, []);
  await f.tracker.act('boarded');
  assert.equal(f.tracker.getState().trip?.phase, 'riding');
  assert.deepEqual(
    f.alarms.at(-1)?.map((a) => a.key),
    ['alight:0', 'expiry'],
  );
  assert.equal(f.tracker.getState().gps, 'denied');
});

test('resuming restores the readings, ends an overdue trip and stops leftover updates', async () => {
  const f = await setup();
  const trip = await f.start();
  // iOS stopped the updates while Nexo was away; back on screen they start again.
  f.set({ running: false });
  await f.tracker.reconcile();
  assert.deepEqual(f.calls, ['start:fitness:10000', 'start:fitness:10000']);
  f.advance(trip.expiresAt - at('08:25'));
  await f.tracker.reconcile();
  assert.equal(f.tracker.getState().trip?.phase, 'expired');
  assert.deepEqual(
    f.presented.map((e) => e.key),
    ['expired'],
  );
  assert.equal(f.calls.at(-1), 'stop');
  // Updates still running with no trip saved, as after a reset.
  f.set({ running: true });
  await f.tracker.reconcile();
  assert.equal(f.calls.at(-1), 'stop');
  assert.deepEqual(f.alarms.at(-1), []);
});

test('a trip erased by a reset is dropped instead of being saved again', async () => {
  const f = await setup();
  await f.start();
  f.raw.exec('DELETE FROM transit_trip');
  await f.tracker.reconcile();
  assert.equal(f.tracker.getState().trip, null);
  assert.equal(f.calls.at(-1), 'stop');
  await f.tracker.handleLocations(walkToStop);
  assert.equal(await readActiveTrip(f.db), null);
});

test('in the background live data is read at most once a minute for the rides ahead', async () => {
  const f = await setup();
  await f.start();
  f.set({ active: false });
  f.tracker.setSchedule(f.schedule);
  f.advance(105_000);
  await f.tracker.handleLocations(walkToStop);
  await settle();
  f.advance(20_000);
  await f.tracker.handleLocations([fix(43.0003, -81.2001, at('08:27'))]);
  await settle();
  assert.equal(f.calls.filter((call) => call === 'live').length, 1);
  f.advance(BACKGROUND_LIVE_MS);
  await f.tracker.handleLocations([fix(43.0003, -81.2001, at('08:28'))]);
  await settle();
  assert.equal(f.calls.filter((call) => call === 'live').length, 2);
  assert.equal(f.tracker.getState().trip?.stats.liveReads, 2);
  assert.equal(f.tracker.getState().trip?.stats.liveBytes, 2_468);
  // Open on screen, the screens' own reading serves it.
  f.set({ active: true });
  f.advance(BACKGROUND_LIVE_MS);
  await f.tracker.handleLocations([fix(43.0003, -81.2001, at('08:29'))]);
  await settle();
  assert.equal(f.calls.filter((call) => call === 'live').length, 2);
  assert.deepEqual(f.errors, []);
});

test('quiet readings are saved every thirty seconds, not on every fix', async () => {
  const f = await setup();
  const trip = await f.start();
  await saveTrip(f.db, trip);
  f.advance(5_000);
  await f.tracker.handleLocations([fix(43.0015, -81.2001, at('08:25') + 5_000)]);
  assert.equal((await readActiveTrip(f.db))?.lastFix, null);
  f.advance(30_000);
  await f.tracker.handleLocations([fix(43.0014, -81.2001, at('08:25') + 35_000)]);
  assert.equal((await readActiveTrip(f.db))?.lastFix?.at, at('08:25') + 35_000);
});

test('the foreground clock expires a trip even when no location reading arrives', async () => {
  const f = await setup();
  const trip = await f.start();
  f.advance(trip.expiresAt - at('08:25'));
  await f.tracker.tick();
  assert.equal(f.tracker.getState().trip?.phase, 'expired');
  assert.equal(f.tracker.getState().gps, 'off');
  assert.equal(f.calls.at(-1), 'stop');
  assert.deepEqual(f.alarms.at(-1), []);
});

test('revoking location permission during a trip stops its registered task on return', async () => {
  const f = await setup();
  await f.start();
  f.set({ permission: 'denied' });
  await f.tracker.reconcile();
  assert.equal(f.tracker.getState().gps, 'denied');
  assert.equal(f.calls.at(-1), 'stop');
  await f.tracker.act('boarded');
  assert.equal(f.tracker.getState().trip?.phase, 'riding');
});

test('a failed GPS shutdown stays visible and the next clock tick retries it', async () => {
  const f = await setup();
  await f.start();
  const stop = f.deps.location.stop;
  f.deps.location.stop = async () => {
    throw new Error('location service busy');
  };
  await f.tracker.act('cancel');
  assert.equal(f.tracker.getState().trip?.phase, 'canceled');
  assert.equal(await readActiveTrip(f.db), null);
  assert.equal(f.tracker.getState().gps, 'background');
  assert.match(f.tracker.getState().problem!, /No se pudo detener el GPS/);
  await f.tracker.dismiss();
  assert.ok(f.tracker.getState().trip, 'the failed cleanup cannot be hidden with the summary');
  f.deps.location.stop = stop;
  await f.tracker.tick();
  assert.equal(f.tracker.getState().gps, 'off');
  assert.equal(f.tracker.getState().problem, null);
  assert.equal(f.calls.at(-1), 'stop');
  assert.deepEqual(f.alarms.at(-1), []);
});
