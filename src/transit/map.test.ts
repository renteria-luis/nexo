import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plannerFixture } from './fixtures.ts';
import { itineraryPaths, mapRegion, ridePath } from './map.ts';
import { buildPlannerIndex, liveOptions, runPlan, startPlan } from './planner.ts';
import { queryInstant } from './schedule.ts';
import type { Place, WalkLink } from './store.ts';

const schedule = plannerFixture();
const place = (id: string, lat: number, lng: number): Place => ({
  id,
  name: id,
  lat,
  lng,
  address: '',
  icon: 'pin',
  gym_id: null,
  tags: '',
  category: '',
  importance: null,
  updated_at: 0,
});
const origin = place('start', 43, -81.2);
const target = place('end', 42.9878, -81.17);
const at = queryInstant('2026-10-13', '08:00');
async function options() {
  const result = await runPlan(
    startPlan(buildPlannerIndex(schedule), {
      origin,
      destination: target,
      originWalks: new Map(),
      destinationWalks: new Map(),
      stopWalks: [],
      mode: 'now',
      at,
    }),
    { pause: async () => {}, cancelled: () => false },
  );
  return liveOptions(result!, null, at);
}

test('a transfer draws each ridden bus separately and all three walks in black dashes', async () => {
  const option = (await options()).find((p) => p.itinerary.rides.length === 2)!;
  const paths = itineraryPaths(schedule, option.itinerary, origin, target, [], []);
  assert.deepEqual(
    paths.filter((p) => !p.dashed).map((p) => p.color),
    option.itinerary.rides.map((r) => r.route[3]),
  );
  const walks = paths.filter((p) => p.dashed);
  assert.deepEqual(
    walks.map((p) => p.id),
    ['access', 'transfer', 'egress'],
  );
  assert.ok(walks.every((p) => p.color === '#121212' && p.points.length >= 2));
  assert.deepEqual(walks[0].points[0], origin);
  assert.deepEqual(walks[2].points.at(-1), target);
  for (const [i, ride] of option.itinerary.rides.entries()) {
    const riddenStops = schedule.patterns[ride.trip[6]]
      .slice(ride.board, ride.alight + 1)
      .map(([s]) => ({ lat: schedule.stops[s][3], lng: schedule.stops[s][4] }));
    assert.deepEqual(
      paths[i].points,
      riddenStops,
      'the fixture has no shapes, so ordered ride stops are the fallback',
    );
  }
});

test('bus paths clip to boarding and alighting instead of drawing the whole service', async () => {
  const ride = (await options()).find((p) => p.itinerary.rides.length === 2)!.itinerary.rides[0];
  const pattern = schedule.patterns[ride.trip[6]];
  const shape = pattern.map(
    ([s], i) => [schedule.stops[s][3], schedule.stops[s][4], i] as [number, number, number],
  );
  const withShape = { ...schedule, shapes: { ...schedule.shapes, [ride.trip[5]]: shape } };
  const clipped = ridePath(withShape, { ...ride, board: 1 });
  assert.deepEqual(clipped[0], { lat: shape[1][0], lng: shape[1][1] });
  assert.deepEqual(clipped.at(-1), { lat: shape.at(-1)![0], lng: shape.at(-1)![1] });
  assert.ok(!clipped.some((p) => p.lat === shape[0][0] && p.lng === shape[0][1]));
});

test('a saved directional walk is used only for that place, stop and direction', async () => {
  const option = (await options()).find((p) => p.itinerary.rides.length > 0)!;
  const point = { lat: 43.0001, lng: -81.2002 };
  const link: WalkLink = {
    place_id: origin.id,
    stop_id: schedule.stops[option.itinerary.access.to!][0],
    direction: 'to_stop',
    minutes: 2,
    entrance: '',
    path: JSON.stringify([
      [point.lat, point.lng],
      [43.0002, -81.2002],
    ]),
    updated_at: 0,
  };
  const access = (links: WalkLink[]) =>
    itineraryPaths(schedule, option.itinerary, origin, target, links, []).find(
      (p) => p.id === 'access',
    )!;
  assert.ok(access([link]).points.some((p) => p.lat === point.lat && p.lng === point.lng));
  assert.equal(access([{ ...link, direction: 'from_stop' }]).points.length, 2);
  assert.equal(access([{ ...link, path: 'corrupt' }]).points.length, 2);
});

test('the camera includes either endpoint alone or both with room around their markers', () => {
  for (const points of [[origin], [target], [origin, target]]) {
    const region = mapRegion(points);
    for (const point of points) {
      assert.ok(Math.abs(point.lat - region.center.lat) < region.latDelta / 2);
      assert.ok(Math.abs(point.lng - region.center.lng) < region.lngDelta / 2);
    }
    assert.ok(region.latDelta > 0 && region.lngDelta > 0);
  }
});
