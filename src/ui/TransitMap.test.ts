import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodes, renderModule, textOf } from './test-render.ts';

test('native map gestures retain the swipe lock for a full pinch and release on end or cancellation', async () => {
  let locks = 0;
  const interaction: boolean[] = [];
  const screen = renderModule('src/ui/TransitMap.native.tsx', {
    'react-native-maps': { __esModule: true, default: 'MapView', Marker: 'Marker' },
    './icons.ts': { Bus: 'Bus' },
    './placeIcons.ts': { placeIcon: () => 'PlaceIcon' },
    './SwipeLock.tsx': {
      useSwipeLock: () => ({
        acquire: () => {
          locks++;
          let held = true;
          return () => {
            if (held) {
              locks--;
              held = false;
            }
          };
        },
      }),
    },
  }).mount('TransitMap', {
    center: { lat: 43, lng: -81 },
    places: [],
    stops: [],
    selectedPlace: null,
    selectedStop: null,
    draft: null,
    onPlace: () => undefined,
    onStop: () => undefined,
    onInteraction: (active: boolean) => interaction.push(active),
  });
  const props = nodes(await screen.settle()).find((n) => n.type === 'MapView')!.props;
  props.onTouchStart();
  props.onTouchStart();
  assert.equal(locks, 1);
  props.onTouchEnd({ nativeEvent: { touches: [{}] } });
  assert.equal(locks, 1, 'one remaining finger still owns the map');
  props.onTouchEnd({ nativeEvent: { touches: [] } });
  assert.equal(locks, 0);
  props.onTouchStart();
  props.onTouchCancel();
  assert.equal(locks, 0);
  assert.equal(interaction.at(-1), false);
});

test('native markers select stable identifiers and only background map taps create a draft point', async () => {
  const selected: string[] = [];
  const points: { lat: number; lng: number }[] = [];
  const screen = renderModule('src/ui/TransitMap.native.tsx', {
    'react-native-maps': { __esModule: true, default: 'MapView', Marker: 'Marker' },
    './icons.ts': { Bus: 'Bus' },
    './placeIcons.ts': { placeIcon: () => 'PlaceIcon' },
    './SwipeLock.tsx': { useSwipeLock: () => ({ acquire: () => () => undefined }) },
  }).mount('TransitMap', {
    center: { lat: 43, lng: -81 },
    places: [{ id: 'door', name: 'Door', lat: 43, lng: -81 }],
    stops: [['STOP', '10', 'Road NB', 43, -81]],
    selectedPlace: 'door',
    selectedStop: 'STOP',
    draft: null,
    onPlace: (id: string) => selected.push(id),
    onStop: (id: string) => selected.push(id),
    onPoint: (p: { lat: number; lng: number }) => points.push(p),
  });
  const tree = nodes(await screen.settle());
  const markers = tree.filter((n) => n.type === 'Marker');
  assert.ok(
    markers[0].props.zIndex > markers[1].props.zIndex,
    'a place overlapping a stop draws above it',
  );
  assert.equal(markers[0].props.displayPriority, 'required');
  assert.equal(markers[1].props.displayPriority, 'low');
  assert.equal(nodes(markers[0].props.children)[0].type, 'View');
  assert.ok(
    nodes(markers[0].props.children).some((n) => n.type === 'PlaceIcon'),
    'a place shows its own icon',
  );
  markers[0].props.onPress();
  markers[1].props.onPress();
  assert.deepEqual(selected, ['door', 'STOP']);
  const props = tree.find((n) => n.type === 'MapView')!.props;
  props.onPress({
    nativeEvent: { action: 'marker-press', coordinate: { latitude: 44, longitude: -82 } },
  });
  assert.deepEqual(points, []);
  props.onPress({ nativeEvent: { action: 'press', coordinate: { latitude: 44, longitude: -82 } } });
  assert.deepEqual(points, [{ lat: 44, lng: -82 }]);
});

test('native live map retains measured bus points and draws only the selected trip geometry', async () => {
  const screen = renderModule('src/ui/TransitMap.native.tsx', {
    'react-native-maps': {
      __esModule: true,
      default: 'MapView',
      Marker: 'Marker',
      Polyline: 'Polyline',
    },
    './icons.ts': { Bus: 'Bus' },
    './placeIcons.ts': { placeIcon: () => 'PlaceIcon' },
    './SwipeLock.tsx': { useSwipeLock: () => ({ acquire: () => () => undefined }) },
  }).mount('TransitMap', {
    center: { lat: 43, lng: -81 },
    places: [],
    stops: [],
    selectedPlace: null,
    selectedStop: null,
    draft: null,
    onPlace: () => undefined,
    onStop: () => undefined,
    buses: [
      {
        id: 'report',
        label: '02 → Short turn',
        lat: 43.01,
        lng: -81.02,
        measuredAt: 1,
        stale: true,
      },
    ],
    routePoints: [
      { lat: 43, lng: -81 },
      { lat: 43.01, lng: -81.02 },
    ],
  });
  let tree = nodes(await screen.settle());
  const bus = tree.find((n) => n.type === 'Marker')!;
  assert.deepEqual(bus.props.coordinate, { latitude: 43.01, longitude: -81.02 });
  assert.match(bus.props.description, /Último reporte/);
  assert.ok(
    nodes(bus.props.children).some((n) => n.type === 'Bus'),
    'a bus is drawn as a bus',
  );
  assert.match(bus.props.title, /Short turn/);
  assert.deepEqual(tree.find((n) => n.type === 'Polyline')!.props.coordinates, [
    { latitude: 43, longitude: -81 },
    { latitude: 43.01, longitude: -81.02 },
  ]);
  tree = nodes(await screen.settle());
  assert.deepEqual(tree.find((n) => n.type === 'Marker')!.props.coordinate, bus.props.coordinate);
});

test('panning a native map loads the stops in its new region while keeping place markers', async () => {
  const screen = renderModule('src/ui/TransitMap.native.tsx', {
    'react-native-maps': { __esModule: true, default: 'MapView', Marker: 'Marker' },
    './icons.ts': { Bus: 'Bus' },
    './placeIcons.ts': { placeIcon: () => 'PlaceIcon' },
    './SwipeLock.tsx': { useSwipeLock: () => ({ acquire: () => () => undefined }) },
  }).mount('TransitMap', {
    center: { lat: 43, lng: -81 },
    places: [{ id: 'home', name: 'Home', lat: 43, lng: -81 }],
    stops: [
      ['near', '', 'Near', 43, -81],
      ['far', '', 'Far', 43.1, -81.1],
    ],
    selectedPlace: 'home',
    selectedStop: null,
    draft: null,
    onPlace() {},
    onStop() {},
  });
  let tree = nodes(await screen.settle());
  const markers = () => tree.filter((n) => n.type === 'Marker').map((n) => n.props.identifier);
  assert.deepEqual(markers(), ['home', 'near']);
  tree
    .find((n) => n.type === 'MapView')!
    .props.onRegionChangeComplete({
      latitude: 43.1,
      longitude: -81.1,
      latitudeDelta: 0.012,
      longitudeDelta: 0.012,
    });
  tree = nodes(await screen.settle());
  assert.deepEqual(markers(), ['home', 'far']);
});

test('native personal paths and crossing pins coexist with the last trip location', async () => {
  const selected: string[] = [];
  const points = [
    { lat: 43, lng: -81 },
    { lat: 43.01, lng: -81.01 },
  ];
  const screen = renderModule('src/ui/TransitMap.native.tsx', {
    'react-native-maps': {
      __esModule: true,
      default: 'MapView',
      Marker: 'Marker',
      Polyline: 'Polyline',
    },
    './icons.ts': { Bus: 'Bus' },
    './placeIcons.ts': { placeIcon: () => 'PlaceIcon' },
    './SwipeLock.tsx': { useSwipeLock: () => ({ acquire: () => () => undefined }) },
  }).mount('TransitMap', {
    center: points[0],
    places: [],
    stops: [],
    selectedPlace: null,
    selectedStop: null,
    draft: null,
    onPlace() {},
    onStop() {},
    walkPaths: [{ id: 'walk', points }],
    notes: [{ id: 'crossing', lat: 43.005, lng: -81.005, kind: 'button', note: 'Button' }],
    location: { ...points[0], at: 1, accuracy: 8 },
    onNote: (id: string) => selected.push(id),
  });
  const tree = nodes(await screen.settle());
  assert.equal(tree.find((n) => n.type === 'Polyline')!.props.coordinates.length, 2);
  tree.find((n) => n.props.identifier === 'note-crossing')!.props.onPress();
  assert.deepEqual(selected, ['crossing']);
  assert.match(tree.find((n) => n.props.identifier === 'trip-location')!.props.description, /±8 m/);
});

test('the followed bus is drawn apart, named, and the camera goes to it once per tap', async () => {
  const moves: unknown[] = [];
  let map: { props: Record<string, any> } | undefined;
  const props: Record<string, any> = {
    center: { lat: 43, lng: -81 },
    places: [],
    stops: [],
    selectedPlace: null,
    selectedStop: null,
    draft: null,
    onPlace: () => undefined,
    onStop: () => undefined,
    buses: [
      { id: 'other', label: 'Bus 3667', lat: 43.01, lng: -81.02, measuredAt: 1, stale: false },
    ],
    followed: {
      lat: 43.012,
      lng: -81.19,
      label: 'Bus 3511 · 17 → Argyle Mall · GPS',
      tag: '3511 · GPS',
      placedBy: 'gps',
      measuredAt: 1,
    },
    focus: null,
  };
  const screen = renderModule('src/ui/TransitMap.native.tsx', {
    'react-native-maps': {
      __esModule: true,
      // A stand-in that hands the component a camera to record.
      default: (mapProps: Record<string, any>) => {
        map = { props: mapProps };
        mapProps.ref.current = { animateToRegion: (region: unknown) => moves.push(region) };
        return { type: 'MapView', props: mapProps };
      },
      Marker: 'Marker',
      Polyline: 'Polyline',
    },
    './icons.ts': { Bus: 'Bus' },
    './placeIcons.ts': { placeIcon: () => 'PlaceIcon' },
    './SwipeLock.tsx': { useSwipeLock: () => ({ acquire: () => () => undefined }) },
  }).mount('TransitMap', props);
  let tree = nodes(await screen.settle());
  const followed = tree.find((n) => n.type === 'Marker' && n.props.identifier === 'followed')!;
  assert.match(followed.props.title, /3511/);
  assert.match(textOf(followed), /3511 · GPS/, 'its number is written under it');
  assert.equal(
    tree.filter((n) => n.type === 'Marker' && /^bus-/.test(n.props.identifier)).length,
    1,
    'the other buses stay as they were',
  );
  props.focus = { key: 1, point: { lat: 43.012, lng: -81.19 } };
  await screen.settle();
  const centred = moves.length;
  map!.props.onMapReady();
  await screen.settle();
  assert.equal(moves.length, centred + 1, 'a tap before the map is ready waits for it');
  assert.deepEqual(moves.at(-1), {
    latitude: 43.012,
    longitude: -81.19,
    latitudeDelta: 0.008,
    longitudeDelta: 0.008,
  });
  props.followed = { ...props.followed, lat: 43.013 };
  await screen.settle();
  assert.equal(moves.length, centred + 1, 'the camera does not chase the bus');
  props.focus = { key: 2, point: { lat: 43.012, lng: -81.19 } };
  await screen.settle();
  assert.equal(moves.length, centred + 2, 'another tap at the same point moves it again');
});

test('the live map takes the followed bus from the trip evidence and leaves it out of the rest', async (t) => {
  const { scheduleFixture } = await import('../transit/fixtures.ts');
  const realtime = await import('../transit/realtime.ts');
  const { scheduledTime } = await import('../transit/schedule.ts');
  const schedule = scheduleFixture();
  const trip = schedule.trips[1];
  const departure = {
    trip,
    route: schedule.routes[0],
    stopTime: schedule.patterns[0][0],
    serviceDate: '2026-10-11',
    at: scheduledTime('2026-10-11', trip[7]),
  };
  const now = departure.at + 180_000;
  t.mock.method(Date, 'now', () => now);
  const health = { status: 'ok' as const, feedTimestamp: now, fetchedAt: now, error: null };
  const identity = {
    tripId: trip[0],
    serviceDate: departure.serviceDate,
    routeId: '02',
    directionId: null,
    startTime: null,
  };
  const snapshot = {
    schema: 1 as const,
    generatedAt: now,
    staticVersion: schedule.feedVersion,
    staticSourceSha256: schedule.sourceSha256,
    staticCompatible: true,
    health: { trips: health, vehicles: health, alerts: health },
    tripUpdates: [],
    vehicles: [
      {
        ...identity,
        entityId: 'followed',
        vehicleId: '3511',
        measuredAt: now - 10_000,
        stopId: null,
        stopSequence: null,
        status: null,
        position: { lat: 43.00005, lng: -81.00005, bearing: null, speed: null },
      },
      {
        ...identity,
        tripId: 'weekday-late',
        entityId: 'other',
        vehicleId: '3667',
        measuredAt: now - 10_000,
        stopId: null,
        stopSequence: null,
        status: null,
        position: { lat: 43.01, lng: -81.01, bearing: null, speed: null },
      },
    ],
    alerts: [],
    issues: { unmatchedTrips: 0, ambiguousStops: 0, invalidEntities: 0, truncated: false },
  };
  const props: Record<string, any> = {
    schedule,
    snapshot,
    active: false,
    followed: departure,
    focusKey: null,
    center: { lat: 43, lng: -81 },
    places: [],
    stops: [],
    selectedPlace: null,
    selectedStop: null,
    draft: null,
    onPlace: () => undefined,
    onStop: () => undefined,
  };
  const screen = renderModule('src/ui/TransitLiveMap.tsx', {
    './TransitMap': { TransitMap: 'TransitMap' },
    './TransitMapFilters.tsx': { TransitMapFilters: 'TransitMapFilters' },
    '../transit/realtime.ts': realtime,
    './TransitDepartures.tsx': { useLiveClock: () => now },
  }).mount('TransitLiveMap', props);
  let map = nodes(await screen.settle()).find((n) => n.type === 'TransitMap')!;
  const line = realtime.tripLiveDetail(schedule, departure, snapshot, now).bus!;
  assert.deepEqual(
    { lat: map.props.followed.lat, lng: map.props.followed.lng },
    line.point,
    'the map and the line show the same bus at the same point',
  );
  assert.equal(map.props.followed.tag, '3511 · GPS');
  assert.deepEqual(
    map.props.buses.map((b: { label: string }) => b.label),
    ['Bus 3667 · 02 → 2A Downtown'],
    'the followed bus is not drawn twice, and the others stay',
  );
  assert.equal(map.props.focus, null);
  props.focusKey = 7;
  map = nodes(await screen.settle()).find((n) => n.type === 'TransitMap')!;
  assert.deepEqual(map.props.focus, { key: 7, point: line.point });
});

test('native itinerary viewport fits both endpoints once, then fits a single endpoint without chasing live updates', async () => {
  const moves: any[] = [];
  let camera: any;
  const start = { lat: 43, lng: -81.3 },
    end = { lat: 43.04, lng: -81.1 };
  const props: Record<string, any> = {
    center: start,
    places: [],
    stops: [],
    selectedPlace: null,
    selectedStop: null,
    draft: null,
    viewport: { key: 'start/end', points: [start, end] },
    onPlace() {},
    onStop() {},
    journeyPaths: [
      { id: 'bus-a', points: [start, end], color: '#173D6F', dashed: false },
      { id: 'bus-b', points: [end, start], color: '#872378', dashed: false },
      { id: 'walk', points: [start, end], color: '#121212', dashed: true },
    ],
  };
  const screen = renderModule('src/ui/TransitMap.native.tsx', {
    'react-native-maps': {
      __esModule: true,
      Marker: 'Marker',
      Polyline: 'Polyline',
      default: (p: any) => {
        camera = p;
        p.ref.current = {
          animateToRegion: (region: any) => moves.push({ region }),
          fitToCoordinates: (points: any, options: any) => moves.push({ points, options }),
        };
        return { type: 'MapView', props: p };
      },
    },
    './icons.ts': { Bus: 'Bus' },
    './placeIcons.ts': { placeIcon: () => 'PlaceIcon' },
    './SwipeLock.tsx': { useSwipeLock: () => ({ acquire: () => () => undefined }) },
  }).mount('TransitMap', props);
  await screen.settle();
  assert.equal(moves.length, 0, 'wait for the native map');
  camera.onMapReady();
  let tree = nodes(await screen.settle());
  assert.deepEqual(
    moves[0].points,
    [start, end].map((p) => ({ latitude: p.lat, longitude: p.lng })),
  );
  const lines = tree.filter((n) => n.type === 'Polyline');
  assert.deepEqual(
    lines.map((n) => n.props.strokeColor),
    ['#173D6F', '#872378', '#121212'],
  );
  assert.equal(lines[0].props.lineDashPattern, undefined);
  assert.deepEqual(lines[2].props.lineDashPattern, [7, 5]);
  props.viewport = { key: 'start/end', points: [{ ...start }, { ...end }] };
  props.buses = [{ id: 'one', label: 'Bus', ...end, stale: false, measuredAt: 1 }];
  await screen.settle();
  assert.equal(moves.length, 1, 'equivalent geometry and live buses do not reset a pan');
  props.viewport = { key: 'end', points: [end] };
  tree = nodes(await screen.settle());
  assert.equal(moves.length, 2);
  assert.equal(moves[1].region.latitude, end.lat);
  assert.equal(moves[1].region.longitude, end.lng);
});
