import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { scheduleFixture } from './fixtures.ts';
import {
  SCHEDULE_SCHEMA,
  stopLines,
  usefulStops,
  activeServices,
  agencyClock,
  agencyDate,
  buildStopIndex,
  departures,
  nearbyStops,
  queryInstant,
  scheduledTime,
  validateSchedule,
} from './schedule.ts';

test('calendars distinguish weekdays, weekends and holiday exceptions', () => {
  const s = scheduleFixture();
  assert.deepEqual([...activeServices(s, '2026-10-09')], ['weekday']);
  assert.deepEqual([...activeServices(s, '2026-10-11')], ['weekend']);
  assert.deepEqual([...activeServices(s, '2026-10-12')], ['holiday']);
  assert.equal(activeServices(s, '2027-01-01').size, 0);
  assert.equal(activeServices(s, '2026-02-30').size, 0);
});

test('after-midnight departures keep the previous service date and leading-zero route identity', () => {
  const s = scheduleFixture();
  const index = buildStopIndex(s);
  const result = departures(s, index, 0, Date.parse('2026-10-10T04:30:00Z'));
  assert.equal(result[0].serviceDate, '2026-10-09');
  assert.equal(result[0].trip[0], 'weekday-late');
  assert.equal(result[0].route[0], '02');
  assert.equal(result[0].trip[3], '2A Downtown');
  assert.equal(new Date(result[0].at).toISOString(), '2026-10-10T05:00:00.000Z');
  assert.equal(
    departures(s, index, 1, result[0].at).length,
    0,
    'no pickup means no boarding option',
  );
});

test('a repeated loop stop uses its sequence and retains conditional pickup', () => {
  const s = scheduleFixture();
  s.patterns[0].push([0, 3, 1200, 1200, 2, 0, 1, 'Short turn']);
  const result = departures(s, buildStopIndex(s), 0, Date.parse('2026-10-11T11:00:00Z'));
  assert.deepEqual(
    result.slice(0, 2).map((d) => d.stopTime[1]),
    [1, 3],
  );
  assert.equal(result[1].stopTime[7], 'Short turn');
  assert.equal(result[1].stopTime[4], 2);
});

test('GTFS service-day anchoring respects both Toronto DST transitions and device-independent wall time', () => {
  assert.equal(
    new Date(scheduledTime('2026-03-08', 3 * 3600)).toISOString(),
    '2026-03-08T07:00:00.000Z',
  );
  assert.equal(
    new Date(scheduledTime('2026-11-01', 3 * 3600)).toISOString(),
    '2026-11-01T08:00:00.000Z',
  );
  assert.equal(
    new Date(queryInstant('2026-03-08', '03:00')).toISOString(),
    '2026-03-08T07:00:00.000Z',
  );
  assert.equal(
    new Date(queryInstant('2026-11-01', '01:30')).toISOString(),
    '2026-11-01T05:30:00.000Z',
    'first occurrence of repeated wall time',
  );
  assert.throws(() => queryInstant('2026-03-08', '02:30'), /no existe/);
  assert.throws(() => queryInstant('2026-02-30', '12:00'), /fecha/);
  assert.throws(() => queryInstant('2026-10-11', '25:00'), /hora/);
  assert.equal(agencyDate(Date.parse('2026-10-12T02:00:00Z')), '2026-10-11');
  assert.equal(agencyClock(Date.parse('2026-10-12T02:00:00Z')), '22:00');
});

test('invalid, partial or incompatible packages are rejected before use', () => {
  for (const mutate of [
    (s: ReturnType<typeof scheduleFixture>) => {
      s.schema = SCHEDULE_SCHEMA + 1;
    },
    (s: ReturnType<typeof scheduleFixture>) => {
      s.routes[0][3] = 'green';
    },
    (s: ReturnType<typeof scheduleFixture>) => {
      s.stops[0][3] = 91;
    },
    (s: ReturnType<typeof scheduleFixture>) => {
      s.trips[0][2] = 'unknown';
    },
    (s: ReturnType<typeof scheduleFixture>) => {
      s.trips[0][6] = 99;
    },
    (s: ReturnType<typeof scheduleFixture>) => {
      s.patterns[0][1][0] = 99;
    },
    (s: ReturnType<typeof scheduleFixture>) => {
      s.patterns[0][1][1] = 1;
    },
    (s: ReturnType<typeof scheduleFixture>) => {
      s.patterns[0][1][3] = 100;
    },
    (s: ReturnType<typeof scheduleFixture>) => {
      s.validTo = '2026-02-30';
    },
    (s: ReturnType<typeof scheduleFixture>) => {
      s.exceptions.push(s.exceptions[0]);
    },
  ]) {
    const s = scheduleFixture();
    mutate(s);
    assert.throws(() => validateSchedule(s), /inválido/);
  }
  assert.throws(() => validateSchedule({ schema: 1 }), /inválido/);
  assert.equal(validateSchedule(scheduleFixture()).routes[0][0], '02');
});

test('the shipped official package matches its hash and includes citywide schedules, restrictions and shapes', () => {
  const raw = readFileSync(new URL('../../transit/schedule.json', import.meta.url), 'utf8');
  const manifest = JSON.parse(
    readFileSync(new URL('../../transit/manifest.json', import.meta.url), 'utf8'),
  );
  assert.equal(createHash('sha256').update(raw).digest('hex'), manifest.sha256);
  assert.equal(Buffer.byteLength(raw), manifest.bytes);
  const s = validateSchedule(JSON.parse(raw));
  assert.ok(s.stops.length > 1000 && s.routes.length > 30 && s.trips.length > 8000);
  assert.ok(s.exceptions.length > 0 && Object.keys(s.shapes).length > 0);
  const gym = { lat: 42.98670962272733, lng: -81.28821439880518 };
  const nearby = nearbyStops(s, gym);
  assert.ok(nearby.some((c) => c.stop[0] === 'PROUFAR2'));
  assert.ok(nearby.some((c) => c.stop[0] === 'PROUFAR3'));
  assert.ok(nearby[0].distanceM < 100);
});

test('nearby stops keep one stop per line and direction, closest first, the rest one tap away', () => {
  const s = scheduleFixture();
  s.stops.push(
    ['C', '12', 'Road NB next', 43.0002, -81.0002],
    ['D', '13', 'Cross EB', 43.0003, -81.0003],
  );
  s.routes.push(['17', '17', 'Route 17', '6BCFF6']);
  s.patterns.push([[2, 1, 0, 0, 0, 0, 1, '']], [[3, 1, 0, 0, 0, 0, 1, '']]);
  s.trips.push(
    ['same-line', 0, 'weekday', '2A Downtown', 0, 'shape', 1, 9 * 3600],
    ['other-line', 1, 'weekday', '17 East', 0, 'shape', 2, 9 * 3600],
  );
  const index = buildStopIndex(s);
  assert.deepEqual(
    stopLines(s, index, 1).map((line) => line.key),
    [],
    'a stop where nobody may board serves no line',
  );
  const candidates = [0, 1, 2, 3].map((i) => ({ index: i, id: s.stops[i][0] }));
  const { main, more } = usefulStops(s, index, candidates);
  assert.deepEqual(
    main.map((c) => c.id),
    ['A', 'D'],
  );
  assert.deepEqual(
    more.map((c) => c.id),
    ['B', 'C'],
  );
  assert.deepEqual(
    usefulStops(s, index, candidates, 1).main.map((c) => c.id),
    ['A'],
  );
});
