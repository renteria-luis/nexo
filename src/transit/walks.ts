import { distanceMetres, type Coordinates } from '../core/geo.ts';
import { validCoordinates } from './schedule.ts';

/** Accepted walks a link needs before what they show replaces an estimate. */
export const LEARN_MIN_WALKS = 3;
/** Only his latest accepted walks count, so an old habit fades. */
export const LEARN_RECENT = 10;
/** A drawn or kept path holds at most this many points. */
export const PATH_MAX_POINTS = 120;

export type ObservationStatus = 'new' | 'accepted' | 'excluded';
export type WalkObservation = {
  id: string;
  trip_id: string;
  kind: 'access' | 'transfer' | 'egress';
  place_id: string | null;
  from_stop: string | null;
  to_stop: string | null;
  started_at: number;
  left_at: number | null;
  ended_at: number;
  start_source: 'tap' | 'gps';
  end_source: 'tap' | 'gps';
  accuracy_m: number | null;
  path_m: number;
  straight_m: number;
  planned_minutes: number;
  /** JSON [lat, lng, at][] of the readings along the walk. */
  trace: string;
  flag: 'imprecise' | 'fast' | 'slow' | null;
  status: ObservationStatus;
  created_at: number;
};

/** One directional walk: a place to a stop, a stop to a place, or a stop to another. */
export function walkKey(walk: {
  kind: WalkObservation['kind'];
  place_id: string | null;
  from_stop: string | null;
  to_stop: string | null;
}): string {
  return walk.kind === 'access'
    ? `access:${walk.place_id}>${walk.to_stop}`
    : walk.kind === 'egress'
      ? `egress:${walk.from_stop}>${walk.place_id}`
      : `transfer:${walk.from_stop}>${walk.to_stop}`;
}

export type LearnedWalk = {
  /** The median of his recent accepted walks, rounded up to a whole minute. */
  minutes: number;
  /** The quickest and slowest of them, in minutes. */
  low: number;
  high: number;
  count: number;
};

const minutesOf = (walk: Pick<WalkObservation, 'started_at' | 'ended_at'>) =>
  Math.round((walk.ended_at - walk.started_at) / 6_000) / 10;

/**
 * What his accepted walks say each link takes. The median of at least three keeps one unusual
 * walk, a run or a shortcut, from moving it; only his latest ten count.
 */
export function learnedWalks(
  observations: readonly Pick<
    WalkObservation,
    'kind' | 'place_id' | 'from_stop' | 'to_stop' | 'started_at' | 'ended_at' | 'status'
  >[],
): Map<string, LearnedWalk> {
  const groups = new Map<string, number[]>();
  const accepted = observations
    .filter((walk) => walk.status === 'accepted')
    .sort((a, b) => b.ended_at - a.ended_at);
  for (const walk of accepted) {
    const key = walkKey(walk);
    const minutes = groups.get(key) ?? [];
    if (minutes.length < LEARN_RECENT) minutes.push(minutesOf(walk));
    groups.set(key, minutes);
  }
  const learned = new Map<string, LearnedWalk>();
  for (const [key, minutes] of groups) {
    if (minutes.length < LEARN_MIN_WALKS) continue;
    const sorted = [...minutes].sort((a, b) => a - b);
    const middle = sorted.length / 2;
    const median =
      sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
    learned.set(key, {
      minutes: Math.max(1, Math.ceil(Math.round(median * 10) / 10)),
      low: sorted[0],
      high: sorted.at(-1)!,
      count: sorted.length,
    });
  }
  return learned;
}

/**
 * The planner's personal minutes for a pair of places: what he typed wins, then what his
 * accepted walks show; the rest stays estimated. `learned` names the ones his walks supplied.
 */
export function personalWalks(input: {
  originId: string;
  destinationId: string;
  origin: readonly { stop_id: string; direction: string; minutes: number }[];
  destination: readonly { stop_id: string; direction: string; minutes: number }[];
  stops: readonly { from_stop: string; to_stop: string; minutes: number }[];
  learned: ReadonlyMap<string, LearnedWalk>;
}) {
  const originWalks = new Map(
    input.origin.filter((l) => l.direction === 'to_stop').map((l) => [l.stop_id, l.minutes]),
  );
  const destinationWalks = new Map(
    input.destination.filter((l) => l.direction === 'from_stop').map((l) => [l.stop_id, l.minutes]),
  );
  const stopWalks = [...input.stops];
  const learned = new Set<string>();
  for (const [key, walk] of input.learned) {
    const [kind, ends] = key.split(':');
    const [from, to] = ends.split('>');
    if (kind === 'access' && from === input.originId && !originWalks.has(to)) {
      originWalks.set(to, walk.minutes);
      learned.add(`to:${to}`);
    } else if (kind === 'egress' && to === input.destinationId && !destinationWalks.has(from)) {
      destinationWalks.set(from, walk.minutes);
      learned.add(`from:${from}`);
    } else if (
      kind === 'transfer' &&
      !stopWalks.some((w) => w.from_stop === from && w.to_stop === to)
    ) {
      stopWalks.push({ from_stop: from, to_stop: to, minutes: walk.minutes });
      learned.add(`${from}>${to}`);
    }
  }
  return { originWalks, destinationWalks, stopWalks, learned };
}

/** A path as it is stored: rounded, bounded and checked, or '' for none. */
export function serializePath(points: readonly Coordinates[]): string {
  if (!points.length) return '';
  if (points.length < 2 || points.length > PATH_MAX_POINTS || !points.every(validCoordinates))
    throw new Error(`Un camino necesita de 2 a ${PATH_MAX_POINTS} puntos válidos.`);
  return JSON.stringify(
    points.map((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6]),
  );
}

export function parsePath(text: string): Coordinates[] {
  if (!text) return [];
  const raw = JSON.parse(text) as unknown;
  if (!Array.isArray(raw)) throw new Error('Camino guardado inválido.');
  const points = raw.map((p) =>
    Array.isArray(p) ? { lat: Number(p[0]), lng: Number(p[1]) } : { lat: NaN, lng: NaN },
  );
  serializePath(points);
  return points;
}

/**
 * A walk's readings as a path to keep: the points that bend it, within a few metres, so a
 * straight sidewalk does not cost a hundred points.
 */
export function pathFromTrace(trace: readonly [number, number, number][]): Coordinates[] {
  const points = trace.map(([lat, lng]) => ({ lat, lng }));
  if (points.length < 3) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const simplify = (first: number, last: number, tolerance: number) => {
    let farthest = -1;
    let distance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const off = offLine(points[i], points[first], points[last]);
      if (off > distance) {
        distance = off;
        farthest = i;
      }
    }
    if (farthest < 0) return;
    keep[farthest] = true;
    simplify(first, farthest, tolerance);
    simplify(farthest, last, tolerance);
  };
  simplify(0, points.length - 1, 5);
  const kept = points.filter((_, i) => keep[i]);
  // A very winding walk is thinned evenly rather than refused.
  if (kept.length <= PATH_MAX_POINTS) return kept;
  const step = (kept.length - 1) / (PATH_MAX_POINTS - 1);
  return Array.from({ length: PATH_MAX_POINTS }, (_, i) => kept[Math.round(i * step)]);
}

function offLine(point: Coordinates, a: Coordinates, b: Coordinates): number {
  const length = distanceMetres(a, b);
  if (length === 0) return distanceMetres(point, a);
  const pa = distanceMetres(point, a);
  const pb = distanceMetres(point, b);
  // Outside the segment, the endpoint distance preserves a walk that doubles back.
  if (pa * pa >= pb * pb + length * length) return pb;
  if (pb * pb >= pa * pa + length * length) return pa;
  const s = (pa + pb + length) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - pa) * (s - pb) * (s - length)));
  return (2 * area) / length;
}
