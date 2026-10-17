import { distanceMetres } from '../core/geo.ts';
import {
  estimatedWalkMinutes,
  liveOptions,
  type Itinerary,
  type PlanOption,
  type PlanResult,
  type Walk,
} from './planner.ts';
import { stopClosure, type LiveSnapshot } from './realtime.ts';
import type { Route } from './schedule.ts';

/** How many stops he is offered to board at, nearest first. */
export const STOP_CHOICES = 3;
// When fewer stops than that take him there, the search looks this far, then farther.
export const STOP_REACH_M = [600, 1_500, 3_000];

/** A stop he can board at: how far it is and the buses from it that take him there. */
export type StopChoice = {
  /** The stop's position in the schedule. */
  stop: number;
  walk: Walk;
  /** As live data leaves them, the one he just missed at this stop first. */
  options: PlanOption[];
  /** Its lines that take him there, by the first to leave. */
  routes: Route[];
};

/** A stop near him that LTC has closed for now, shown greyed out beside the ones he can use. */
export type ClosedStop = { stop: number; metres: number; minutes: number; reason: string };

/**
 * Leaving now, the stops he can board at, nearest first, each with the buses from it that take him
 * there. Each stop's buses are judged on their own, so a quicker bus from another stop does not
 * hide them; a stop where none still works is left out.
 */
export function stopChoices(
  result: PlanResult,
  snapshot: LiveSnapshot | null,
  now: number,
): StopChoice[] {
  const byStop = new Map<number, Itinerary[]>();
  for (const plan of result.pool) {
    const first = plan.rides[0];
    if (!first) continue;
    const stop = first.departure.stopTime[0];
    const list = byStop.get(stop);
    if (list) list.push(plan);
    else byStop.set(stop, [plan]);
  }
  const choices: StopChoice[] = [];
  for (const [stop, pool] of byStop) {
    const options = liveOptions({ ...result, pool, best: pool }, snapshot, now);
    const working = options
      .filter((option) => !option.problem && !option.notice && !option.missed)
      .sort((a, b) => a.leaveAt - b.leaveAt);
    if (!working.length) continue;
    const routes = new Map<string, Route>();
    for (const option of working) {
      const route = option.itinerary.rides[0].route;
      if (!routes.has(route[0])) routes.set(route[0], route);
    }
    choices.push({ stop, walk: pool[0].access, options, routes: [...routes.values()] });
  }
  return choices.sort((a, b) => a.walk.minutes - b.walk.minutes || a.walk.metres - b.walk.metres);
}

/** The closed stops among `ids`, with why and how far from where he leaves, nearest first. */
export function closedStops(
  result: PlanResult,
  ids: readonly string[],
  snapshot: LiveSnapshot | null,
  now: number,
): ClosedStop[] {
  const { index } = result.context;
  return ids
    .flatMap((id) => {
      const stop = index.stopIds.get(id);
      if (stop === undefined) return [];
      const row = index.schedule.stops[stop];
      const metres = distanceMetres(result.request.origin, { lat: row[3], lng: row[4] });
      return [
        {
          stop,
          metres: Math.round(metres),
          minutes: estimatedWalkMinutes(metres),
          reason:
            stopClosure(index.schedule, snapshot, id, now) ?? 'LTC lo reportó cerrado hace poco.',
        },
      ];
    })
    .sort((a, b) => a.metres - b.metres);
}
