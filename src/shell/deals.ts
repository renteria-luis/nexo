// Bringing the collected snapshot into the app.
//
// Spec 16.2: the app is a pure consumer. It never scrapes, never holds a vendor
// credential and never blocks on a fetch. It reads what it has stored and, when it
// can, replaces it with something newer.
//
// The URL is the seam. Today it points at the file the scheduled job publishes; the
// day there is a server (spec 16.2's read-only API) only this line changes.

import type { SQLiteDatabase } from 'expo-sqlite';

import { applySnapshot, parseSnapshot, recordFailure } from '../deals/index.ts';

const SNAPSHOT_URL = 'https://raw.githubusercontent.com/renteria-luis/nexo/main/deals/flipp.json';

const TIMEOUT_MS = 15_000;

export type SyncOutcome =
  { kind: 'ok'; count: number; fetchedAt: number } | { kind: 'failed'; reason: string };

/**
 * Fetches the snapshot and stores it. Never throws: a source that is down is a state
 * the screen shows (spec 16.7), not a crash. Whatever was stored before stays
 * readable, which is what makes the module work on the subway.
 */
export async function syncDeals(db: SQLiteDatabase): Promise<SyncOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(SNAPSHOT_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`el servidor respondio ${response.status}`);

    const snapshot = parseSnapshot(await response.text());
    const count = await applySnapshot(db, snapshot);
    return { kind: 'ok', count, fetchedAt: snapshot.fetchedAt };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await recordFailure(db, 'flipp', reason).catch(() => undefined);
    return { kind: 'failed', reason };
  } finally {
    clearTimeout(timer);
  }
}
