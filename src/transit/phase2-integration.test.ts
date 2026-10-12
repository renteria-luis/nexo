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
import {
  buildStopIndex,
  departures,
  scheduledTime,
  type Departure,
  type Schedule,
} from './schedule.ts';

const ICONS = {
  LoaderCircle: 'LoaderCircle',
  Ban: 'Ban',
  Bus: 'Bus',
  ChevronDown: 'ChevronDown',
  ChevronUp: 'ChevronUp',
  CircleSlash: 'CircleSlash',
  Info: 'Info',
  TriangleAlert: 'TriangleAlert',
  X: 'X',
};

const rowLabels = (tree: unknown) =>
  nodes(tree)
    .filter(
      (node) => node.type === 'Pressable' && / línea /.test(node.props.accessibilityLabel ?? ''),
    )
    .map((node) => node.props.accessibilityLabel);

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
    './icons.ts': ICONS,
  }).mount('TransitStopDepartures', {
    schedule,
    departures: rows,
    snapshot: checked,
    current: true,
    active: false,
    onSelect: (departure: unknown) => selections.push(departure),
  });
  const listTree = await list.settle();
  assert.deepEqual(rowLabels(listTree), [
    '08:05, línea 02, 2B Terminal, En vivo LTC',
    '08:20, línea 02, Short turn, No se detiene',
  ]);
  assert.match(textOf(listTree), /2B Terminal/, 'the line heading names its destination');
  assert.match(textOf(listTree), /No para aquí · recogida condicionada/);
  const shortTurn = nodes(listTree).find(
    (node) => node.type === 'Pressable' && node.props.accessibilityLabel?.includes('Short turn'),
  );
  assert.ok(shortTurn);
  shortTurn.props.onPress();
  assert.deepEqual(selections, [selected], 'the exact loop occurrence opens');

  let closed = 0;
  const trip = renderModule('src/ui/TransitDepartures.tsx', {
    '../transit/realtime.ts': realtime,
    './icons.ts': ICONS,
  }).mount('TransitTripTimeline', {
    schedule,
    departure: selected,
    choices: rows,
    snapshot: checked,
    active: false,
    onSelect: (departure: Departure) => selections.push(departure),
    onClose: () => closed++,
  });
  const tripTree = await trip.settle();
  const rowsText = nodes(tripTree)
    .filter(
      (node) =>
        (node.type === 'View' || node.type === 'Pressable') &&
        typeof node.props.accessibilityLabel === 'string',
    )
    .map((node) => node.props.accessibilityLabel)
    .filter((label) => /, \d{2}:\d{2}, /.test(label) || label === 'Posición del bus');
  assert.deepEqual(rowsText, [
    'Road NB, 08:00, Ya pasó',
    'Road SB, 08:11, Horario · sin predicción · sin recogida',
    'Road NB, 08:20, No se detiene · recogida condicionada',
    'Posición del bus',
  ]);
  assert.match(textOf(tripTree), /Bus loop-bus · GPS \d{2}:\d{2} · hace 5 s/);
  const chips = nodes(tripTree).filter((node) => node.props?.accessibilityRole === 'radio');
  assert.deepEqual(
    chips.map((chip) => [chip.props.accessibilityLabel, chip.props.accessibilityState.selected]),
    [
      ['Salida de las 08:05', false],
      ['Salida de las 08:20', true],
    ],
  );
  chips[0].props.onPress();
  assert.equal(selections.at(-1), rows[0], 'another departure of the line opens from its tab');
  nodes(tripTree)
    .find((node) => node.props?.accessibilityLabel === 'Cerrar el viaje y ver todas las salidas')!
    .props.onPress();
  assert.equal(closed, 1);
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
    current: true,
    active: false,
    onSelect: () => undefined,
  };
  const canceled = renderModule('src/ui/TransitDepartures.tsx', {
    '../transit/realtime.ts': realtime,
    './icons.ts': ICONS,
  }).mount('TransitStopDepartures', props);
  const canceledTree = await canceled.settle();
  assert.match(rowLabels(canceledTree)[0], /Último reporte: cancelado/);
  assert.match(textOf(canceledTree), /último reporte hace 2 min/);
  assert.doesNotMatch(rowLabels(canceledTree)[0], /Última predicción/);

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
    './icons.ts': ICONS,
  }).mount('TransitStopDepartures', props);
  const arrivalTree = await arrival.settle();
  assert.match(rowLabels(arrivalTree)[0], /En vivo LTC/);
  assert.match(textOf(arrivalTree), /llegada/);
  assert.doesNotMatch(rowLabels(arrivalTree)[0], /sin predicción/);
});

test('a departure on another day says which day it is', async (t) => {
  const schedule = scheduleFixture();
  const now = scheduledTime('2026-10-11', 20 * 3_600);
  t.mock.method(Date, 'now', () => now);
  const rows = departures(schedule, buildStopIndex(schedule), 0, now);
  assert.equal(rows[0].serviceDate, '2026-10-12');
  const list = renderModule('src/ui/TransitDepartures.tsx', {
    '../transit/realtime.ts': realtime,
    './icons.ts': ICONS,
  }).mount('TransitStopDepartures', {
    schedule,
    departures: rows,
    snapshot: null,
    current: false,
    active: false,
    onSelect: () => undefined,
  });
  assert.match(textOf(await list.settle()), /mañana/);
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
    './icons.ts': ICONS,
  }).mount('TransitAlerts', {
    snapshot: checked,
    active: false,
  });
  const folded = await alerts.settle();
  assert.match(textOf(folded), /Alertas LTC · 1/);
  assert.doesNotMatch(textOf(folded), /Active closure/, 'alerts stay folded until he opens them');
  nodes(folded)
    .find((node) => node.props?.accessibilityLabel === 'Alertas LTC, 1')!
    .props.onPress();
  const alertText = textOf(await alerts.settle());
  assert.match(alertText, /Active closure/);
  assert.match(alertText, /Últimas alertas guardadas · sin confirmación actual/);
  assert.match(alertText, /hace 601 s/);
  assert.doesNotMatch(alertText, /Reportes vigentes|Future closure|Finished closure/);
});

function followedReading(schedule: Schedule, departure: Departure, generatedAt: number) {
  const snapshot = snapshotFixture(schedule, generatedAt);
  const identity = {
    tripId: departure.trip[0],
    serviceDate: departure.serviceDate,
    routeId: '02',
    directionId: null,
    startTime: null,
  };
  snapshot.tripUpdates.push({
    ...identity,
    entityId: 'update',
    vehicleId: 'bus-1',
    measuredAt: generatedAt - 10_000,
    relationship: 'scheduled',
    delay: null,
    stops: [
      {
        stopId: 'B',
        stopSequence: 2,
        relationship: 'scheduled',
        arrival: { time: departure.at + 660_000, delay: null, uncertainty: null },
        departure: null,
      },
    ],
  });
  snapshot.vehicles.push({
    ...identity,
    entityId: 'position',
    vehicleId: 'bus-1',
    measuredAt: generatedAt - 10_000,
    stopId: null,
    stopSequence: null,
    status: null,
    position: { lat: 43.00005, lng: -81.00005, bearing: null, speed: null },
  });
  return snapshot;
}

const busIcon = (tree: unknown) =>
  nodes(tree).find((n) => /^Posición del bus/.test(n.props?.accessibilityLabel ?? ''));

test('back from another app the bus keeps its last report, and a reading after the return is current before the next tick', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const schedule = scheduleFixture();
  const trip = schedule.trips[1];
  const departure: Departure = {
    trip,
    route: schedule.routes[0],
    stopTime: schedule.patterns[0][0],
    serviceDate: '2026-10-11',
    at: scheduledTime('2026-10-11', trip[7]),
  };
  let now = departure.at + 180_000;
  t.mock.method(Date, 'now', () => now);
  const props = {
    schedule,
    departure,
    choices: [departure],
    snapshot: followedReading(schedule, departure, now),
    active: true,
    onSelect: () => undefined,
    onClose: () => undefined,
  };
  const card = renderModule('src/ui/TransitDepartures.tsx', {
    '../transit/realtime.ts': realtime,
    './icons.ts': ICONS,
  }).mount('TransitTripTimeline', props);
  let tree = await card.settle();
  assert.ok(busIcon(tree));
  assert.match(textOf(tree), /Bus bus-1 · GPS \d{2}:\d{2} · hace 10 s/);

  props.active = false;
  await card.settle();
  now += 120_000;
  props.active = true;
  await card.settle();
  // On the phone the app's wake-up event reads the clock before the first frame; here the read
  // that follows the first frame stands in for it.
  t.mock.timers.tick(0);
  tree = await card.settle();
  assert.ok(busIcon(tree), 'the bus does not vanish while the new reading loads');
  assert.match(textOf(tree), /último GPS \d{2}:\d{2} · hace 2 min/, 'and says how old it is');

  props.snapshot = followedReading(schedule, departure, now);
  tree = await card.settle();
  assert.ok(busIcon(tree), 'a reading taken after the return is current at once');
  assert.match(textOf(tree), /Bus bus-1 · GPS \d{2}:\d{2} · hace 10 s/);
  assert.doesNotMatch(textOf(tree), /Última predicción|todavía no empieza/);
});

test('the bus on the line can be tapped to see it on the map, and its source shows in its shape', async (t) => {
  const schedule = scheduleFixture();
  const trip = schedule.trips[1];
  const departure: Departure = {
    trip,
    route: schedule.routes[0],
    stopTime: schedule.patterns[0][0],
    serviceDate: '2026-10-11',
    at: scheduledTime('2026-10-11', trip[7]),
  };
  const now = departure.at + 180_000;
  t.mock.method(Date, 'now', () => now);
  const focused: Departure[] = [];
  const props = {
    schedule,
    departure,
    choices: [departure],
    snapshot: followedReading(schedule, departure, now),
    active: false,
    onSelect: () => undefined,
    onClose: () => undefined,
    onFocusBus: (d: Departure) => focused.push(d),
  };
  const card = renderModule('src/ui/TransitDepartures.tsx', {
    '../transit/realtime.ts': realtime,
    './icons.ts': ICONS,
  }).mount('TransitTripTimeline', props);
  let tree = await card.settle();
  const icon = busIcon(tree)!;
  assert.equal(icon.type, 'Pressable');
  assert.equal(icon.props.accessibilityLabel, 'Posición del bus. Ver en el mapa');
  assert.ok(icon.props.hitSlop >= 12, 'a touch area larger than the icon');
  icon.props.onPress();
  nodes(tree)
    .find((n) => / · ver en el mapa$/.test(textOf(n)) && n.type === 'Pressable')!
    .props.onPress();
  assert.deepEqual(focused, [departure, departure]);
  const shape = (node: { props: Record<string, any> }) =>
    (node.props.style as unknown[]).filter(Boolean) as { borderStyle?: string }[];
  assert.ok(!shape(icon).some((s) => s.borderStyle === 'dashed'), 'a current GPS report is solid');

  props.snapshot = followedReading(schedule, departure, now - 100_000);
  props.snapshot.tripUpdates = [];
  tree = await card.settle();
  assert.match(textOf(tree), /último GPS/);
  assert.match(textOf(tree), /Es el último GPS recibido/);

  props.snapshot = followedReading(schedule, departure, now);
  props.snapshot.vehicles = [];
  props.snapshot.tripUpdates[0].stops[0].arrival = {
    time: now + 120_000,
    delay: null,
    uncertainty: null,
  };
  tree = await card.settle();
  assert.ok(
    shape(busIcon(tree)!).some((s) => s.borderStyle === 'dashed'),
    'an estimate is drawn dashed',
  );
  assert.match(textOf(tree), /posición estimada con las predicciones de LTC · sin GPS/);
  assert.match(textOf(tree), /Es una estimación, no un GPS/);
});
