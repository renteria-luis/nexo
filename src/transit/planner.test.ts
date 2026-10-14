import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plannerFixture } from './fixtures.ts';
import {
  ACCESS_RADIUS_M,
  buildPlannerIndex,
  estimatedWalkMinutes,
  liveOptions,
  planLiveStops,
  runPlan,
  startPlan,
  type PlanOption,
  type PlanRequest,
  type PlanResult,
} from './planner.ts';
import { observedServiceTrips, type LiveSnapshot } from './realtime.ts';
import { agencyClock, queryInstant, type Schedule } from './schedule.ts';

const schedule = plannerFixture();
const index = buildPlannerIndex(schedule);
const ORIGIN = { lat: 43, lng: -81.2 };
const END = { lat: 42.9878, lng: -81.17 };
const MIDDLE = { lat: 42.9938, lng: -81.2 };
const TUESDAY = '2026-10-13';
const SATURDAY = '2026-10-17';

function request(changes: Partial<PlanRequest> = {}): PlanRequest {
  return {
    origin: ORIGIN,
    destination: END,
    originWalks: new Map(),
    destinationWalks: new Map(),
    stopWalks: [],
    mode: 'depart',
    at: queryInstant(TUESDAY, '08:00'),
    ...changes,
  };
}

function plan(changes: Partial<PlanRequest> = {}): PlanResult {
  const search = startPlan(index, request(changes));
  while (!search.step(1_000));
  return search.result();
}

const stopId = (stop: number) => schedule.stops[stop][0];
const describe = (option: PlanOption) =>
  [
    agencyClock(option.leaveAt),
    agencyClock(option.arriveAt),
    ...option.itinerary.rides.map(
      (ride) =>
        `${ride.trip[0]}:${stopId(ride.departure.stopTime[0])}>${stopId(ride.arrival.stopTime[0])}`,
    ),
  ].join(' ');

test('an empty holiday calendar discovers stops and admits only buses actually reported fresh', () => {
  const holiday: Schedule = {
    ...schedule,
    exceptions: [
      ['daily', TUESDAY, 2],
      ['weekday', TUESDAY, 2],
    ],
  };
  const index = buildPlannerIndex(holiday);
  const get = (observedTrips: PlanRequest['observedTrips'] = []) => {
    const search = startPlan(index, request({ observedTrips }));
    while (!search.step(1_000));
    return search.result();
  };
  const empty = get();
  assert.equal(liveOptions(empty, null, request().at).length, 0);
  assert.ok(
    planLiveStops(empty, 8).includes('ORIGIN_SB'),
    'discover actual reports even without scheduled departures',
  );
  const now = request().at;
  const live = snapshot(
    now,
    ['16S-3', '20E-4'].map((id) => update(schedule, id, now, { calendarException: true }, 0)),
  );
  const observed = observedServiceTrips(holiday, live, now);
  const reported = get(observed);
  const options = liveOptions(reported, live, now);
  assert.ok(options.length);
  assert.ok(options.every((option) => option.reportedOutsideCalendar));
  assert.ok(
    options.every((option) =>
      option.itinerary.rides.every((ride) => ['16S-3', '20E-4'].includes(ride.trip[0])),
    ),
  );
  assert.equal(
    liveOptions(reported, null, now).length,
    0,
    'an absent feed must not invent holiday service',
  );
  assert.equal(
    liveOptions(reported, live, now + 91_000).length,
    0,
    'stale exceptions do not turn into a made-up timetable',
  );
  assert.ok(liveOptions(plan(), null, now).length, 'ordinary scheduled fallback remains available');
});

function snapshot(now: number, updates: LiveSnapshot['tripUpdates']): LiveSnapshot {
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
    tripUpdates: updates,
    vehicles: [],
    alerts: [],
    issues: { unmatchedTrips: 0, ambiguousStops: 0, invalidEntities: 0, truncated: false },
  };
}

function update(
  schedule: Schedule,
  tripId: string,
  now: number,
  changes: Partial<LiveSnapshot['tripUpdates'][number]>,
  lateMinutes: number,
  day = TUESDAY,
): LiveSnapshot['tripUpdates'][number] {
  const trip = schedule.trips.find((t) => t[0] === tripId)!;
  const start = queryInstant(day, '00:00');
  return {
    tripId,
    serviceDate: day,
    routeId: schedule.routes[trip[1]][0],
    directionId: null,
    startTime: null,
    entityId: `entity-${tripId}`,
    vehicleId: `bus-${tripId}`,
    measuredAt: now,
    relationship: 'scheduled',
    delay: lateMinutes * 60,
    stops: schedule.patterns[trip[6]].map((time) => {
      const event = {
        time: start + (trip[7] + time[3] + lateMinutes * 60) * 1_000,
        delay: lateMinutes * 60,
        uncertainty: null,
      };
      return {
        stopId: schedule.stops[time[0]][0],
        stopSequence: time[1],
        relationship: 'scheduled' as const,
        arrival: event,
        departure: event,
      };
    }),
    ...changes,
  };
}

test('walking estimates follow the approved speed and detour, rounded up to whole minutes', () => {
  assert.equal(estimatedWalkMinutes(10), 1);
  assert.equal(estimatedWalkMinutes(100), 2);
  assert.equal(estimatedWalkMinutes(400), 7);
  assert.equal(estimatedWalkMinutes(ACCESS_RADIUS_M), 11);
});

test('one transfer: the weekday express makes the 08:30 connection, tight, with the next bus as backup', () => {
  const result = plan();
  const options = liveOptions(result, null, request().at);
  assert.deepEqual(options.slice(0, 3).map(describe), [
    '08:17 08:41 92S-1:ORIGIN_SB>CORNER_SB 20E-3:CORNER_EB>END_EB',
    '08:27 08:56 16S-4:ORIGIN_SB>CORNER_SB 20E-4:CORNER_EB>END_EB',
    '08:42 09:11 16S-5:ORIGIN_SB>CORNER_SB 20E-5:CORNER_EB>END_EB',
  ]);
  const first = options[0];
  assert.equal(first.itinerary.access.source, 'estimate');
  assert.equal(first.itinerary.access.minutes, 1);
  assert.equal(first.itinerary.egress?.minutes, 1);
  assert.equal(first.slack, 3 * 60_000);
  assert.equal(first.tight, true);
  assert.equal(first.backup?.ride.trip[0], '20E-4');
  assert.equal(agencyClock(first.backup!.arriveAt), '08:56');
  assert.equal(options[1].tight, false, 'five free minutes are not tight');
  assert.ok(options.every((o) => o.live.every((l) => l.board.status === 'schedule')));
});

test('every bus is listed, also another line that leaves a minute earlier and arrives later', () => {
  // 2026-10-12: Google Maps listed a bus that Nexo hid behind another line leaving a minute later
  // and arriving two minutes sooner. Here a local 16 leaves a minute before an express 92.
  const passed = plannerFixture();
  passed.trips.push(['92S-X', 2, 'weekday', 'Express', 1, '', 5, (8 * 60 + 16) * 60]);
  const search = startPlan(
    buildPlannerIndex(passed),
    request({ destination: { lat: 42.9879, lng: -81.2003 }, at: queryInstant(TUESDAY, '08:10') }),
  );
  while (!search.step(1_000));
  const options = liveOptions(search.result(), null, 0);
  assert.deepEqual(options.map(describe), [
    '08:13 08:22 92S-X:ORIGIN_SB>CORNER_SB',
    '08:12 08:24 16S-3:ORIGIN_SB>CORNER_SB',
    '08:17 08:26 92S-1:ORIGIN_SB>CORNER_SB',
    '08:10 08:34',
    '08:27 08:39 16S-4:ORIGIN_SB>CORNER_SB',
    '08:42 08:54 16S-5:ORIGIN_SB>CORNER_SB',
  ]);
});

test('later buses are not crowded out by other stops to get off the same ones', () => {
  // A line that stops twelve times within walking distance of the end: each stop used to count
  // as an option, and the first 120 of them filled the list with the first few buses.
  const many = plannerFixture();
  const first = many.stops.length;
  for (let i = 0; i < 12; i++)
    many.stops.push([`NEAR_${i}`, String(900 + i), `Near ${i}`, 42.9876, -81.1705 + i * 0.0004]);
  const origin = many.stops.findIndex((s) => s[0] === 'ORIGIN_SB');
  many.patterns.push([
    [origin, 1, 0, 0, 0, 1, 1, ''],
    ...Array.from({ length: 12 }, (_, i): Schedule['patterns'][number][number] => [
      first + i,
      i + 2,
      (10 + i) * 60,
      (10 + i) * 60,
      i === 11 ? 1 : 0,
      0,
      1,
      '',
    ]),
  ]);
  many.routes.push(['50', '50', 'Many stops', '808080']);
  for (let i = 0; i < 18; i++)
    many.trips.push([
      `50-${i}`,
      many.routes.length - 1,
      'daily',
      'Many stops',
      0,
      '',
      many.patterns.length - 1,
      (8 * 60 + 5 * i) * 60,
    ]);
  const search = startPlan(buildPlannerIndex(many), request());
  while (!search.step(1_000));
  const listed = liveOptions(search.result(), null, 0).filter(
    (o) => o.itinerary.rides[0]?.route[0] === '50',
  );
  assert.deepEqual(
    listed.map((o) => o.itinerary.rides[0].trip[0]),
    Array.from({ length: 17 }, (_, i) => `50-${i + 1}`),
    'every bus from 08:05 to 09:25, the last that leaves within 90 minutes',
  );
});

test('the weekday-only express is not proposed on a Saturday', () => {
  const options = liveOptions(plan({ at: queryInstant(SATURDAY, '08:00') }), null, 0);
  assert.ok(options.every((o) => o.itinerary.rides.every((r) => r.route[0] !== '92')));
  assert.equal(
    describe(options[0]),
    '08:12 08:41 16S-3:ORIGIN_SB>CORNER_SB 20E-3:CORNER_EB>END_EB',
  );
});

test('a transfer at the same corner is never zero, and his saved walk replaces the estimate', () => {
  const estimated = liveOptions(plan(), null, 0)[0].itinerary.transfer!;
  assert.equal(estimated.source, 'estimate');
  assert.equal(estimated.minutes, 2);
  const saved = liveOptions(
    plan({ stopWalks: [{ from_stop: 'CORNER_SB', to_stop: 'CORNER_EB', minutes: 6 }] }),
    null,
    0,
  );
  assert.equal(saved[0].itinerary.transfer?.source, 'saved');
  assert.equal(saved[0].itinerary.transfer?.minutes, 6);
  assert.equal(
    describe(saved[0]),
    '08:17 08:56 92S-1:ORIGIN_SB>CORNER_SB 20E-4:CORNER_EB>END_EB',
    'six minutes across the corner miss the 08:30',
  );
});

test('the way back uses the opposite curbs and its own connection', () => {
  const options = liveOptions(plan({ origin: END, destination: ORIGIN }), null, 0);
  assert.equal(
    describe(options[0]),
    '08:12 08:39 20W-3:END_WB>CORNER_WB 16N-4:CORNER_NB>ORIGIN_NB',
  );
  assert.equal(options[0].itinerary.transfer?.minutes, 1);
});

test('a short turn serves the stop it reaches but never the corner past it', () => {
  const all = liveOptions(plan(), null, 0);
  assert.ok(all.every((o) => o.itinerary.rides.every((r) => r.trip[0] !== '16T-0')));
  const middle = liveOptions(plan({ destination: MIDDLE }), null, 0);
  const direct = middle.find((o) => o.itinerary.rides.length === 1)!;
  assert.equal(describe(direct), '08:02 08:10 16T-0:ORIGIN_SB>MIDDLE_SB');
  assert.equal(direct.itinerary.rides[0].trip[3], 'Short turn');
});

test('a short walk is offered on its own and a bus slower than walking is dropped', () => {
  const near = liveOptions(
    plan({ destination: MIDDLE, mode: 'now' }),
    null,
    queryInstant(TUESDAY, '08:00'),
  );
  const walking = near.find((o) => o.itinerary.rides.length === 0)!;
  assert.equal(walking.itinerary.access.source, 'estimate');
  assert.equal(walking.itinerary.access.minutes, 12);
  assert.ok(near.every((o) => o.arriveAt - o.leaveAt <= 12 * 60_000));
  const later = liveOptions(
    plan({ destination: MIDDLE, mode: 'now' }),
    null,
    queryInstant(TUESDAY, '08:05'),
  );
  assert.equal(
    agencyClock(later.find((o) => o.itinerary.rides.length === 0)!.leaveAt),
    '08:05',
    'walking now starts now',
  );
});

test('arrive-by counts the final walk and the early margin and lists the latest first last', () => {
  const by = (clock: string) =>
    liveOptions(plan({ mode: 'arrive', at: queryInstant(TUESDAY, clock) }), null, 0).map(describe);
  assert.deepEqual(by('08:44'), [
    '07:27 07:56 16S-0:ORIGIN_SB>CORNER_SB 20E-0:CORNER_EB>END_EB',
    '07:47 08:11 92S-0:ORIGIN_SB>CORNER_SB 20E-1:CORNER_EB>END_EB',
    '07:57 08:26 16S-2:ORIGIN_SB>CORNER_SB 20E-2:CORNER_EB>END_EB',
    '08:17 08:41 92S-1:ORIGIN_SB>CORNER_SB 20E-3:CORNER_EB>END_EB',
  ]);
  assert.equal(
    by('08:43').at(-1),
    '07:57 08:26 16S-2:ORIGIN_SB>CORNER_SB 20E-2:CORNER_EB>END_EB',
    'reaching the door at 08:41 leaves under three minutes before 08:43',
  );
});

test('service after midnight belongs to the previous service day', () => {
  const options = liveOptions(
    plan({ destination: MIDDLE, at: queryInstant('2026-10-14', '00:05') }),
    null,
    0,
  );
  const ride = options.find((o) => o.itinerary.rides.length)!.itinerary.rides[0];
  assert.equal(ride.trip[0], '16LATE-0');
  assert.equal(ride.serviceDate, TUESDAY);
  assert.equal(agencyClock(ride.departure.at), '00:15');
});

test('a late first bus moves the list to the connection still possible', () => {
  const now = queryInstant(TUESDAY, '08:00');
  const result = plan();
  const late = snapshot(now, [update(schedule, '92S-1', now, {}, 4)]);
  const options = liveOptions(result, late, now);
  const working = options.filter((o) => !o.notice);
  assert.equal(
    describe(working[0]),
    '08:12 08:41 16S-3:ORIGIN_SB>CORNER_SB 20E-3:CORNER_EB>END_EB',
  );
  const notice = options.find((o) => o.notice)!;
  assert.equal(notice.scheduleKey, result.best[0].key);
  assert.equal(notice.replaced?.reason, 'late');
  assert.equal(notice.replaced?.ride.trip[0], '20E-3');
  assert.equal(notice.itinerary.rides[1].trip[0], '20E-4', 'the next 20 replaces the lost one');
  assert.equal(notice.live[0].board.status, 'live');
  assert.equal(agencyClock(notice.leaveAt), '08:21', 'the late bus lets him leave later');
});

test('a partial live query cannot erase a delay before an unqueried transfer stop', () => {
  const now = request().at;
  const result = plan();
  const late = update(schedule, '92S-1', now, {}, 15);
  late.stops = late.stops.slice(0, 1);
  const reading = snapshot(now, [late]);
  reading.coverage = { stopIds: ['ORIGIN_SB', 'END_EB'], trips: [] };
  const options = liveOptions(result, reading, now);
  const delayed = options.filter((o) => o.itinerary.rides[0]?.trip[0] === late.tripId);
  assert.ok(delayed.length);
  for (const option of delayed) {
    assert.equal(agencyClock(option.live[0].alight.at), '08:40');
    assert.equal(option.live[0].alight.source, 'estimate');
    assert.equal(option.live[0].alight.status, 'estimated');
    if (!option.problem && option.itinerary.rides.length === 2)
      assert.ok(option.slack! >= 3 * 60_000, 'the second bus must still be reachable');
  }
  assert.equal(liveOptions(result, null, now)[0].live[0].alight.source, 'schedule');
  assert.ok(
    liveOptions(result, reading, now + 91_000).every((o) =>
      o.live.every((ride) => ride.alight.source !== 'estimate'),
    ),
    'an old report must not produce a fresh delay estimate',
  );
});

test('a bus cannot pass an earlier predicted stop after its reported alighting time', () => {
  const now = request().at;
  const result = plan();
  const late = update(schedule, '16S-3', now, {}, 0);
  late.stops[1].arrival!.time! += 15 * 60_000;
  late.stops[1].departure!.time! += 15 * 60_000;
  const candidate = result.pool.find((p) => p.rides[0]?.trip[0] === late.tripId)!;
  const options = liveOptions(
    { ...result, pool: [candidate], best: [candidate] },
    snapshot(now, [late]),
    now,
  );
  const delayed = options.find((o) => o.itinerary.rides[0]?.trip[0] === late.tripId)!;
  assert.ok(delayed);
  assert.ok(delayed.live[0].alight.at >= late.stops[1].departure!.time!);
  assert.equal(delayed.live[0].alight.status, 'estimated');
});

test('cancelled, skipped and missing live data stay distinguishable', () => {
  const now = queryInstant(TUESDAY, '08:00');
  const result = plan();
  const canceled = liveOptions(
    result,
    snapshot(now, [update(schedule, '92S-1', now, { relationship: 'canceled' }, 0)]),
    now,
  );
  const broken = canceled.find((o) => o.notice)!;
  assert.equal(broken.problem, 'canceled');
  assert.equal(broken.live[0].board.status, 'canceled');
  assert.ok(
    canceled.filter((o) => !o.notice).every((o) => o.itinerary.rides[0].trip[0] !== '92S-1'),
  );
  const skipping = update(schedule, '92S-1', now, {}, 0);
  skipping.stops[1].relationship = 'skipped';
  const skipped = liveOptions(result, snapshot(now, [skipping]), now).find((o) => o.notice)!;
  assert.equal(skipped.problem, 'skipped');
  const quiet = liveOptions(result, snapshot(now, []), now);
  assert.ok(quiet.every((o) => !o.notice && o.live.every((l) => l.board.status === 'schedule')));
});

test('a cancelled second bus is replaced by the next one from the same stop', () => {
  const now = queryInstant(TUESDAY, '08:00');
  const options = liveOptions(
    plan(),
    snapshot(now, [update(schedule, '20E-3', now, { relationship: 'canceled' }, 0)]),
    now,
  );
  assert.ok(
    options.filter((o) => !o.notice).every((o) => o.itinerary.rides[1]?.trip[0] !== '20E-3'),
  );
  const notice = options.find((o) => o.notice)!;
  assert.equal(notice.replaced?.reason, 'canceled');
  assert.equal(notice.itinerary.rides[1].trip[0], '20E-4');
});

test('a replacement connection must also pass its live boarding margin', () => {
  const now = request().at;
  const result = plan();
  const option = result.best[0];
  const reading = snapshot(now, [
    update(schedule, '92S-1', now, {}, 4),
    update(schedule, '20E-4', now, {}, -12),
  ]);
  const [checked] = liveOptions({ ...result, pool: [option], best: [option] }, reading, now);
  assert.equal(checked.replaced?.ride.trip[0], '20E-3');
  assert.equal(checked.itinerary.rides[1].trip[0], '20E-4');
  assert.ok(checked.slack! < 3 * 60_000);
  assert.equal(checked.problem, 'missed');
  assert.equal(checked.notice, true);
});

test('options he can no longer leave for drop out as time passes', () => {
  const result = plan({ mode: 'now' });
  const later = liveOptions(result, null, queryInstant(TUESDAY, '08:20'));
  assert.ok(later.every((o) => o.leaveAt >= queryInstant(TUESDAY, '08:19')));
  assert.equal(describe(later[0]), '08:27 08:56 16S-4:ORIGIN_SB>CORNER_SB 20E-4:CORNER_EB>END_EB');
});

test('his saved minutes to a stop replace the estimate and reach a stop beyond the radius', () => {
  const result = plan({ originWalks: new Map([['MIDDLE_SB', 3]]) });
  const options = liveOptions(result, null, 0);
  const viaMiddle = result.pool.find(
    (p) => stopId(p.rides[0]?.departure.stopTime[0]) === 'MIDDLE_SB',
  );
  assert.ok(viaMiddle, 'a stop 670 m away is used once he saved his minutes to it');
  assert.equal(viaMiddle.access.source, 'saved');
  assert.equal(viaMiddle.access.minutes, 3);
  assert.ok(options.length > 0);
});

test('the live query asks for the boarding and alighting stops of the best options first', () => {
  assert.deepEqual(planLiveStops(plan(), 8), ['ORIGIN_SB', 'CORNER_SB', 'CORNER_EB', 'END_EB']);
  assert.deepEqual(planLiveStops(plan(), 2), ['ORIGIN_SB', 'CORNER_SB']);
});

test('unsupported trips say why instead of inventing a route', () => {
  assert.equal(plan({ origin: { lat: 43.2, lng: -81.5 } }).issue, 'no-origin-stops');
  assert.equal(plan({ destination: { lat: 43.2, lng: -81.5 } }).issue, 'no-destination-stops');
  assert.equal(plan({ at: queryInstant('2027-01-05', '08:00') }).issue, 'outside-validity');
  const evening = plan({ at: queryInstant(TUESDAY, '12:00') });
  assert.equal(evening.issue, 'none');
  assert.equal(liveOptions(evening, null, 0).length, 0);
});

test('the search runs in slices that can be cancelled between them', async () => {
  let pauses = 0;
  const finished = await runPlan(startPlan(index, request()), {
    budgetMs: 0,
    pause: async () => {
      pauses++;
    },
    cancelled: () => false,
  });
  assert.ok(finished && pauses > 1, 'a zero budget yields after every task');
  assert.deepEqual(
    finished.best.map((p) => p.key),
    plan().best.map((p) => p.key),
  );
  let calls = 0;
  const cancelled = await runPlan(startPlan(index, request()), {
    budgetMs: 0,
    pause: async () => {},
    cancelled: () => ++calls > 2,
  });
  assert.equal(cancelled, null);
});
