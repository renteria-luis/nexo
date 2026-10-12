import assert from 'node:assert/strict';
import test from 'node:test';
import Bindings from 'gtfs-realtime-bindings';
import {
  buildStopIndex,
  departures,
  SCHEDULE_SOURCE,
  scheduledTime,
  validateSchedule,
} from '../generated/transit/schedule.ts';
import {
  buildLiveQuery,
  mergeLiveDeparture,
  validateLiveSnapshot,
} from '../../src/transit/realtime.ts';
import { buildResponse } from './service.ts';
import { Sources, UPSTREAMS } from './source.ts';

// The same data as src/transit/fixtures.ts, which also opens SQLite and so cannot load here.
function scheduleFixture() {
  return validateSchedule({
    schema: 2,
    source: SCHEDULE_SOURCE,
    sourceSha256: 'a'.repeat(64),
    createdAt: Date.UTC(2026, 9, 11),
    feedVersion: 'fixture',
    timezone: 'America/Toronto',
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    stops: [
      ['A', '10', 'Road NB', 43, -81],
      ['B', '11', 'Road SB', 43.0001, -81.0001],
    ],
    routes: [['02', '02', 'Route 2', '75AAAE']],
    services: [
      ['weekday', 31, '2026-01-01', '2026-12-31'],
      ['weekend', 96, '2026-01-01', '2026-12-31'],
    ],
    exceptions: [
      ['weekday', '2026-10-12', 2],
      ['holiday', '2026-10-12', 1],
    ],
    patterns: [
      [
        [0, 1, 0, 0, 0, 1, 1, ''],
        [1, 2, 600, 660, 1, 0, 0, ''],
      ],
    ],
    trips: [
      ['weekday-late', 0, 'weekday', '2A Downtown', 0, 'shape', 0, 25 * 3600],
      ['weekend-trip', 0, 'weekend', '2B Terminal', 1, 'shape', 0, 8 * 3600],
      ['holiday-trip', 0, 'holiday', 'Holiday branch', null, 'shape', 0, 8 * 3600],
    ],
    shapes: {
      shape: [
        [43, -81, 1],
        [43.0001, -81.0001, 2],
      ],
    },
    transfers: [[0, 1, 2, 180]],
  });
}

test('binary feeds reach the phone with explicit zero values, loop sequence and previous service date intact', async () => {
  const schedule = scheduleFixture();
  schedule.patterns[0].push([0, 3, 1_200, 1_200, 0, 0, 1, 'Short turn']);
  const now = scheduledTime('2026-10-09', 25 * 3_600) + 19 * 60_000;
  const selected = departures(schedule, buildStopIndex(schedule), 0, now)[0];
  assert.equal(selected.serviceDate, '2026-10-09');
  assert.equal(selected.stopTime[1], 3);
  const query = buildLiveQuery(schedule, {
    stopIds: ['A'],
    trips: [{ tripId: selected.trip[0], serviceDate: selected.serviceDate }],
  });
  const descriptor = { tripId: selected.trip[0], routeId: '02', startDate: '20261009' };
  const header = { gtfsRealtimeVersion: '2.0', incrementality: 0, timestamp: now / 1_000 };
  const encode = (entities: Bindings.transit_realtime.IFeedEntity[]) =>
    Bindings.transit_realtime.FeedMessage.encode(
      Bindings.transit_realtime.FeedMessage.fromObject({ header, entity: entities }),
    ).finish();
  const binary: Record<string, Uint8Array> = {
    [UPSTREAMS.trips]: encode([
      {
        id: 'official-loop',
        tripUpdate: {
          trip: descriptor,
          timestamp: now / 1_000 - 5,
          stopTimeUpdate: [
            { stopId: 'A', departure: { time: now / 1_000 + 60 } },
            { stopId: 'A', stopSequence: 3, departure: { delay: 0, uncertainty: 0 } },
          ],
        },
      },
      {
        id: 'repeated-without-bus',
        tripUpdate: {
          trip: { ...descriptor, directionId: 1 },
          timestamp: now / 1_000,
          stopTimeUpdate: [{ stopId: 'A', stopSequence: 3, departure: { delay: 999 } }],
        },
      },
    ]),
    [UPSTREAMS.vehicles]: encode([
      {
        id: 'reported-bus',
        vehicle: {
          trip: descriptor,
          timestamp: now / 1_000 - 5,
          vehicle: { id: 'same-physical-bus' },
          position: { latitude: 43, longitude: -81, bearing: 0, speed: 0 },
          currentStopSequence: 3,
          stopId: 'A',
        },
      },
    ]),
    [UPSTREAMS.alerts]: encode([]),
  };
  const sources = new Sources(
    { get: async () => null, set: async () => undefined },
    async (input) => {
      const bytes = binary[String(input)];
      assert.ok(bytes, 'the server selects only the fixed official feed URLs');
      return new Response(new Uint8Array(bytes));
    },
    () => now,
  );
  const response = await buildResponse(schedule, sources, query, now);
  const checked = validateLiveSnapshot(JSON.parse(JSON.stringify(response)), schedule, query, now);
  assert.equal(
    checked.tripUpdates.length,
    1,
    'a second report of the same trip without a bus is ignored',
  );
  assert.equal(checked.issues.unmatchedTrips, 0);
  assert.equal(checked.issues.ambiguousStops, 1);
  const update = checked.tripUpdates[0];
  assert.equal(update.entityId, 'official-loop');
  assert.equal(update.directionId, null);
  assert.equal(update.startTime, null);
  assert.equal(update.delay, null);
  assert.equal(update.measuredAt, now - 5_000);
  assert.equal(update.stops.length, 1);
  assert.deepEqual(update.stops[0].departure, { time: null, delay: 0, uncertainty: 0 });
  assert.equal(checked.vehicles[0].status, null);
  assert.equal(checked.vehicles[0].position!.bearing, 0);
  assert.equal(checked.vehicles[0].position!.speed, 0);
  const arrival = mergeLiveDeparture(schedule, selected, checked, now);
  assert.equal(arrival.source, 'official');
  assert.equal(arrival.at, selected.at);
  assert.equal(arrival.uncertainty, 0);
  assert.equal(
    mergeLiveDeparture(schedule, { ...selected, serviceDate: '2026-10-08' }, checked, now).source,
    'schedule',
    'a report for the same physical trip ID on another service day is kept separate',
  );
});

test('a realtime static-version mismatch isolates that source while the reported vehicle remains usable', async () => {
  const schedule = scheduleFixture();
  const now = scheduledTime('2026-11-01', 8 * 3_600) - 60_000;
  const selected = departures(schedule, buildStopIndex(schedule), 0, now)[0];
  const query = buildLiveQuery(schedule, {
    stopIds: ['A'],
    trips: [{ tripId: selected.trip[0], serviceDate: selected.serviceDate }],
  });
  const descriptor = { tripId: selected.trip[0], routeId: '02', startDate: '20261101' };
  const header = {
    gtfsRealtimeVersion: '2.0',
    incrementality: 0,
    timestamp: now / 1_000,
    feedVersion: schedule.feedVersion,
  };
  const encode = (feed: Bindings.transit_realtime.IFeedMessage) =>
    Bindings.transit_realtime.FeedMessage.encode(
      Bindings.transit_realtime.FeedMessage.fromObject(feed),
    ).finish();
  const binary: Record<string, Uint8Array> = {
    [UPSTREAMS.trips]: encode({
      header: { ...header, feedVersion: 'another static schedule' },
      entity: [
        {
          id: 'changed-trip',
          tripUpdate: {
            trip: descriptor,
            timestamp: now / 1_000,
            stopTimeUpdate: [{ stopId: 'A', stopSequence: 1, departure: { delay: 900 } }],
          },
        },
      ],
    }),
    [UPSTREAMS.vehicles]: encode({
      header,
      entity: [
        {
          id: 'correct-vehicle',
          vehicle: {
            trip: descriptor,
            timestamp: now / 1_000,
            vehicle: { id: 'reported-bus' },
            position: { latitude: 43, longitude: -81 },
            currentStopSequence: 1,
          },
        },
      ],
    }),
    [UPSTREAMS.alerts]: encode({ header, entity: [] }),
  };
  const sources = new Sources(
    { get: async () => null, set: async () => undefined },
    async (input) => new Response(new Uint8Array(binary[String(input)])),
    () => now,
  );
  const response = await buildResponse(schedule, sources, query, now);
  const checked = validateLiveSnapshot(JSON.parse(JSON.stringify(response)), schedule, query, now);
  assert.equal(checked.health.trips.status, 'error');
  assert.equal(checked.tripUpdates.length, 0);
  assert.equal(checked.health.vehicles.status, 'ok');
  assert.equal(checked.vehicles.length, 1);
  assert.equal(checked.vehicles[0].serviceDate, '2026-11-01');
  assert.equal(mergeLiveDeparture(schedule, selected, checked, now).source, 'schedule');
});
