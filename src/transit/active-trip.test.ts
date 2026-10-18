import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Coordinates } from '../core/geo.ts';
import {
  applyAction,
  applyClock,
  applyFix,
  freezeTrip,
  isActive,
  parseActiveTrip,
  rideStopAt,
  tripAlarms,
  tripLiveSelection,
  walkAhead,
  ALARM_AFTER_MS,
  type ActiveTrip,
  type Fix,
  type TripEvent,
  type TripLive,
  type WalkObservationDraft,
} from './active-trip.ts';
import { plannerFixture } from './fixtures.ts';
import { tripLayers } from './map.ts';
import { buildPlannerIndex, liveOptions, startPlan, type PlanOption } from './planner.ts';
import type { LiveSnapshot } from './realtime.ts';
import { queryInstant, type Schedule } from './schedule.ts';

// Invented places on the planner fixture's invented network: the origin 130 m north of its
// first stop, the destination 70 m south of the last one.
const ORIGIN = { id: 'origin', name: 'Origin', lat: 43.0015, lng: -81.2001 };
const DESTINATION = { id: 'destination', name: 'Destination', lat: 42.987, lng: -81.1701 };
const at = (clock: string) => queryInstant('2026-10-13', clock);
const second = (clock: string, seconds: number) => at(clock) + seconds * 1_000;

function setup(trips: string, start = at('08:25'), destination = DESTINATION) {
  const schedule = plannerFixture();
  const search = startPlan(buildPlannerIndex(schedule), {
    origin: ORIGIN,
    destination,
    originWalks: new Map(),
    destinationWalks: new Map(),
    stopWalks: [],
    mode: 'depart',
    at: at('08:00'),
  });
  while (!search.step(1_000));
  const option = liveOptions(search.result(), null, at('08:00')).find(
    (o: PlanOption) => o.itinerary.rides.map((r) => r.trip[0]).join('>') === trips,
  )!;
  const trip = freezeTrip({
    id: 'trip',
    journeyId: 'journey',
    schedule,
    option,
    origin: ORIGIN,
    destination,
    now: start,
  });
  return { schedule, option, trip };
}

const fix = (point: Coordinates, when: number, extra: Partial<Fix> = {}): Fix => ({
  lat: point.lat,
  lng: point.lng,
  accuracy: 8,
  speed: null,
  at: when,
  ...extra,
});

function run(trip: ActiveTrip, fixes: Fix[], context: TripLive | null = null) {
  const events: TripEvent[] = [];
  const observations: WalkObservationDraft[] = [];
  let current = trip;
  for (const reading of fixes) {
    const step = applyFix(current, reading, context);
    current = step.trip;
    events.push(...step.events);
    observations.push(...step.observations);
  }
  return { trip: current, events, observations };
}

// The 16 leaves the origin's stop at 08:30, passes the middle stop at 08:34 and reaches the
// corner at 08:38; the 20 leaves the corner at 08:45 and reaches the end at 08:55.
const walkToStop = [
  fix({ lat: 43.0015, lng: -81.2001 }, second('08:25', 5)),
  fix({ lat: 43.0011, lng: -81.2001 }, second('08:25', 40)),
  fix({ lat: 43.0007, lng: -81.2001 }, second('08:26', 15)),
  fix({ lat: 43.0004, lng: -81.2001 }, second('08:26', 45)),
];
const rideSouth = [
  fix({ lat: 43.0003, lng: -81.2001 }, second('08:29', 30)),
  fix({ lat: 42.9985, lng: -81.2001 }, second('08:30', 20), { speed: 10 }),
  fix({ lat: 42.9967, lng: -81.2001 }, second('08:30', 40), { speed: 11 }),
  fix({ lat: 42.9949, lng: -81.2001 }, second('08:31', 0), { speed: 11 }),
  fix({ lat: 42.9937, lng: -81.2001 }, second('08:31', 10), { speed: 11 }),
  fix({ lat: 42.9882, lng: -81.2001 }, second('08:37', 50), { speed: 3 }),
  fix({ lat: 42.9879, lng: -81.1997 }, second('08:38', 20)),
  fix({ lat: 42.9878, lng: -81.1995 }, second('08:38', 40)),
];

test('a trip walks, boards, gets off, transfers and arrives from his readings alone', () => {
  const { trip } = setup('16S-4>20E-4');
  assert.deepEqual(
    trip.walks.map((w) => [w.kind, w.from.id, w.to.id]),
    [
      ['access', 'origin', 'ORIGIN_SB'],
      ['transfer', 'CORNER_SB', 'CORNER_EB'],
      ['egress', 'END_EB', 'destination'],
    ],
  );
  assert.deepEqual(
    trip.rides.map((r) => r.stops.map((s) => s.id)),
    [
      ['ORIGIN_SB', 'MIDDLE_SB', 'CORNER_SB'],
      ['CORNER_EB', 'EAST_EB', 'END_EB'],
    ],
  );
  const walked = run(trip, walkToStop);
  assert.equal(walked.trip.phase, 'waiting');
  assert.equal(walked.observations.length, 1);
  const access = walked.observations[0];
  assert.equal(access.kind, 'access');
  assert.equal(access.placeId, 'origin');
  assert.equal(access.toStop, 'ORIGIN_SB');
  assert.equal(access.endedAt - access.startedAt, 105_000);
  assert.equal(access.leftAt, second('08:26', 15));
  assert.equal(access.flag, null);
  assert.equal(access.trace.length, 4);

  const rode = run(walked.trip, rideSouth);
  assert.equal(rode.trip.boarded[0], 'inferred');
  assert.ok(rode.trip.log.some((e) => e.phase === 'riding' && e.at === second('08:29', 30)));
  assert.deepEqual(
    rode.events.map((e) => e.key),
    ['alight:0', 'transfer:0'],
  );
  assert.equal(rode.events[0].title, 'Bájate en la próxima');
  assert.match(rode.events[0].body, /CORNER SB/);
  assert.equal(rode.trip.phase, 'transferring');
  assert.equal(rode.trip.leg, 1);

  const transferred = run(rode.trip, [
    fix({ lat: 42.9876, lng: -81.1994 }, second('08:39', 30)),
    fix({ lat: 42.9876, lng: -81.1993 }, second('08:44', 50)),
    fix({ lat: 42.9876, lng: -81.195 }, second('08:45', 30), { speed: 9 }),
    fix({ lat: 42.9876, lng: -81.192 }, second('08:45', 50), { speed: 9 }),
    fix({ lat: 42.9876, lng: -81.1845 }, second('08:47', 40), { speed: 9 }),
    fix({ lat: 42.9876, lng: -81.1703 }, second('08:55', 0), { speed: 2 }),
    fix({ lat: 42.9873, lng: -81.1701 }, second('08:55', 30)),
    fix({ lat: 42.9871, lng: -81.1701 }, second('08:55', 50)),
    fix({ lat: 42.987, lng: -81.1701 }, second('08:56', 20)),
  ]);
  assert.deepEqual(
    transferred.observations.map((o) => [o.kind, o.fromStop, o.toStop, o.placeId]),
    [
      ['transfer', 'CORNER_SB', 'CORNER_EB', null],
      ['egress', 'END_EB', null, 'destination'],
    ],
  );
  assert.equal(transferred.observations[0].startedAt, second('08:37', 50));
  assert.deepEqual(
    transferred.events.map((e) => e.key),
    ['alight:1'],
  );
  assert.equal(transferred.trip.phase, 'completed');
  assert.equal(transferred.trip.endedAt, second('08:56', 20));
  assert.equal(isActive(transferred.trip), false);
  assert.deepEqual(applyFix(transferred.trip, fix(DESTINATION, at('09:00')), null).events, []);
});

test('from where he is to a point he chose, the walk left shrinks and the trip ends at the point', () => {
  const { schedule, option } = setup('16S-4>20E-4');
  const trip = freezeTrip({
    id: 'trip',
    journeyId: null,
    schedule,
    option,
    origin: { ...ORIGIN, id: '@here', name: 'Tu ubicación', point: true },
    destination: { ...DESTINATION, id: '@point-target', name: 'Punto en el mapa', point: true },
    paths: { egress: [{ lat: 42.9876, lng: -81.1701 }, DESTINATION] },
    now: at('08:25'),
  });
  assert.deepEqual(
    [trip.origin.kind, trip.destination.kind, trip.walks[2].path?.length, trip.walks[0].path],
    ['point', 'point', 2, undefined],
  );
  const first = run(trip, walkToStop.slice(0, 2));
  const ahead = walkAhead(first.trip)!;
  const later = walkAhead(run(trip, walkToStop.slice(0, 3)).trip)!;
  assert.ok(
    later.metres < ahead.metres && ahead.metres < 150,
    `${ahead.metres} then ${later.metres}`,
  );
  assert.deepEqual(
    tripLayers(first.trip, null, at('08:26')).paths[0].points,
    [
      { lat: 43.0011, lng: -81.2001 },
      { lat: 43.0003, lng: -81.2001 },
    ],
    'the walk he is on starts where he last was',
  );
  assert.equal(
    tripLayers(first.trip, null, at('08:26')).paths[2].points.length,
    2,
    'a saved way is drawn as he saved it',
  );
  const walked = run(trip, walkToStop);
  assert.equal(walked.trip.phase, 'waiting');
  assert.deepEqual(walked.observations, [], 'nothing is learned from where he happened to be');
  const rode = run(walked.trip, rideSouth);
  const done = run(rode.trip, [
    fix({ lat: 42.9876, lng: -81.1994 }, second('08:39', 30)),
    fix({ lat: 42.9876, lng: -81.1993 }, second('08:44', 50)),
    fix({ lat: 42.9876, lng: -81.195 }, second('08:45', 30), { speed: 9 }),
    fix({ lat: 42.9876, lng: -81.192 }, second('08:45', 50), { speed: 9 }),
    fix({ lat: 42.9876, lng: -81.1845 }, second('08:47', 40), { speed: 9 }),
    fix({ lat: 42.9876, lng: -81.1703 }, second('08:55', 0), { speed: 2 }),
    fix({ lat: 42.9873, lng: -81.1701 }, second('08:55', 30)),
    fix({ lat: 42.9871, lng: -81.1701 }, second('08:55', 50)),
    fix({ lat: 42.987, lng: -81.1701 }, second('08:56', 20)),
  ]);
  assert.equal(done.trip.phase, 'completed');
  assert.deepEqual(
    done.observations.map((o) => o.kind),
    ['transfer'],
    'the transfer between two stops is still learned',
  );
  assert.equal(walkAhead(done.trip), null);
});

test('noisy, early or unmatched movement along the route never claims his bus', () => {
  const { trip, schedule } = setup('16S-4>20E-4');
  const waiting = run(trip, walkToStop).trip;
  // Rough readings change nothing.
  const rough = run(waiting, [
    fix({ lat: 42.9967, lng: -81.2001 }, second('08:30', 40), { speed: 11, accuracy: 80 }),
    fix({ lat: 42.9949, lng: -81.2001 }, second('08:31', 0), { speed: 11, accuracy: 120 }),
  ]);
  assert.equal(rough.trip.phase, 'waiting');
  assert.equal(rough.trip.stats.ignored, 2);
  // Driving south along the route well before his bus is due is something else.
  const earlier = run(
    trip,
    walkToStop.map((reading) => ({ ...reading, at: reading.at - 15 * 60_000 })),
  ).trip;
  const early = run(earlier, [
    fix({ lat: 43.0003, lng: -81.2001 }, second('08:20', 0)),
    fix({ lat: 42.9967, lng: -81.2001 }, second('08:20', 40), { speed: 12 }),
    fix({ lat: 42.9949, lng: -81.2001 }, second('08:21', 0), { speed: 12 }),
    fix({ lat: 42.9931, lng: -81.2001 }, second('08:21', 20), { speed: 12 }),
  ]);
  assert.equal(early.trip.phase, 'waiting');
  assert.equal(early.trip.boarding.doubt, 'early');
  assert.deepEqual(
    early.events.map((e) => e.key),
    ['doubt:0'],
  );
  // His bus still at the stop by LTC's GPS: what moves him is another vehicle.
  const atStop = run(waiting, [fix({ lat: 43.0003, lng: -81.2001 }, second('08:29', 30))]).trip;
  const live = withBus(schedule, second('08:30', 35), { lat: 43.0003, lng: -81.2001 });
  const other = run(
    atStop,
    [fix({ lat: 42.9949, lng: -81.2001 }, second('08:30', 40), { speed: 11 })],
    live,
  );
  assert.equal(other.trip.phase, 'waiting');
  assert.equal(other.trip.boarding.doubt, 'other-bus');
  // The same bus beside him: on it at once, and it says so.
  const beside = withBus(schedule, second('08:30', 35), { lat: 42.9968, lng: -81.2001 });
  const matched = run(
    atStop,
    [fix({ lat: 42.9967, lng: -81.2001 }, second('08:30', 40), { speed: 11 })],
    beside,
  );
  assert.equal(matched.trip.boarded[0], 'matched');
});

function withBus(schedule: Schedule, now: number, position: Coordinates): TripLive {
  const trip = schedule.trips.find((t) => t[0] === '16S-4')!;
  const snapshot: LiveSnapshot = {
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
    vehicles: [
      {
        tripId: trip[0],
        serviceDate: '2026-10-13',
        routeId: '16',
        directionId: 1,
        startTime: '08:30:00',
        entityId: 'bus',
        vehicleId: '3001',
        measuredAt: now - 2_000,
        stopId: null,
        stopSequence: null,
        status: null,
        position: { ...position, bearing: null, speed: null },
      },
    ],
    alerts: [],
    issues: { unmatchedTrips: 0, ambiguousStops: 0, invalidEntities: 0, truncated: false },
  };
  return { schedule, snapshot };
}

test('where he gets off, the bus is due when LTC says it arrives, not when it leaves', () => {
  const { trip, schedule } = setup('16S-4>20E-4');
  const now = second('08:32', 0);
  const live = withBus(schedule, now, { lat: 42.9949, lng: -81.2001 });
  const ride = trip.rides[0];
  const pattern = schedule.patterns[schedule.trips.find((t) => t[0] === ride.tripId)![6]];
  const event = (clock: string) => ({ time: at(clock), delay: null, uncertainty: null });
  live.snapshot!.tripUpdates = [
    {
      tripId: ride.tripId,
      serviceDate: ride.serviceDate,
      routeId: '16',
      directionId: 1,
      startTime: null,
      entityId: 'bus',
      vehicleId: '3001',
      measuredAt: now,
      relationship: 'scheduled',
      delay: null,
      stops: ride.stops.map((stop, index) => ({
        stopId: stop.id,
        stopSequence: pattern[stop.position][1],
        relationship: 'scheduled' as const,
        arrival: index === 0 ? null : event(index === 2 ? '08:39' : '08:35'),
        departure: event(index === 0 ? '08:30' : index === 2 ? '08:42' : '08:35'),
      })),
    },
  ];
  const last = ride.stops.length - 1;
  assert.deepEqual(rideStopAt(trip, ride, last, live, now), { at: at('08:39'), live: true });
  assert.deepEqual(rideStopAt(trip, ride, 0, live, now), { at: at('08:30'), live: true });
});

test('a walk that did not start at the origin is not learned from', () => {
  const { trip } = setup('16S-4>20E-4');
  const elsewhere = run(trip, [
    fix({ lat: 43.004, lng: -81.2001 }, second('08:25', 5)),
    fix({ lat: 43.0004, lng: -81.2001 }, second('08:27', 30)),
  ]);
  assert.equal(elsewhere.trip.phase, 'waiting');
  assert.deepEqual(elsewhere.observations, []);
});

test('running to the stop is kept but flagged as not his habitual walk', () => {
  const { trip } = setup('16S-4>20E-4');
  const ran = run(trip, [
    fix({ lat: 43.0015, lng: -81.2001 }, second('08:25', 2)),
    fix({ lat: 43.0004, lng: -81.2001 }, second('08:25', 50)),
  ]);
  assert.equal(ran.observations[0].flag, 'fast');
});

test('his own taps board, correct, get off and arrive', () => {
  const { trip } = setup('16S-4>20E-4');
  let current = applyAction(trip, 'boarded', second('08:30', 0)).trip;
  assert.equal(current.phase, 'riding');
  assert.equal(current.boarded[0], 'manual');
  current = applyAction(current, 'not-boarded', second('08:30', 30)).trip;
  assert.equal(current.phase, 'waiting');
  assert.equal(current.boarded[0], null);
  current = applyAction(current, 'boarded', second('08:31', 0)).trip;
  const off = applyAction(current, 'alighted', second('08:38', 0));
  assert.equal(off.trip.phase, 'transferring');
  assert.deepEqual(
    off.events.map((e) => e.key),
    ['transfer:0'],
  );
  assert.match(off.events[0].body, /Camina a CORNER EB/);
  current = applyAction(off.trip, 'still-riding', second('08:38', 20)).trip;
  assert.equal(current.phase, 'riding');
  assert.equal(current.leg, 0);
  current = applyAction(current, 'alighted', second('08:38', 30)).trip;
  current = applyAction(current, 'boarded', second('08:45', 0)).trip;
  current = applyAction(current, 'alighted', second('08:55', 0)).trip;
  assert.equal(current.phase, 'final');
  const arrived = applyAction(current, 'arrived', second('08:56', 30));
  assert.equal(arrived.trip.phase, 'completed');
  assert.equal(arrived.observations[0].kind, 'egress');
  assert.equal(arrived.observations[0].endSource, 'tap');
  assert.equal(arrived.observations[0].startSource, 'tap');
  const cancelled = applyAction(trip, 'cancel', second('08:26', 0));
  assert.equal(cancelled.trip.phase, 'canceled');
  assert.equal(isActive(cancelled.trip), false);
});

test('a bus waiting at his stop is not mistaken for getting off', () => {
  // A trip to the middle stop, where the 16 carries on to the corner.
  const { trip } = setup('16S-4', at('08:25'), {
    id: 'middle',
    name: 'Middle',
    lat: 42.9935,
    lng: -81.2006,
  });
  assert.deepEqual(trip.rides[0].after, [{ lat: 42.988, lng: -81.2001 }]);
  const rode = run(run(trip, walkToStop).trip, rideSouth.slice(0, 4));
  assert.equal(rode.trip.phase, 'riding');
  assert.deepEqual(
    rode.events.map((e) => e.key),
    ['alight:0'],
  );
  const lingered = run(rode.trip, [
    fix({ lat: 42.994, lng: -81.2001 }, second('08:34', 0), { speed: 0 }),
    fix({ lat: 42.994, lng: -81.2001 }, second('08:34', 50), { speed: 0 }),
  ]);
  assert.equal(lingered.trip.phase, 'final');
  const back = run(lingered.trip, [
    fix({ lat: 42.9925, lng: -81.2001 }, second('08:35', 0), { speed: 9 }),
  ]);
  assert.equal(back.trip.phase, 'riding');
  assert.equal(back.trip.leg, 0);
  const passed = run(back.trip, [
    fix({ lat: 42.991, lng: -81.2001 }, second('08:35', 10), { speed: 9 }),
  ]);
  assert.deepEqual(
    passed.events.map((e) => e.key),
    ['passed:0'],
  );
});

test('a partial delay keeps the earlier direct alighting stop and Ya bajé starts the final walk', () => {
  const schedule = plannerFixture();
  schedule.stops[0][3] = 43.01;
  schedule.stops[1][3] = 43.01;
  const origin = { ...ORIGIN, lat: 43.01 };
  const destination = { ...DESTINATION, lat: 42.9935, lng: -81.2006 };
  const now = at('08:00');
  const search = startPlan(buildPlannerIndex(schedule), {
    origin,
    destination,
    originWalks: new Map(),
    destinationWalks: new Map(),
    stopWalks: [],
    mode: 'depart',
    at: now,
  });
  while (!search.step(1_000));
  const result = search.result();
  const pool = result.pool.filter((p) => p.rides[0]?.trip[0] === '16S-3');
  assert.ok(
    pool.every((p) => p.rides.length === 1),
    'riding past the destination to come back is not an option',
  );
  const direct = pool.find((p) => p.rides.length === 1)!;
  const ride = direct.rides[0];
  const snapshot = withBus(schedule, now, origin).snapshot!;
  snapshot.coverage = { stopIds: ['ORIGIN_SB', 'MIDDLE_SB'], trips: [] };
  snapshot.tripUpdates = [
    {
      tripId: ride.trip[0],
      serviceDate: ride.serviceDate,
      routeId: ride.route[0],
      directionId: 1,
      startTime: null,
      entityId: 'delay',
      vehicleId: 'bus',
      measuredAt: now,
      relationship: 'scheduled',
      delay: 16 * 60,
      stops: [ride.departure, ride.arrival].map((departure) => ({
        stopId: schedule.stops[departure.stopTime[0]][0],
        stopSequence: departure.stopTime[1],
        relationship: 'scheduled',
        arrival: null,
        departure: { time: departure.at + 16 * 60_000, delay: 16 * 60, uncertainty: null },
      })),
    },
  ];
  const option = liveOptions({ ...result, pool, best: [direct] }, snapshot, now)[0];
  assert.equal(option.itinerary.rides.length, 1);
  const trip = freezeTrip({
    id: 'partial-delay',
    journeyId: null,
    schedule,
    option,
    origin,
    destination,
    now,
  });
  assert.equal(trip.rides[0].stops.at(-1)!.id, 'MIDDLE_SB');
  const boarded = applyAction(trip, 'boarded', option.live[0].board.at).trip;
  const alighted = applyAction(boarded, 'alighted', option.live[0].alight.at);
  assert.equal(alighted.trip.phase, 'final');
  assert.equal(alighted.trip.walks[alighted.trip.leg].to.kind, 'place');
  assert.ok(alighted.events.every((event) => event.kind !== 'transfer'));
});

test('adjacent stops warn as he boards; the clock ends a forgotten trip once', () => {
  const { trip } = setup('92S-1>20E-3', at('08:15'));
  const boarded = applyAction(trip, 'boarded', second('08:20', 0));
  assert.deepEqual(
    boarded.events.map((e) => e.key),
    ['alight:0'],
  );
  assert.equal(tripAlarms(boarded.trip, null, second('08:20', 5)).length, 1);
  assert.equal(applyClock(boarded.trip, trip.expiresAt - 1).events.length, 0);
  const expired = applyClock(boarded.trip, trip.expiresAt);
  assert.equal(expired.trip.phase, 'expired');
  assert.deepEqual(
    expired.events.map((e) => e.key),
    ['expired'],
  );
  assert.deepEqual(tripAlarms(expired.trip, null, trip.expiresAt), []);
  assert.deepEqual(applyClock(expired.trip, trip.expiresAt + 60_000).events, []);
});

test('held warnings follow the plan and give way to the GPS', () => {
  const { trip, schedule } = setup('16S-4>20E-4');
  const riding = applyAction(trip, 'boarded', second('08:32', 0)).trip;
  const [alight, expiry] = tripAlarms(riding, { schedule, snapshot: null }, second('08:32', 5));
  // Two minutes late at the first stop: the middle stop at 08:36, plus the GPS's head start.
  assert.equal(alight.key, 'alight:0');
  assert.equal(alight.at, at('08:36') + ALARM_AFTER_MS);
  assert.match(alight.body, /hora del horario/);
  assert.equal(expiry.key, 'expiry');
  const warned = run(riding, [fix({ lat: 42.9937, lng: -81.2001 }, second('08:36', 0))]);
  assert.deepEqual(
    tripAlarms(warned.trip, null, second('08:36', 5)).map((a) => a.key),
    ['expiry'],
  );
});

test('manual boarding retains the walk and a corrected boarding gets a fresh warning', () => {
  const { trip } = setup('16S-4>20E-4');
  const boarded = applyAction(trip, 'boarded', at('08:30'));
  assert.equal(boarded.observations.length, 1);
  assert.equal(boarded.observations[0].endSource, 'tap');
  const corrected = applyAction(boarded.trip, 'not-boarded', at('08:31')).trip;
  const again = applyAction(corrected, 'boarded', at('08:32')).trip;
  assert.equal(tripAlarms(again, null, at('08:32'))[0].key, 'alight:0:1');
});

test('a moving trip outlives its planned arrival; a still one does not', () => {
  const { trip } = setup('16S-4>20E-4');
  const riding = applyAction(trip, 'boarded', second('08:30', 0)).trip;
  const late = trip.expiresAt - 60_000;
  const moving = applyFix(
    riding,
    fix({ lat: 42.9967, lng: -81.2001 }, late, { speed: 8 }),
    null,
  ).trip;
  assert.equal(moving.expiresAt, late + 20 * 60_000);
  assert.equal(applyClock(moving, trip.expiresAt).trip.phase, 'riding');
});

test('live selection asks for what is still ahead and survives a round trip', () => {
  const { trip } = setup('16S-4>20E-4');
  assert.deepEqual(tripLiveSelection(trip, '2026-10-13'), {
    stopIds: ['ORIGIN_SB', 'CORNER_SB', 'CORNER_EB', 'END_EB'],
    trips: [
      { tripId: '16S-4', serviceDate: '2026-10-13' },
      { tripId: '20E-4', serviceDate: '2026-10-13' },
    ],
    routeIds: ['16', '20'],
  });
  const second = applyAction(
    applyAction(trip, 'boarded', at('08:30')).trip,
    'alighted',
    at('08:38'),
  ).trip;
  assert.deepEqual(tripLiveSelection(second, '2026-10-13').trips, [
    { tripId: '20E-4', serviceDate: '2026-10-13' },
  ]);
  assert.deepEqual(tripLiveSelection(trip, '2026-10-16').trips, []);
  assert.deepEqual(parseActiveTrip(JSON.stringify(second)), second);
  assert.throws(() => parseActiveTrip('{"version":2}'), /viaje en curso/);
});

test('running late, a lost connection and a missed bus are each told once', () => {
  const { trip } = setup('16S-4>20E-4');
  const late = run(trip, [
    fix({ lat: 43.0015, lng: -81.2001 }, second('08:29', 0)),
    fix({ lat: 43.0013, lng: -81.2001 }, second('08:29', 40)),
    fix({ lat: 43.0011, lng: -81.2001 }, second('08:29', 50)),
  ]);
  assert.deepEqual(
    late.events.map((e) => e.key),
    ['late:0'],
  );
  assert.match(late.events[0].body, /a las 08:30 \(horario\) y te faltan unos 3 min/);
  const missed = run(late.trip, [
    fix({ lat: 43.0004, lng: -81.2001 }, second('08:31', 0)),
    fix({ lat: 43.0003, lng: -81.2001 }, second('08:34', 30)),
    fix({ lat: 43.0003, lng: -81.2001 }, second('08:35', 0)),
  ]);
  assert.deepEqual(
    missed.events.map((e) => e.key),
    ['missed:0'],
  );
  const transferring = applyAction(
    applyAction(trip, 'boarded', at('08:30')).trip,
    'alighted',
    at('08:44'),
  ).trip;
  const lost = run(transferring, [fix({ lat: 42.988, lng: -81.2001 }, second('08:44', 30))]);
  assert.deepEqual(
    lost.events.map((e) => e.key),
    ['connection:1'],
  );
});
