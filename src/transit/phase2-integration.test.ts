import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { nodes, renderModule, textOf } from '../ui/test-render.ts';
import { scheduleFixture } from './fixtures.ts';
import * as realtime from './realtime.ts';
import {
  buildLiveQuery,
  createLiveClient,
  validateLiveSnapshot,
  type LiveSnapshot,
} from './realtime.ts';
import { buildStopIndex, departures, scheduledTime, type Schedule } from './schedule.ts';

function snapshotFixture(schedule: Schedule, now: number): LiveSnapshot {
  return {
    schema: 1,
    generatedAt: now,
    staticVersion: schedule.feedVersion,
    staticSourceSha256: schedule.sourceSha256,
    staticCompatible: true,
    health: {
      trips: { status: 'ok', feedTimestamp: now, fetchedAt: now, error: null },
      vehicles: { status: 'ok', feedTimestamp: now, fetchedAt: now, error: null },
      alerts: { status: 'ok', feedTimestamp: now, fetchedAt: now, error: null },
    },
    tripUpdates: [],
    vehicles: [],
    alerts: [],
    issues: { unmatchedTrips: 0, ambiguousStops: 0, invalidEntities: 0, truncated: false },
  };
}

test('the Transit hook cancels actual live reads on background and blur, then revalidates on resume', async (t) => {
  const schedule = scheduleFixture();
  const query = buildLiveQuery(schedule, { stopIds: ['A'] });
  const temporary = mkdtempSync(join(tmpdir(), 'nexo-transit-hook-'));
  const wrapper = join(temporary, 'hook.ts');
  const hook = relative(
    temporary,
    fileURLToPath(new URL('../ui/useTransitLive.ts', import.meta.url)),
  );
  writeFileSync(
    wrapper,
    `import { useTransitLive } from ${JSON.stringify(hook)};
export function Hook(props) {
  return useTransitLive(props.schedule, props.query);
}
`,
  );
  t.after(() => rmSync(temporary, { recursive: true, force: true }));

  let now = Date.parse('2026-10-11T12:00:00Z');
  let focused = false;
  let onAppState: (state: string) => void = () => undefined;
  const signals: AbortSignal[] = [];
  const clients: ReturnType<typeof createLiveClient>[] = [];
  const screen = renderModule(wrapper, {
    '@react-navigation/native': { useIsFocused: () => focused },
    'react-native': {
      AppState: {
        currentState: 'background',
        addEventListener: (_event: string, listener: typeof onAppState) => {
          onAppState = listener;
          return { remove() {} };
        },
      },
    },
    '../shell/transit-live.ts': {
      loadTransitLiveConfig: async () => ({
        endpoint: 'https://fixture.invalid/api/live',
        credential: 'fixture-installation-value-for-testing-only',
      }),
      saveTransitLiveConfig: async () => undefined,
      clearTransitLiveConfig: async () => undefined,
      createTransitLiveClient: (options: Parameters<typeof createLiveClient>[0]) => {
        const client = createLiveClient({
          ...options,
          now: () => now,
          timeoutMs: 60_000,
          fetcher: async (_input, init) => {
            const signal = init!.signal!;
            signals.push(signal);
            return await new Promise<Response>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            });
          },
        });
        clients.push(client);
        return client;
      },
    },
  }).mount('Hook', { schedule, query });
  t.after(() => clients.forEach((client) => client.dispose()));

  await screen.settle();
  assert.equal(signals.length, 0, 'a mounted but hidden background screen makes no live request');
  focused = true;
  await screen.settle();
  assert.equal(signals.length, 0, 'navigation focus alone does not bypass background suspension');
  onAppState('active');
  await screen.settle();
  assert.equal(signals.length, 1);
  assert.equal(clients[0].getState().loading, true);

  onAppState('inactive');
  await screen.settle();
  assert.equal(signals[0].aborted, true);
  assert.equal(clients[0].getState().loading, false);
  assert.equal(clients[0].getState().nextRefreshAt, null);

  now += 16_000;
  onAppState('active');
  await screen.settle();
  assert.equal(signals.length, 2, 'returning to the foreground requests relevant data again');
  focused = false;
  await screen.settle();
  assert.equal(signals[1].aborted, true);
  assert.equal(clients[0].getState().loading, false);
  assert.equal(clients[0].getState().nextRefreshAt, null);

  now += 16_000;
  focused = true;
  await screen.settle();
  assert.equal(signals.length, 3, 'returning to Transit resumes live reads');
  focused = false;
  await screen.settle();
  assert.equal(signals[2].aborted, true);
});

test('validated predictions keep the selected branch, repeated stop, and complete ordered trip visible', async (t) => {
  const schedule = scheduleFixture();
  schedule.patterns[0].push([0, 3, 1_200, 1_200, 2, 0, 1, 'Short turn']);
  const now = scheduledTime('2026-10-11', 8 * 3_600) - 15 * 60_000;
  t.mock.method(Date, 'now', () => now);
  const rows = departures(schedule, buildStopIndex(schedule), 0, now);
  const selected = rows.find((departure) => departure.stopTime[1] === 3)!;
  const snapshot = snapshotFixture(schedule, now);
  const identity = {
    tripId: selected.trip[0],
    serviceDate: selected.serviceDate,
    routeId: '02',
    directionId: 1,
    startTime: '08:00:00',
  };
  snapshot.tripUpdates.push({
    ...identity,
    entityId: 'official-loop',
    vehicleId: 'loop-bus',
    measuredAt: now - 5_000,
    relationship: 'scheduled',
    delay: null,
    stops: [
      {
        stopId: 'A',
        stopSequence: 1,
        relationship: 'scheduled',
        arrival: null,
        departure: { time: rows[0].at + 300_000, delay: null, uncertainty: null },
      },
      {
        stopId: 'A',
        stopSequence: 3,
        relationship: 'skipped',
        arrival: null,
        departure: null,
      },
    ],
  });
  snapshot.vehicles.push({
    ...identity,
    entityId: 'position-loop',
    vehicleId: 'loop-bus',
    measuredAt: now - 5_000,
    stopId: 'B',
    stopSequence: 2,
    status: 'in_transit',
    position: { lat: 43.0001, lng: -81.0001, bearing: null, speed: null },
  });
  const query = buildLiveQuery(schedule, {
    stopIds: ['A'],
    trips: [{ tripId: selected.trip[0], serviceDate: selected.serviceDate }],
  });
  const checked = validateLiveSnapshot(JSON.parse(JSON.stringify(snapshot)), schedule, query, now);
  const selections: unknown[] = [];
  const list = renderModule('src/ui/TransitDepartures.tsx', {
    '../transit/realtime.ts': realtime,
    './icons.ts': { LoaderCircle: 'LoaderCircle' },
  }).mount('TransitDepartures', {
    schedule,
    departures: rows,
    snapshot: checked,
    selected,
    current: true,
    active: false,
    onSelect: (departure: unknown) => selections.push(departure),
  });
  const listTree = await list.settle();
  assert.match(textOf(listTree), /02 → 2B Terminal · En vivo LTC/);
  assert.match(textOf(listTree), /02 → Short turn · No se detiene/);
  assert.match(textOf(listTree), /Recogida condicionada/);
  const shortTurn = nodes(listTree).find(
    (node) => node.type === 'Pressable' && node.props.accessibilityLabel?.includes('Short turn'),
  );
  assert.ok(shortTurn);
  shortTurn.props.onPress();
  assert.deepEqual(selections, [null], 'selecting the exact active loop occurrence closes it');

  const detail = renderModule('src/ui/TransitDepartures.tsx', {
    '../transit/realtime.ts': realtime,
    './icons.ts': { LoaderCircle: 'LoaderCircle' },
  }).mount('TransitTripDetail', {
    schedule,
    departure: selected,
    snapshot: checked,
    active: false,
  });
  const detailText = textOf(await detail.settle());
  assert.match(detailText, /Línea 02 · 2B Terminal · servicio 2026-10-11/);
  assert.match(detailText, /Road NB · En vivo LTC · anterior/);
  assert.match(detailText, /Road SB · Horario · sin predicción · parada reportada/);
  assert.match(detailText, /Road NB · No se detiene · próxima/);
});

test('retained cancellation evidence is labeled as an old report and arrival-only predictions stay explicit', async (t) => {
  const schedule = scheduleFixture();
  const now = scheduledTime('2026-10-11', 8 * 3_600) - 15 * 60_000;
  t.mock.method(Date, 'now', () => now);
  const rows = departures(schedule, buildStopIndex(schedule), 0, now);
  const selected = rows[0];
  const snapshot = snapshotFixture(schedule, now);
  snapshot.tripUpdates.push({
    tripId: selected.trip[0],
    serviceDate: selected.serviceDate,
    routeId: '02',
    directionId: null,
    startTime: null,
    entityId: 'cancellation',
    vehicleId: null,
    measuredAt: now - 120_000,
    relationship: 'canceled',
    delay: null,
    stops: [],
  });
  const query = buildLiveQuery(schedule, { stopIds: ['A'] });
  const props = {
    schedule,
    departures: rows,
    snapshot: validateLiveSnapshot(snapshot, schedule, query, now),
    selected: null,
    current: true,
    active: false,
    onSelect: () => undefined,
  };
  const canceled = renderModule('src/ui/TransitDepartures.tsx', {
    '../transit/realtime.ts': realtime,
    './icons.ts': { LoaderCircle: 'LoaderCircle' },
  }).mount('TransitDepartures', props);
  const canceledText = textOf(await canceled.settle());
  assert.match(canceledText, /Último reporte: cancelado/);
  assert.match(canceledText, /hace 120 s/);
  assert.doesNotMatch(canceledText, /Última predicción/);

  snapshot.tripUpdates[0] = {
    ...snapshot.tripUpdates[0],
    measuredAt: now - 5_000,
    relationship: 'scheduled',
    stops: [
      {
        stopId: 'A',
        stopSequence: selected.stopTime[1],
        relationship: 'scheduled',
        arrival: { time: selected.at + 60_000, delay: null, uncertainty: null },
        departure: null,
      },
    ],
  };
  props.snapshot = validateLiveSnapshot(snapshot, schedule, query, now);
  const arrival = renderModule('src/ui/TransitDepartures.tsx', {
    '../transit/realtime.ts': realtime,
    './icons.ts': { LoaderCircle: 'LoaderCircle' },
  }).mount('TransitDepartures', props);
  const arrivalText = textOf(await arrival.settle());
  assert.match(arrivalText, /En vivo LTC · llegada/);
  assert.doesNotMatch(arrivalText, /sin predicción/);
});

test('alert UI independently expires source freshness and filters future or finished active periods', async (t) => {
  const schedule = scheduleFixture();
  const now = scheduledTime('2026-10-11', 8 * 3_600);
  t.mock.method(Date, 'now', () => now);
  const snapshot = snapshotFixture(schedule, now - 601_000);
  const alert = {
    id: 'active',
    selectors: [
      { routeId: '02', stopId: null, tripId: null, serviceDate: null, directionId: null },
    ],
    cause: null,
    effect: null,
    header: 'Active closure',
    description: 'A public source closure report.',
    url: null,
    activePeriods: [],
  };
  snapshot.alerts.push(
    alert,
    {
      ...alert,
      id: 'future',
      header: 'Future closure',
      activePeriods: [{ start: now + 1_000, end: null }],
    },
    {
      ...alert,
      id: 'finished',
      header: 'Finished closure',
      activePeriods: [{ start: null, end: now }],
    },
  );
  const query = buildLiveQuery(schedule, { stopIds: ['A'] });
  const checked = validateLiveSnapshot(snapshot, schedule, query, now);
  const alerts = renderModule('src/ui/TransitDepartures.tsx', {
    '../transit/realtime.ts': realtime,
    './icons.ts': { LoaderCircle: 'LoaderCircle' },
  }).mount('TransitAlerts', {
    snapshot: checked,
    active: false,
  });
  const alertText = textOf(await alerts.settle());
  assert.match(alertText, /Active closure/);
  assert.match(alertText, /Últimas alertas guardadas · sin confirmación actual/);
  assert.match(alertText, /hace 601 s/);
  assert.doesNotMatch(alertText, /Reportes vigentes|Future closure|Finished closure/);
});
