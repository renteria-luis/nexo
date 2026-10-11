import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodes, renderModule } from './test-render.ts';

test('native map gestures retain the swipe lock for a full pinch and release on end or cancellation', async () => {
  let locks = 0;
  const interaction: boolean[] = [];
  const screen = renderModule('src/ui/TransitMap.native.tsx', {
    'react-native-maps': { __esModule: true, default: 'MapView', Marker: 'Marker' },
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
    './SwipeLock.tsx': { useSwipeLock: () => ({ acquire: () => () => undefined }) },
  }).mount('TransitMap', {
    center: { lat: 43, lng: -81 },
    places: [{ id: 'door', name: 'Door', lat: 43, lng: -81 }],
    stops: [['STOP', '10', 'Road NB', 43.01, -81.01]],
    selectedPlace: 'door',
    selectedStop: 'STOP',
    draft: null,
    onPlace: (id: string) => selected.push(id),
    onStop: (id: string) => selected.push(id),
    onPoint: (p: { lat: number; lng: number }) => points.push(p),
  });
  const tree = nodes(await screen.settle());
  const markers = tree.filter((n) => n.type === 'Marker');
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
  assert.match(bus.props.title, /Short turn/);
  assert.deepEqual(tree.find((n) => n.type === 'Polyline')!.props.coordinates, [
    { latitude: 43, longitude: -81 },
    { latitude: 43.01, longitude: -81.02 },
  ]);
  tree = nodes(await screen.settle());
  assert.deepEqual(tree.find((n) => n.type === 'Marker')!.props.coordinate, bus.props.coordinate);
});
