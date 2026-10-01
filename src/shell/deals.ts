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

/**
 * Tres segundos. Si no contesta en ese rato es que no hay conexion, y quedarse quince
 * mirando una rueda no lo arregla: el archivo que ya tiene sigue ahi.
 */
const TIMEOUT_MS = 3_000;

/**
 * El motivo, dicho como se lo diria a el. Lo que llega aqui es el mensaje de fetch, que
 * en iOS es "Network request failed" y en el navegador otra cosa; ninguno significa nada
 * para quien solo quiere saber si tiene que mirar el wifi.
 */
export function readableReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const plain = raw.toLowerCase();

  if (error instanceof Error && error.name === 'AbortError') return 'Revisa tu conexión.';
  if (plain.includes('network') || plain.includes('timeout') || plain.includes('abort')) {
    return 'Revisa tu conexión.';
  }
  if (plain.includes('failed to fetch') || plain.includes('could not connect')) {
    return 'Revisa tu conexión.';
  }
  if (/respondio 4\d\d/.test(plain)) return 'El archivo de ofertas ya no está donde estaba.';
  if (/respondio 5\d\d/.test(plain)) return 'El servidor de ofertas está caído. Inténtalo después.';
  if (plain.includes('json') || plain.includes('snapshot') || plain.includes('parse')) {
    return 'Lo que llegó no se pudo leer. Inténtalo después.';
  }
  return 'No se pudo actualizar. Inténtalo después.';
}

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
    // En la base queda el mensaje crudo, que es lo que sirve para arreglarlo; en la
    // pantalla va el que se entiende.
    const raw = error instanceof Error ? error.message : String(error);
    await recordFailure(db, 'flipp', raw).catch(() => undefined);
    return { kind: 'failed', reason: readableReason(error) };
  } finally {
    clearTimeout(timer);
  }
}
