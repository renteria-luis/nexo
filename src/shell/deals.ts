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
import type { DealsSourceRow } from '../db/types.ts';

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

/** El colector corre una vez al dia: pasado esto, lo guardado ya no es lo de hoy. */
const STALE_AFTER_MS = 20 * 60 * 60 * 1000;
/** Y si no se pudo bajar, no se insiste cada vez que vuelve a la app. */
const RETRY_AFTER_MS = 60 * 60 * 1000;

/**
 * Si toca bajar la recoleccion sola. Spec 16.10 abre la hoja de ofertas al abrir la app
 * cuando hay recoleccion nueva, y la app solo la bajaba al tocar Actualizar, asi que la
 * hoja nunca traia nada que el no hubiera ido a buscar.
 */
export function dealsDue(
  lastSuccessAt: number | null,
  lastTriedAt: number | null,
  now: number,
): boolean {
  if (lastTriedAt !== null && now - lastTriedAt < RETRY_AFTER_MS) return false;
  return lastSuccessAt === null || now - lastSuccessAt > STALE_AFTER_MS;
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

/** Cuanto hace de algo, dicho como se lee: "hace 3 h", "hace 2 días". */
export function ago(at: number | null, now: number): string {
  if (at === null) return 'nunca';
  const hours = Math.floor((now - at) / 3_600_000);
  if (hours < 1) return 'hace menos de una hora';
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

/**
 * El colector corre cada dia; pasado dia y medio sin una recoleccion nueva, se callo. Del
 * 21 al 24 de septiembre fallo cuatro dias seguidos y la app seguia diciendo "al dia".
 */
export const SILENT_AFTER_MS = 36 * 60 * 60 * 1000;

/**
 * Lo que se dice de una fuente (spec 16.7): una que no contesta, o que contesta con lo
 * mismo de hace dias, lo dice, y nunca se pinta lo viejo como si fuera nuevo. `silent`
 * es que hay que avisarlo tambien en el aviso y en Hoy.
 */
export function sourceStatus(
  source: Pick<DealsSourceRow, 'name' | 'health' | 'last_success_at'>,
  now: number,
): { line: string; silent: boolean } {
  const last = source.last_success_at;
  if (last === null) return { line: `${source.name}: sin datos todavía`, silent: true };
  if (now - last > SILENT_AFTER_MS) {
    const days = Math.max(1, Math.floor((now - last) / (24 * 3_600_000)));
    return {
      line: `${source.name}: sin datos nuevos desde hace ${days} ${days === 1 ? 'día' : 'días'}`,
      silent: true,
    };
  }
  if (source.health !== 'ok') {
    return {
      line: `${source.name}: no se pudo actualizar, última vez ${ago(last, now)}`,
      silent: false,
    };
  }
  return { line: `${source.name}: al día, última vez ${ago(last, now)}`, silent: false };
}
