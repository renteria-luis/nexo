import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as journeyStore from '../transit/journey-store.ts';
import * as realtime from '../transit/realtime.ts';
import * as tracker from './trip-tracker.ts';
import { database, plannerFixture } from '../transit/fixtures.ts';
import { buildPlannerIndex, liveOptions, startPlan } from '../transit/planner.ts';
import { queryInstant } from '../transit/schedule.ts';
import { savePlace } from '../transit/store.ts';
import { renderModule } from '../ui/test-render.ts';

const at = (clock: string) => queryInstant('2026-10-13', clock);

async function setup(background: 'works' | 'fails') {
  const { db } = await database();
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
  const calls: [string, ...unknown[]][] = [];
  const tasks = new Map<string, (body: unknown) => Promise<unknown>>();
  let started = false;
  let watcher: ((location: unknown) => void) | null = null;
  const location = {
    Accuracy: { High: 4 },
    ActivityType: { Fitness: 3, OtherNavigation: 4 },
    hasServicesEnabledAsync: async () => true,
    requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
    startLocationUpdatesAsync: async (name: string, options: unknown) => {
      calls.push(['startLocationUpdatesAsync', name, options]);
      if (background === 'fails') throw new Error('Background location is not enabled.');
      started = true;
    },
    stopLocationUpdatesAsync: async (name: string) => {
      calls.push(['stopLocationUpdatesAsync', name]);
      started = false;
    },
    hasStartedLocationUpdatesAsync: async () => started,
    watchPositionAsync: async (options: unknown, callback: (location: unknown) => void) => {
      calls.push(['watchPositionAsync', options]);
      watcher = callback;
      return {
        remove() {
          calls.push(['remove']);
          watcher = null;
        },
      };
    },
  };
  const module = renderModule('src/shell/trip-task.ts', {
    'expo-location': location,
    'expo-task-manager': {
      isAvailableAsync: async () => true,
      defineTask: (name: string, executor: (body: unknown) => Promise<unknown>) =>
        tasks.set(name, executor),
    },
    'react-native': { AppState: { currentState: 'active' }, Platform: { OS: 'ios' } },
    '../db/index.ts': { openDatabase: async () => db },
    '../transit/journey-store.ts': journeyStore,
    '../transit/realtime.ts': realtime,
    './trip-tracker.ts': tracker,
    './notifications.ts': {
      presentTripEvents: async () => calls.push(['present']),
      syncTripAlarms: async () => calls.push(['alarms']),
    },
    './transit-live.ts': { loadTransitLiveConfig: async () => null },
  }).exports;
  const start = () =>
    module.tripTracker.start({
      option,
      schedule,
      origin: { id: origin, name: 'Origin', lat: 43.0015, lng: -81.2001 },
      destination: { id: destination, name: 'Destination', lat: 42.987, lng: -81.1701 },
      journeyId: null,
    });
  return {
    module,
    calls,
    tasks,
    start,
    watcher: () => watcher,
    enableBackground: () => {
      background = 'works';
    },
  };
}

test('a trip asks iOS for background updates that keep reporting and show the indicator', async (t) => {
  t.mock.method(Date, 'now', () => at('08:25'));
  const f = await setup('works');
  assert.deepEqual([...f.tasks.keys()], ['nexo-transit-trip']);
  await f.start();
  assert.deepEqual(f.calls[0], [
    'startLocationUpdatesAsync',
    'nexo-transit-trip',
    {
      accuracy: 4,
      activityType: 3,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      deferredUpdatesInterval: 10_000,
    },
  ]);
  assert.equal(f.module.tripTracker.getState().gps, 'background');
  await f.tasks.get('nexo-transit-trip')!({
    data: {
      locations: [
        {
          coords: { latitude: 43.0014, longitude: -81.2001, accuracy: 9, speed: -1 },
          timestamp: at('08:25') + 4_000,
        },
      ],
    },
    error: null,
  });
  assert.deepEqual(f.module.tripTracker.getState().trip.lastFix, {
    lat: 43.0014,
    lng: -81.2001,
    accuracy: 9,
    speed: null,
    at: at('08:25') + 4_000,
  });
  await f.module.tripTracker.act('cancel');
  assert.ok(
    f.calls.some(
      ([name, task]) => name === 'stopLocationUpdatesAsync' && task === 'nexo-transit-trip',
    ),
  );
});

test('a build without background location still follows the trip while it is open', async (t) => {
  t.mock.method(Date, 'now', () => at('08:25'));
  t.mock.method(console, 'error', () => undefined);
  const f = await setup('fails');
  await f.start();
  assert.equal(f.module.tripTracker.getState().gps, 'foreground');
  assert.ok(f.calls.some(([name]) => name === 'watchPositionAsync'));
  f.watcher()!({
    coords: { latitude: 43.0013, longitude: -81.2001, accuracy: 7, speed: 1.2 },
    timestamp: at('08:25') + 9_000,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.module.tripTracker.getState().trip.lastFix.speed, 1.2);
  await f.module.tripTracker.act('cancel');
  assert.ok(f.calls.some(([name]) => name === 'remove'));
});

test('recovering background delivery removes the temporary foreground subscription', async (t) => {
  t.mock.method(Date, 'now', () => at('08:25'));
  t.mock.method(console, 'error', () => undefined);
  const f = await setup('fails');
  await f.start();
  assert.ok(f.watcher());
  f.enableBackground();
  await f.module.tripTracker.reconcile();
  assert.equal(f.module.tripTracker.getState().gps, 'background');
  assert.equal(f.watcher(), null);
  assert.equal(f.calls.filter(([name]) => name === 'remove').length, 1);
});
