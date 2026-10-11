import { gzipSync, gunzipSync } from 'node:zlib';
import type Bindings from 'gtfs-realtime-bindings';
import {
  REALTIME_ALERT_FRESH_MS,
  REALTIME_CACHE_MS,
  REALTIME_FRESH_MS,
  type RealtimeHealth,
  type RealtimeSource,
} from '../generated/transit/realtime-contract.ts';
import { decodeFeed, own, timestamp } from './normalize.ts';

export const UPSTREAMS: Record<RealtimeSource, string> = {
  trips: 'http://gtfs.ltconline.ca/TripUpdate/TripUpdates.pb',
  vehicles: 'http://gtfs.ltconline.ca/Vehicle/VehiclePositions.pb',
  alerts: 'http://gtfs.ltconline.ca/Alert/Alerts.pb',
};
export const MAX_FEED_BYTES = 8_000_000;
export const MAX_CACHE_BYTES = 1_950_000;
const RETAIN_MS = 300_000;
export type Snapshot = {
  schema: 1;
  checkedAt: number;
  fetchedAt: number | null;
  retryAt: number;
  etag: string | null;
  lastModified: string | null;
  gzip: string | null;
  error: string | null;
};
export interface SharedCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: Snapshot, options: { ttl: number }): Promise<void>;
}
export type FeedResult = {
  feed: Bindings.transit_realtime.FeedMessage | null;
  health: RealtimeHealth;
};

export async function readBounded(response: Response, maximum: number): Promise<Uint8Array> {
  const length = response.headers.get('content-length');
  if (length && Number(length) > maximum) throw new Error('payload_too_large');
  if (!response.body) throw new Error('empty_payload');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new Error('payload_too_large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function snapshot(raw: unknown, now: number): Snapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Snapshot;
  return value.schema === 1 &&
    Number.isSafeInteger(value.checkedAt) &&
    value.checkedAt <= now + 30_000 &&
    value.checkedAt >= now - RETAIN_MS &&
    (value.gzip === null ||
      (typeof value.gzip === 'string' && value.gzip.length < MAX_CACHE_BYTES)) &&
    Number.isSafeInteger(value.retryAt) &&
    (value.fetchedAt === null ||
      (Number.isSafeInteger(value.fetchedAt) && value.fetchedAt <= now + 30_000)) &&
    (value.etag === null || (typeof value.etag === 'string' && value.etag.length < 500)) &&
    (value.lastModified === null ||
      (typeof value.lastModified === 'string' && value.lastModified.length < 500)) &&
    (value.error === null || (typeof value.error === 'string' && value.error.length < 100))
    ? value
    : null;
}

async function cacheOperation<T>(work: Promise<T>, fallback: T, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('cache_timeout')), 1500);
      }),
    ]);
  } catch {
    console.warn(JSON.stringify({ event: 'transit_cache_unavailable', operation }));
    return fallback;
  } finally {
    clearTimeout(timer!);
  }
}

export class Sources {
  private readonly local = new Map<
    RealtimeSource,
    { snapshot: Snapshot; feed: FeedResult['feed'] }
  >();
  private readonly pending = new Map<RealtimeSource, Promise<FeedResult>>();
  private readonly cache: SharedCache;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(cache: SharedCache, fetcher: typeof fetch = fetch, now: () => number = Date.now) {
    this.cache = cache;
    this.fetcher = fetcher;
    this.now = now;
  }

  get(source: RealtimeSource): Promise<FeedResult> {
    const pending = this.pending.get(source);
    if (pending) return pending;
    const result = this.read(source).finally(() => this.pending.delete(source));
    this.pending.set(source, result);
    return result;
  }

  private health(source: RealtimeSource, value: Snapshot, feed: FeedResult['feed']): FeedResult {
    const now = this.now();
    const feedTimestamp =
      feed && own(feed.header, 'timestamp') ? timestamp(feed.header.timestamp, now) : null;
    // LTC rewrites its alert file only when an alert changes, so that header says when the set last
    // changed; the successful check is what confirms it still holds.
    const confirmedAt =
      source === 'alerts' && feedTimestamp !== null ? value.checkedAt : feedTimestamp;
    const age = source === 'alerts' ? REALTIME_ALERT_FRESH_MS : REALTIME_FRESH_MS;
    return {
      feed,
      health: {
        status: value.error
          ? 'error'
          : confirmedAt === null || now - confirmedAt > age
            ? 'stale'
            : 'ok',
        feedTimestamp,
        fetchedAt: value.fetchedAt,
        error: value.error,
      },
    };
  }

  private async read(source: RealtimeSource): Promise<FeedResult> {
    const now = this.now();
    const key = `nexo-transit:binary-v1:${source}`;
    let previous = this.local.get(source);
    if (
      previous &&
      previous.snapshot.checkedAt >= now - RETAIN_MS &&
      (previous.snapshot.checkedAt > now - REALTIME_CACHE_MS || previous.snapshot.retryAt > now)
    ) {
      return this.health(source, previous.snapshot, previous.feed);
    }
    const shared = snapshot(await cacheOperation(this.cache.get(key), null, 'get'), now);
    if (shared) {
      try {
        const feed =
          shared.gzip === null
            ? null
            : decodeFeed(
                gunzipSync(Buffer.from(shared.gzip, 'base64'), { maxOutputLength: MAX_FEED_BYTES }),
                now,
              );
        previous = { snapshot: shared, feed };
        this.local.set(source, previous);
        if (shared.checkedAt > now - REALTIME_CACHE_MS || shared.retryAt > now)
          return this.health(source, shared, feed);
      } catch {
        console.warn(JSON.stringify({ event: 'transit_cache_invalid', source }));
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let value: Snapshot;
    let feed: FeedResult['feed'] = previous?.feed ?? null;
    let retryMs = REALTIME_CACHE_MS;
    try {
      const headers = new Headers();
      if (previous?.snapshot.etag) headers.set('if-none-match', previous.snapshot.etag);
      else if (previous?.snapshot.lastModified)
        headers.set('if-modified-since', previous.snapshot.lastModified);
      const response = await this.fetcher(UPSTREAMS[source], {
        headers,
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.status === 304 && previous?.feed) {
        value = { ...previous.snapshot, checkedAt: now, retryAt: 0, error: null };
      } else {
        if (!response.ok) {
          const seconds = Number(response.headers.get('retry-after'));
          if (Number.isFinite(seconds) && seconds > 0)
            retryMs = Math.min(RETAIN_MS, Math.max(retryMs, seconds * 1000));
          await response.body?.cancel();
          throw new Error(
            response.status === 429 ? 'upstream_quota' : `upstream_http_${response.status}`,
          );
        }
        const bytes = await readBounded(response, MAX_FEED_BYTES);
        feed = decodeFeed(bytes, now);
        const gzip = gzipSync(bytes).toString('base64');
        value = {
          schema: 1,
          checkedAt: now,
          fetchedAt: now,
          retryAt: 0,
          etag: response.headers.get('etag')?.slice(0, 499) ?? null,
          lastModified: response.headers.get('last-modified')?.slice(0, 499) ?? null,
          gzip,
          error: null,
        };
      }
    } catch (error) {
      const reason = controller.signal.aborted
        ? 'upstream_timeout'
        : error instanceof Error &&
            /^(unsupported_feed|invalid_feed_timestamp|too_many_entities|too_many_stop_updates|payload_too_large|empty_payload|upstream_quota|upstream_http_\d+)$/.test(
              error.message,
            )
          ? error.message
          : 'invalid_or_unavailable_feed';
      value = {
        ...(previous?.snapshot ?? {
          schema: 1,
          fetchedAt: null,
          etag: null,
          lastModified: null,
          gzip: null,
        }),
        checkedAt: now,
        retryAt: now + retryMs,
        error: reason,
      };
      console.warn(JSON.stringify({ event: 'transit_source_error', source, reason }));
    } finally {
      clearTimeout(timeout);
    }
    this.local.set(source, { snapshot: value, feed });
    if (Buffer.byteLength(JSON.stringify(value)) <= MAX_CACHE_BYTES) {
      await cacheOperation(this.cache.set(key, value, { ttl: RETAIN_MS / 1000 }), undefined, 'set');
    } else {
      console.warn(JSON.stringify({ event: 'transit_cache_entry_too_large', source }));
    }
    return this.health(source, value, feed);
  }
}
