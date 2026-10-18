import { distanceMetres } from '../core/geo.ts';
import {
  estimatedWalkMinutes,
  liveOptions,
  timetableListing,
  type Itinerary,
  type PlanOption,
  type PlanResult,
  type Walk,
} from './planner.ts';
import { stopClosure, type LiveSnapshot } from './realtime.ts';
import type { Route } from './schedule.ts';

/** How many stops he is offered to board at, the one that suits him best first. */
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
  /** The bus from here that costs him least, which ranks the stop. */
  best: PlanOption;
  /** Its cost in minutes, see `optionCost`. */
  cost: number;
  /** Its lines that take him there, by the first to leave. */
  routes: Route[];
};

// What a trip costs him, counted in minutes of arriving later. When he arrives weighs most; the
// rest settles options that arrive close together. Walking already delays the arrival, so its
// weight is only the effort on top.
export const COST = { transfer: 7, tight: 3, walk: 1, trip: 0.25 };

/**
 * How much an option costs him from `now`, in minutes, lower being better: when he arrives, plus a
 * price for each transfer, for a tight one, for each minute on foot and for each minute out of the
 * door, so waiting at home for a better bus beats waiting at a stop.
 */
export function optionCost(option: PlanOption, now: number): number {
  const { rides, access, transfer, egress } = option.itinerary;
  const walk = access.minutes + (transfer?.minutes ?? 0) + (egress?.minutes ?? 0);
  return (
    (option.arriveAt - now) / 60_000 +
    COST.transfer * Math.max(0, rides.length - 1) +
    (option.tight ? COST.tight : 0) +
    COST.walk * walk +
    (COST.trip * (option.arriveAt - option.leaveAt)) / 60_000
  );
}

/** A stop near him that LTC has closed for now, shown greyed out beside the ones he can use. */
export type ClosedStop = { stop: number; metres: number; minutes: number; reason: string };

/**
 * Leaving now, the stops he can board at, the one whose best bus costs him least first, each with
 * the buses from it that take him there. Each stop's buses are judged on their own, so a quicker
 * bus from another stop does not hide them; a stop where none still works is left out.
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
    const options = liveOptions(
      { ...result, pool, best: timetableListing(result.request, pool) },
      snapshot,
      now,
    );
    const working = options
      .filter((option) => !option.problem && !option.notice && !option.missed)
      .sort((a, b) => a.leaveAt - b.leaveAt);
    if (!working.length) continue;
    const routes = new Map<string, Route>();
    for (const option of working) {
      const route = option.itinerary.rides[0].route;
      if (!routes.has(route[0])) routes.set(route[0], route);
    }
    let best = working[0];
    let cost = optionCost(best, now);
    for (const option of working.slice(1)) {
      const next = optionCost(option, now);
      if (next < cost) [best, cost] = [option, next];
    }
    choices.push({ stop, walk: pool[0].access, options, best, cost, routes: [...routes.values()] });
  }
  return choices.sort(
    (a, b) => a.cost - b.cost || a.walk.minutes - b.walk.minutes || a.walk.metres - b.walk.metres,
  );
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
