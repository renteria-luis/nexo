import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { migrate } from '../db/migrate.ts';
import { SCHEDULE_SOURCE, type Schedule } from './schedule.ts';

export function scheduleFixture(): Schedule {
  return {
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
  };
}

const minutes = (value: number) => value * 60;
const clock = (hours: number, mins = 0) => minutes(hours * 60 + mins);

/**
 * An invented network for the planner, nowhere real: line 16 runs south from the origin's
 * corner to a transfer corner, line 20 east from there to the destination's corner, the
 * weekday-only 92 skips the middle stop, and a 16 short turn stops halfway. Each line runs back
 * the other way from the opposite curb.
 */
export function plannerFixture(): Schedule {
  const stop = (id: string, lat: number, lng: number): Schedule['stops'][number] => [
    id,
    String(100 + id.length),
    id.replace(/_/g, ' '),
    lat,
    lng,
  ];
  const stops = [
    stop('ORIGIN_SB', 43.0003, -81.2001),
    stop('ORIGIN_NB', 43.0003, -81.1997),
    stop('MIDDLE_SB', 42.994, -81.2001),
    stop('MIDDLE_NB', 42.994, -81.1997),
    stop('CORNER_SB', 42.988, -81.2001),
    stop('CORNER_NB', 42.988, -81.1997),
    stop('CORNER_EB', 42.9876, -81.1993),
    stop('CORNER_WB', 42.988, -81.1993),
    stop('EAST_EB', 42.9876, -81.185),
    stop('EAST_WB', 42.988, -81.185),
    stop('END_EB', 42.9876, -81.1701),
    stop('END_WB', 42.988, -81.1701),
  ];
  const at = (id: string) => stops.findIndex((s) => s[0] === id);
  const pattern = (...visits: [string, number][]): Schedule['patterns'][number] =>
    visits.map(([id, offset], i) => [
      at(id),
      i + 1,
      minutes(offset),
      minutes(offset),
      i === visits.length - 1 ? 1 : 0,
      i === 0 ? 1 : 0,
      1,
      '',
    ]);
  const patterns = [
    pattern(['ORIGIN_SB', 0], ['MIDDLE_SB', 4], ['CORNER_SB', 8]),
    pattern(['ORIGIN_SB', 0], ['MIDDLE_SB', 4]),
    pattern(['CORNER_NB', 0], ['MIDDLE_NB', 4], ['ORIGIN_NB', 8]),
    pattern(['CORNER_EB', 0], ['EAST_EB', 5], ['END_EB', 10]),
    pattern(['END_WB', 0], ['EAST_WB', 5], ['CORNER_WB', 10]),
    pattern(['ORIGIN_SB', 0], ['CORNER_SB', 5]),
  ];
  const trips: Schedule['trips'] = [];
  const every = (
    prefix: string,
    route: number,
    service: string,
    headsign: string,
    direction: number,
    patternIndex: number,
    starts: number[],
  ) =>
    starts.forEach((start, i) =>
      trips.push([`${prefix}-${i}`, route, service, headsign, direction, '', patternIndex, start]),
    );
  const range = (from: number, to: number, step: number) =>
    Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
  every('16S', 0, 'daily', 'Corner', 1, 0, [...range(clock(7, 30), clock(8, 45), minutes(15))]);
  every('16LATE', 0, 'daily', 'Corner', 1, 1, [clock(24, 15)]);
  every('16T', 0, 'daily', 'Short turn', 1, 1, [clock(8, 5)]);
  every('16N', 0, 'daily', 'North', 0, 2, range(clock(7, 30), clock(9, 30), minutes(15)));
  every('20E', 1, 'daily', 'East', 0, 3, range(clock(7, 45), clock(9), minutes(15)));
  every('20W', 1, 'daily', 'West', 1, 4, range(clock(7, 30), clock(9, 30), minutes(15)));
  every('92S', 2, 'weekday', 'Express', 1, 5, [clock(7, 50), clock(8, 20)]);
  return {
    schema: 2,
    source: SCHEDULE_SOURCE,
    sourceSha256: 'b'.repeat(64),
    createdAt: Date.UTC(2026, 9, 11),
    feedVersion: 'planner fixture',
    timezone: 'America/Toronto',
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    stops,
    routes: [
      ['16', '16', 'North south', '00A0E0'],
      ['20', '20', 'East west', 'A0A000'],
      ['92', '92', 'Express', 'E000E0'],
    ],
    services: [
      ['daily', 127, '2026-01-01', '2026-12-31'],
      ['weekday', 31, '2026-01-01', '2026-12-31'],
    ],
    exceptions: [],
    patterns,
    trips,
    shapes: {},
    transfers: [],
  };
}

export function adapt(raw: DatabaseSync): SQLiteDatabase {
  type Param = string | number | null;
  return {
    getAllAsync: async <T>(sql: string, params: Param[] = []) =>
      raw.prepare(sql).all(...params) as T[],
    getFirstAsync: async <T>(sql: string, params: Param[] = []) =>
      (raw.prepare(sql).get(...params) as T) ?? null,
    runAsync: async (sql: string, params: Param[] = []) => raw.prepare(sql).run(...params),
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    withTransactionAsync: async (work: () => Promise<void>) => {
      raw.exec('BEGIN;');
      try {
        await work();
        raw.exec('COMMIT;');
      } catch (error) {
        raw.exec('ROLLBACK;');
        throw error;
      }
    },
  } as unknown as SQLiteDatabase;
}

export async function database() {
  const raw = new DatabaseSync(':memory:');
  const db = adapt(raw);
  await migrate(db);
  return { raw, db };
}
