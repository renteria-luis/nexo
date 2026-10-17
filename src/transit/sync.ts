import type { SQLiteDatabase } from 'expo-sqlite';

import { isRealDate } from '../core/dates.ts';
import { agencyDate, SCHEDULE_MAX_BYTES, SCHEDULE_SCHEMA, validateSchedule } from './schedule.ts';
import { replaceSchedule, scheduleCheck, type CachedSchedule } from './store.ts';

export const STATIC_BASE_URL = 'https://raw.githubusercontent.com/renteria-luis/nexo/main/transit/';
export type Manifest = {
  schema: number;
  sha256: string;
  sourceSha256: string;
  bytes: number;
  file: string;
  createdAt: number;
  feedVersion: string;
  timezone: string;
  validFrom: string;
  validTo: string;
};

export function validateManifest(raw: unknown): Manifest {
  if (!raw || typeof raw !== 'object')
    throw new Error('El archivo de horarios no trae su versión.');
  const m = raw as Manifest;
  if (
    m.schema !== SCHEDULE_SCHEMA ||
    m.file !== 'schedule.json' ||
    !/^[a-f0-9]{64}$/.test(m.sha256) ||
    !/^[a-f0-9]{64}$/.test(m.sourceSha256) ||
    !Number.isInteger(m.bytes) ||
    m.bytes < 1 ||
    m.bytes > SCHEDULE_MAX_BYTES ||
    !Number.isInteger(m.createdAt) ||
    m.createdAt < 1 ||
    m.createdAt > Date.now() + 86_400_000 ||
    typeof m.feedVersion !== 'string' ||
    !m.feedVersion.trim() ||
    m.timezone !== 'America/Toronto' ||
    !isRealDate(m.validFrom) ||
    !isRealDate(m.validTo) ||
    m.validFrom > m.validTo
  ) {
    throw new Error('La versión de horarios está incompleta o no es compatible.');
  }
  return m;
}

export type SyncResult =
  | { kind: 'updated'; cache: CachedSchedule }
  | { kind: 'unchanged' }
  | { kind: 'failed'; reason: string };
export type StaticTransport = { fetch: typeof fetch; digest: (content: string) => Promise<string> };

export async function syncSchedule(
  db: SQLiteDatabase,
  cache: CachedSchedule,
  transport: StaticTransport,
): Promise<SyncResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const now = Date.now();
  try {
    const response = await transport.fetch(`${STATIC_BASE_URL}manifest.json`, {
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`No se pudieron revisar los horarios (HTTP ${response.status}).`);
    const manifestText = await response.text();
    if (manifestText.length > 10_000) throw new Error('La versión recibida es demasiado grande.');
    const manifest = validateManifest(JSON.parse(manifestText));
    if (manifest.sha256 === cache.sha256) {
      await scheduleCheck(db, now, null);
      return { kind: 'unchanged' };
    }
    if (manifest.createdAt < cache.schedule.createdAt)
      throw new Error('Llegó una versión anterior. Se conserva la guardada.');
    // LTC posts a feed days before it starts, with no buses for the days before; the next day's
    // check takes it once it runs.
    const today = agencyDate(now);
    const { validFrom, validTo } = cache.schedule;
    if (manifest.validFrom > today && validFrom <= today && today <= validTo) {
      await scheduleCheck(db, now, null);
      return { kind: 'unchanged' };
    }
    const artifact = await transport.fetch(`${STATIC_BASE_URL}${manifest.file}`, {
      signal: controller.signal,
    });
    if (!artifact.ok) throw new Error(`No se pudo bajar el horario (HTTP ${artifact.status}).`);
    const length = Number(artifact.headers.get('content-length'));
    if (length > SCHEDULE_MAX_BYTES) throw new Error('El horario supera el tamaño permitido.');
    const buffer = await artifact.arrayBuffer();
    if (buffer.byteLength > SCHEDULE_MAX_BYTES || buffer.byteLength !== manifest.bytes) {
      throw new Error('El horario llegó incompleto o dañado. Se conserva el anterior.');
    }
    const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if ((await transport.digest(content)) !== manifest.sha256) {
      throw new Error('El horario llegó incompleto o dañado. Se conserva el anterior.');
    }
    const schedule = validateSchedule(JSON.parse(content));
    if (
      ['sourceSha256', 'createdAt', 'feedVersion', 'timezone', 'validFrom', 'validTo'].some(
        (key) => schedule[key as keyof typeof schedule] !== manifest[key as keyof Manifest],
      )
    ) {
      throw new Error('El horario no coincide con su versión. Se conserva el anterior.');
    }
    return { kind: 'updated', cache: await replaceSchedule(db, content, manifest.sha256, now) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await scheduleCheck(db, now, reason);
    return { kind: 'failed', reason };
  } finally {
    clearTimeout(timeout);
  }
}
