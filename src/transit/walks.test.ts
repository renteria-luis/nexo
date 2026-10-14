import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plannerFixture } from './fixtures.ts';
import { buildPlannerIndex, liveOptions, startPlan } from './planner.ts';
import { queryInstant } from './schedule.ts';
import {
  learnedWalks,
  parsePath,
  pathFromTrace,
  personalWalks,
  serializePath,
  walkKey,
  type WalkObservation,
} from './walks.ts';

const walk = (
  minutes: number,
  ended: number,
  status: WalkObservation['status'] = 'accepted',
  to = 'S1',
) => ({
  kind: 'access' as const,
  place_id: 'home',
  from_stop: null,
  to_stop: to,
  started_at: ended - minutes * 60_000,
  ended_at: ended,
  status,
});

test('learning needs three accepted walks and one odd walk does not move it', () => {
  assert.equal(learnedWalks([walk(6, 1), walk(7, 2)]).size, 0);
  const steady = learnedWalks([walk(6, 1), walk(7, 2), walk(6.4, 3)]);
  assert.deepEqual(steady.get('access:home>S1'), { minutes: 7, low: 6, high: 7, count: 3 });
  // A run and a walk he excluded change nothing; the median holds.
  const odd = learnedWalks([
    walk(6, 1),
    walk(7, 2),
    walk(6.4, 3),
    walk(2.5, 4),
    walk(1, 5, 'excluded'),
    walk(4, 6, 'new'),
  ]);
  assert.equal(odd.get('access:home>S1')?.minutes, 7);
  assert.equal(odd.get('access:home>S1')?.low, 2.5);
  // Only the ten latest accepted count.
  const habit = learnedWalks([
    ...Array.from({ length: 10 }, (_, i) => walk(4, 100 + i)),
    ...Array.from({ length: 5 }, (_, i) => walk(9, i)),
  ]);
  assert.deepEqual(habit.get('access:home>S1'), { minutes: 4, low: 4, high: 4, count: 10 });
  assert.equal(
    walkKey({ kind: 'egress', place_id: 'work', from_stop: 'S2', to_stop: null }),
    'egress:S2>work',
  );
});

test('typed minutes outrank learned ones, and learned ones are labelled in the plan', () => {
  const learned = new Map([
    ['access:origin>ORIGIN_SB', { minutes: 4, low: 3, high: 5, count: 3 }],
    ['access:origin>ORIGIN_NB', { minutes: 9, low: 8, high: 9, count: 4 }],
    ['egress:END_EB>destination', { minutes: 2, low: 2, high: 2, count: 3 }],
    ['transfer:CORNER_SB>CORNER_EB', { minutes: 3, low: 2, high: 3, count: 3 }],
    ['access:elsewhere>ORIGIN_SB', { minutes: 1, low: 1, high: 1, count: 3 }],
  ]);
  const walks = personalWalks({
    originId: 'origin',
    destinationId: 'destination',
    origin: [{ stop_id: 'ORIGIN_NB', direction: 'to_stop', minutes: 6 }],
    destination: [],
    stops: [],
    learned,
  });
  assert.deepEqual(
    [...walks.originWalks],
    [
      ['ORIGIN_NB', 6],
      ['ORIGIN_SB', 4],
    ],
  );
  assert.deepEqual([...walks.destinationWalks], [['END_EB', 2]]);
  assert.deepEqual(walks.stopWalks, [{ from_stop: 'CORNER_SB', to_stop: 'CORNER_EB', minutes: 3 }]);
  assert.deepEqual([...walks.learned], ['to:ORIGIN_SB', 'from:END_EB', 'CORNER_SB>CORNER_EB']);

  const schedule = plannerFixture();
  const now = queryInstant('2026-10-13', '08:00');
  const search = startPlan(buildPlannerIndex(schedule), {
    origin: { lat: 43.0015, lng: -81.2001 },
    destination: { lat: 42.987, lng: -81.1701 },
    ...walks,
    mode: 'depart',
    at: now,
  });
  while (!search.step(1_000));
  const option = liveOptions(search.result(), null, now).find(
    (o) => o.itinerary.rides.length === 2 && o.itinerary.access.to !== null,
  )!;
  assert.equal(option.itinerary.access.source, 'learned');
  assert.equal(option.itinerary.access.minutes, 4);
  assert.equal(option.itinerary.transfer?.source, 'learned');
  assert.equal(option.itinerary.egress?.source, 'learned');
});

test('a kept path is rounded, bounded and simplified from the readings', () => {
  const straight = Array.from(
    { length: 50 },
    (_, i) => [43 + i * 0.0001, -81.2, i * 1_000] as [number, number, number],
  );
  const corner: [number, number, number][] = [
    ...straight,
    ...Array.from(
      { length: 50 },
      (_, i) => [43.0049, -81.2 + (i + 1) * 0.0001, 50_000 + i * 1_000] as [number, number, number],
    ),
  ];
  assert.equal(pathFromTrace(straight).length, 2);
  assert.equal(pathFromTrace(corner).length, 3);
  assert.deepEqual(
    pathFromTrace([
      [43, -81.2, 0],
      [43.001, -81.2, 1_000],
      [43.0005, -81.2, 2_000],
    ]),
    [
      { lat: 43, lng: -81.2 },
      { lat: 43.001, lng: -81.2 },
      { lat: 43.0005, lng: -81.2 },
    ],
    'retracing the same sidewalk keeps the turning point',
  );
  const text = serializePath(pathFromTrace(corner));
  assert.deepEqual(parsePath(text), [
    { lat: 43, lng: -81.2 },
    { lat: 43.0049, lng: -81.2 },
    { lat: 43.0049, lng: -81.195 },
  ]);
  assert.equal(serializePath([]), '');
  assert.deepEqual(parsePath(''), []);
  assert.throws(
    () =>
      serializePath([
        { lat: 91, lng: 0 },
        { lat: 0, lng: 0 },
      ]),
    /2 a 120/,
  );
  assert.throws(() => parsePath('[[1]]'), /2 a 120/);
});
