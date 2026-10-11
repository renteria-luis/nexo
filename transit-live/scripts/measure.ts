import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import Bindings from 'gtfs-realtime-bindings';
import { agencyDate, validateSchedule } from '../generated/transit/schedule.ts';
import type { RealtimeQuery } from '../generated/transit/realtime-contract.ts';
import { decodeFeed, indexes, normalizeTrips } from '../src/normalize.ts';
import { buildResponse } from '../src/service.ts';
import { Sources, UPSTREAMS, type SharedCache, type Snapshot } from '../src/source.ts';

const paths = process.argv.slice(2);
if (paths.length !== 3)
  throw new Error('Pass saved public TripUpdates.pb, VehiclePositions.pb and Alerts.pb paths.');
const cpuStart = process.cpuUsage();
const memoryStart = process.memoryUsage();
const coldStart = performance.now();
const schedule = validateSchedule(
  JSON.parse(readFileSync(new URL('../generated/schedule.json', import.meta.url), 'utf8')),
);
const scheduleMs = performance.now() - coldStart;
const staticIndex = indexes(schedule);
const buffers = paths.map((path) => Uint8Array.from(readFileSync(path)));
const decoded = buffers.map((buffer) => {
  const start = performance.now();
  const feed = Bindings.transit_realtime.FeedMessage.decode(buffer);
  return { feed, decodeMs: performance.now() - start };
});
const now = Math.max(...decoded.map(({ feed }) => Number(String(feed.header.timestamp)) * 1000));
const allQuery: RealtimeQuery = {
  schema: 1,
  staticVersion: schedule.feedVersion,
  staticSourceSha256: schedule.sourceSha256,
  stopIds: [],
  trips: [],
  routeIds: schedule.routes.map((route) => route[0]),
};
const issues = { unmatchedTrips: 0, ambiguousStops: 0, invalidEntities: 0, truncated: false };
const joined = normalizeTrips(
  decodeFeed(buffers[0], now),
  schedule,
  staticIndex,
  allQuery,
  now,
  issues,
);
if (!joined.length) throw new Error('No known active trip joined the saved public feed.');
const selected = joined[0];
const trip = staticIndex.trips.get(selected.tripId)!;
const query: RealtimeQuery = {
  ...allQuery,
  routeIds: [selected.routeId],
  stopIds: schedule.patterns[trip[6]].slice(0, 2).map((stop) => schedule.stops[stop[0]][0]),
  trips: [{ tripId: selected.tripId, serviceDate: selected.serviceDate }],
};
const entries = new Map<string, Snapshot>();
const cache: SharedCache = {
  get: async (key) => structuredClone(entries.get(key) ?? null),
  set: async (key, value) => {
    entries.set(key, structuredClone(value));
  },
};
let downloads = 0;
const fetcher: typeof fetch = async (url) => {
  downloads++;
  const source = Object.values(UPSTREAMS).indexOf(String(url));
  if (source < 0) throw new Error('Unexpected upstream.');
  return new Response(buffers[source]);
};
const sources = new Sources(cache, fetcher, () => now);
const start = performance.now();
const result = await buildResponse(schedule, sources, query, now, staticIndex);
const firstResponseMs = performance.now() - start;
const warmStart = performance.now();
await buildResponse(schedule, sources, query, now, staticIndex);
const warmResponseMs = performance.now() - warmStart;
const crossStart = performance.now();
await buildResponse(schedule, new Sources(cache, fetcher, () => now), query, now, staticIndex);
const sharedWarmResponseMs = performance.now() - crossStart;
const ages = decoded.map(({ feed }) => {
  const values = feed.entity
    .map((entity) => entity.tripUpdate?.timestamp ?? entity.vehicle?.timestamp)
    .filter((value) => value !== null && value !== undefined)
    .map((value) => now / 1000 - Number(String(value)))
    .sort((a, b) => a - b);
  return values.length
    ? { min: values[0], median: values[Math.floor(values.length / 2)], max: values.at(-1) }
    : null;
});
const memoryEnd = process.memoryUsage();
const cpu = process.cpuUsage(cpuStart);
console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      node: process.version,
      mode: 'local saved public payloads; no cloud or network latency included',
      serviceDate: agencyDate(now),
      scheduleMs,
      localColdTotalMs: performance.now() - coldStart,
      firstResponseMs,
      warmResponseMs,
      sharedWarmResponseMs,
      downloads,
      filteredResponseBytes: Buffer.byteLength(JSON.stringify(result)),
      filtered: {
        trips: result.tripUpdates.length,
        vehicles: result.vehicles.length,
        alerts: result.alerts.length,
      },
      issues: result.issues,
      feeds: decoded.map(({ feed, decodeMs }, i) => ({
        source: ['trips', 'vehicles', 'alerts'][i],
        bytes: buffers[i].length,
        entities: feed.entity.length,
        feedTimestamp: Number(String(feed.header.timestamp)) * 1000,
        entityAgeSeconds: ages[i],
        decodeMs,
        compressedBase64Bytes: gzipSync(buffers[i]).toString('base64').length,
      })),
      cpuMs: (cpu.user + cpu.system) / 1000,
      heapDeltaBytes: memoryEnd.heapUsed - memoryStart.heapUsed,
      rssDeltaBytes: memoryEnd.rss - memoryStart.rss,
      rssBytes: memoryEnd.rss,
      maxRssBytes: process.resourceUsage().maxRSS * 1024,
    },
    null,
    2,
  ),
);
