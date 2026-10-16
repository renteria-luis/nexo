import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as activeTrip from '../transit/active-trip.ts';
import { plannerFixture } from '../transit/fixtures.ts';
import * as map from '../transit/map.ts';
import { buildPlannerIndex, liveOptions, startPlan } from '../transit/planner.ts';
import * as realtime from '../transit/realtime.ts';
import { queryInstant } from '../transit/schedule.ts';
import * as routeColors from './routeColors.ts';
import { nodes, renderModule } from './test-render.ts';

const at = (clock: string) => queryInstant('2026-10-13', clock);
const schedule = plannerFixture();

function trip() {
  const origin = { id: 'origin', name: 'Casa', lat: 43.0015, lng: -81.2001 };
  const destination = { id: 'destination', name: 'Trabajo', lat: 42.987, lng: -81.1701 };
  const search = startPlan(buildPlannerIndex(schedule), {
    origin,
    destination,
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
  return activeTrip.freezeTrip({
    id: 'trip',
    journeyId: null,
    schedule,
    option,
    origin,
    destination,
    now: at('08:25'),
  });
}

test('the trip map shows only the trip: its lines, a dot per stop, the phone dot and recentring', async () => {
  const frozen = trip();
  const screen = renderModule('src/ui/TransitTripMap.tsx', {
    '../transit/active-trip.ts': activeTrip,
    '../transit/map.ts': map,
    '../transit/realtime.ts': realtime,
    './TransitMap': { TransitMap: 'TransitMap' },
    './TransitLiveMap.tsx': { followedMarker: () => null },
    './routeColors.ts': routeColors,
    './Button.tsx': { Button: 'Button' },
  }).mount('TransitTripMap', {
    trip: {
      ...frozen,
      lastFix: { lat: 43.001, lng: -81.2, accuracy: 5, speed: null, at: at('08:26') },
    },
    live: { schedule, snapshot: null },
    now: at('08:26'),
    places: [],
  });
  let tree = await screen.settle();
  const shown = () => nodes(tree).find((n) => n.type === 'TransitMap')!.props;
  assert.deepEqual(shown().stops, [], 'no other stops');
  assert.equal(shown().showsUserLocation, true);
  assert.equal(
    shown().stopDots.length,
    frozen.rides.reduce((sum, ride) => sum + ride.stops.length, 0),
  );
  assert.deepEqual(
    shown()
      .journeyPaths.filter((p: map.JourneyPath) => !p.dashed)
      .map((p: map.JourneyPath) => p.color),
    frozen.rides.map((ride) => routeColors.routeColor(ride.color)),
  );
  const fitted = shown().viewport.key;
  nodes(tree)
    .find((n) => n.props.label === 'Todo el viaje')!
    .props.onPress();
  tree = await screen.settle();
  assert.notEqual(shown().viewport.key, fitted, 'the camera fits the whole trip again');
  nodes(tree)
    .find((n) => n.props.label === 'Dónde estoy')!
    .props.onPress();
  tree = await screen.settle();
  assert.deepEqual(
    { lat: shown().focus.point.lat, lng: shown().focus.point.lng },
    { lat: 43.001, lng: -81.2 },
  );
});
