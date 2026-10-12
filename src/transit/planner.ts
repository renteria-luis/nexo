import { addDays, type IsoDate } from '../core/dates.ts';
import { distanceMetres, type Coordinates } from '../core/geo.ts';
import type { LiveAlert } from './realtime-contract.ts';
import {
  mergeLiveDeparture,
  relevantLiveAlerts,
  type LiveDeparture,
  type LiveSnapshot,
} from './realtime.ts';
import {
  activeServices,
  agencyDate,
  serviceDayStart,
  type Departure,
  type Route,
  type Schedule,
  type Trip,
} from './schedule.ts';

// Estimates he approved on 2026-10-11 for when he has not saved his own minutes. They are shown
// as estimates, never as measurements, and his saved minutes always replace them.
export const WALK_METRES_PER_MINUTE = 75;
export const WALK_DETOUR = 1.3;
export const BOARD_MARGIN_MIN = 2;
export const TRANSFER_MARGIN_MIN = 3;
export const TIGHT_TRANSFER_MIN = 5;
export const ARRIVE_EARLY_MIN = 3;

// Search bounds. The two-sided search was benchmarked on October 2026 data in desktop Hermes;
// the prototype's naive search took seconds. These are not physical iPhone measurements.
export const ACCESS_RADIUS_M = 600;
export const TRANSFER_RADIUS_M = 400;
export const WALK_ONLY_M = 1_500;
export const FIRST_WINDOW_MIN = 90;
export const MAX_TRIP_MIN = 180;
export const MAX_TRANSFER_WAIT_MIN = 60;
// An extra bus has to let him leave this much later, arriving no later, to push a simpler option
// off the list; otherwise a direct bus an hour slower would stay just for having no transfer.
export const TRANSFER_WORTH_MIN = 10;
const POOL = 120;
const MINUTE = 60_000;

const CELL_LAT = 0.005;
const CELL_LNG = 0.007;
// The narrower side of a cell at London's latitude, so a radius never misses a cell.
const CELL_M = 550;

export function estimatedWalkMinutes(metres: number): number {
  return Math.max(1, Math.ceil((metres * WALK_DETOUR) / WALK_METRES_PER_MINUTE));
}

export type PlannerIndex = {
  schedule: Schedule;
  /** Each time pattern's trips by start; trips sharing a pattern never overtake each other. */
  patternTrips: Trip[][];
  /** Per stop, the pattern and position of every visit, as flat pairs. */
  visits: number[][];
  stopIds: Map<string, number>;
  grid: Map<string, number[]>;
};

const cellKey = (row: number, column: number) => `${row}:${column}`;

export function buildPlannerIndex(schedule: Schedule): PlannerIndex {
  const patternTrips = schedule.patterns.map(() => [] as Trip[]);
  for (const trip of schedule.trips) patternTrips[trip[6]].push(trip);
  for (const trips of patternTrips) trips.sort((a, b) => a[7] - b[7]);
  const visits = schedule.stops.map(() => [] as number[]);
  for (const [pattern, times] of schedule.patterns.entries())
    for (const [position, time] of times.entries()) visits[time[0]].push(pattern, position);
  const stopIds = new Map<string, number>();
  const grid = new Map<string, number[]>();
  for (const [stop, row] of schedule.stops.entries()) {
    stopIds.set(row[0], stop);
    const key = cellKey(Math.floor(row[3] / CELL_LAT), Math.floor(row[4] / CELL_LNG));
    const cell = grid.get(key);
    if (cell) cell.push(stop);
    else grid.set(key, [stop]);
  }
  return { schedule, patternTrips, visits, stopIds, grid };
}

function stopsWithin(
  index: PlannerIndex,
  point: Coordinates,
  radius: number,
  wanted: (stop: number) => boolean = () => true,
) {
  const found: { stop: number; metres: number }[] = [];
  const row = Math.floor(point.lat / CELL_LAT);
  const column = Math.floor(point.lng / CELL_LNG);
  const span = Math.ceil(radius / CELL_M);
  for (let r = row - span; r <= row + span; r++)
    for (let c = column - span; c <= column + span; c++) {
      const cell = index.grid.get(cellKey(r, c));
      if (!cell) continue;
      for (const stop of cell) {
        if (!wanted(stop)) continue;
        const s = index.schedule.stops[stop];
        const metres = distanceMetres(point, { lat: s[3], lng: s[4] });
        if (metres <= radius) found.push({ stop, metres });
      }
    }
  return found;
}

export type PlanMode = 'now' | 'depart' | 'arrive';
export type PlanRequest = {
  origin: Coordinates;
  destination: Coordinates;
  /** His saved minutes from the origin to a stop, by stop id. */
  originWalks: ReadonlyMap<string, number>;
  /** His saved minutes from a stop to the destination, by stop id. */
  destinationWalks: ReadonlyMap<string, number>;
  /** His saved transfer walks between two stops, one direction each. */
  stopWalks: readonly { from_stop: string; to_stop: string; minutes: number }[];
  mode: PlanMode;
  /** Now, the time to leave at, or the time to be there by. */
  at: number;
};

export type Walk = {
  /** A stop index, or null for the place. */
  from: number | null;
  to: number | null;
  minutes: number;
  source: 'saved' | 'estimate' | 'same';
  /** Straight line, which is only what an estimate starts from. */
  metres: number;
};

export type Ride = {
  trip: Trip;
  route: Route;
  serviceDate: IsoDate;
  /** Positions in the trip's ordered stops. */
  board: number;
  alight: number;
  departure: Departure;
  /** The alighting stop as a departure, which is how live predictions are matched to it. */
  arrival: Departure;
  arriveAt: number;
};

export type Itinerary = {
  key: string;
  /** None when the whole way is walked. */
  rides: Ride[];
  access: Walk;
  transfer: Walk | null;
  egress: Walk | null;
  /** The latest he can leave the door. */
  leaveAt: number;
  arriveAt: number;
  /** Free time at the second stop after the walk and before the bus, in ms. */
  slack: number | null;
};

type ServiceDay = { date: IsoDate; start: number; active: Set<string> };
type Boarding = { trip: Trip; day: ServiceDay; board: number; walk: Walk };
type Front = {
  key: number;
  arrival: number[];
  leave: number[];
  boarding: number[];
  alight: number[];
};
type Feeder = {
  key: number;
  leave: number;
  board: number;
  boarding: number;
  alight: number;
  transfer: Walk;
  slack: number;
};
type Candidate = {
  leave: number;
  arrive: number;
  rides: number;
  final: { trip: Trip; day: ServiceDay; board: number; alight: number } | null;
  egress: Walk | null;
  first: { boarding: number; alight: number; transfer: Walk } | null;
  walkOnly: Walk | null;
};

export type PlanIssue =
  'outside-validity' | 'no-origin-stops' | 'no-destination-stops' | 'none' | null;

type PlanContext = {
  index: PlannerIndex;
  days: ServiceDay[];
  egress: Map<number, Walk>;
  /** Per pattern, the positions where it lets him off at a destination stop. */
  finals: Map<number, number[]>;
  saved: Map<string, number>;
  savedFrom: Map<number, number[]>;
  savedTo: Map<number, number[]>;
};

export type PlanResult = {
  request: PlanRequest;
  /** The options no other beats on leaving later, arriving earlier and fewer transfers. */
  best: Itinerary[];
  /** The best option for each last bus near the shown ones, for re-ranking with live data. */
  pool: Itinerary[];
  issue: PlanIssue;
  /** Loop iterations, which is what the search's cost grows with. */
  work: number;
  context: PlanContext;
};

function routeKey(trip: Trip): number {
  return trip[1] * 3 + (trip[4] === 0 ? 0 : trip[4] === 1 ? 1 : 2);
}

function lowerBound(trips: Trip[], start: number): number {
  let low = 0;
  let high = trips.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (trips[middle][7] < start) low = middle + 1;
    else high = middle;
  }
  return low;
}

function lastAtOrBefore(values: number[], limit: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] <= limit) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

function serviceDays(schedule: Schedule, from: number, to: number): ServiceDay[] {
  const days: ServiceDay[] = [];
  const last = agencyDate(to);
  // Times past 24:00 belong to an earlier service day, as in the stop card's departures.
  for (let date = addDays(agencyDate(from), -2); date <= last; date = addDays(date, 1)) {
    const active = activeServices(schedule, date);
    if (active.size) days.push({ date, start: serviceDayStart(date), active });
  }
  return days;
}

function stopWalk(context: PlanContext, from: number, to: number, metres: number): Walk {
  if (from === to) return { from, to, minutes: 0, source: 'same', metres: 0 };
  const saved = context.saved.get(`${from}/${to}`);
  return saved !== undefined
    ? { from, to, minutes: saved, source: 'saved', metres }
    : { from, to, minutes: estimatedWalkMinutes(metres), source: 'estimate', metres };
}

function metresBetween(index: PlannerIndex, a: number, b: number) {
  const stops = index.schedule.stops;
  return distanceMetres(
    { lat: stops[a][3], lng: stops[a][4] },
    { lat: stops[b][3], lng: stops[b][4] },
  );
}

// The stops a transfer can walk between: the same stop, those within the radius, and any pair
// he saved a walk for, at whatever distance.
function transferWalks(
  context: PlanContext,
  stop: number,
  direction: 'into' | 'out',
  wanted?: (stop: number) => boolean,
): Walk[] {
  const s = context.index.schedule.stops[stop];
  const walks = stopsWithin(context.index, { lat: s[3], lng: s[4] }, TRANSFER_RADIUS_M, wanted).map(
    ({ stop: other, metres }) =>
      direction === 'into'
        ? stopWalk(context, other, stop, metres)
        : stopWalk(context, stop, other, metres),
  );
  const extra = (direction === 'into' ? context.savedTo : context.savedFrom).get(stop) ?? [];
  for (const other of extra) {
    if (wanted && !wanted(other)) continue;
    if (walks.some((w) => (direction === 'into' ? w.from : w.to) === other)) continue;
    const metres = metresBetween(context.index, other, stop);
    walks.push(
      direction === 'into'
        ? stopWalk(context, other, stop, metres)
        : stopWalk(context, stop, other, metres),
    );
  }
  return walks;
}

function placeWalks(
  index: PlannerIndex,
  point: Coordinates,
  saved: ReadonlyMap<string, number>,
  toStop: boolean,
): Map<number, Walk> {
  const walks = new Map<number, Walk>();
  const add = (stop: number, metres: number, minutes: number, source: Walk['source']) =>
    walks.set(stop, {
      from: toStop ? null : stop,
      to: toStop ? stop : null,
      minutes,
      source,
      metres,
    });
  for (const { stop, metres } of stopsWithin(index, point, ACCESS_RADIUS_M))
    add(stop, metres, estimatedWalkMinutes(metres), 'estimate');
  for (const [id, minutes] of saved) {
    const stop = index.stopIds.get(id);
    if (stop === undefined) continue;
    const s = index.schedule.stops[stop];
    add(stop, distanceMetres(point, { lat: s[3], lng: s[4] }), minutes, 'saved');
  }
  return walks;
}

function makeRide(
  schedule: Schedule,
  trip: Trip,
  day: ServiceDay,
  board: number,
  alight: number,
): Ride {
  const pattern = schedule.patterns[trip[6]];
  const route = schedule.routes[trip[1]];
  const at = (seconds: number) => day.start + (trip[7] + seconds) * 1_000;
  const stopAt = (position: number): Departure => ({
    trip,
    route,
    stopTime: pattern[position],
    serviceDate: day.date,
    at: at(pattern[position][3]),
  });
  return {
    trip,
    route,
    serviceDate: day.date,
    board,
    alight,
    departure: stopAt(board),
    arrival: stopAt(alight),
    arriveAt: at(pattern[alight][2]),
  };
}

const rideKey = (ride: Ride) => `${ride.trip[0]}/${ride.serviceDate}/${ride.board}/${ride.alight}`;

function itinerary(
  rides: Ride[],
  access: Walk,
  transfer: Walk | null,
  egress: Walk | null,
  leaveAt: number,
  arriveAt: number,
): Itinerary {
  const [first, second] = rides;
  return {
    key: rides.length ? `${rides.map(rideKey).join('|')}|${egress?.from}` : 'walk',
    rides,
    access,
    transfer,
    egress,
    leaveAt,
    arriveAt,
    slack:
      second && transfer ? second.departure.at - first.arriveAt - transfer.minutes * MINUTE : null,
  };
}

/**
 * Keeps the options no other one beats: leaving later and arriving no later, with no more buses,
 * or with one more bus that buys TRANSFER_WORTH_MIN of leaving later.
 */
function dominanceFilter<T>(
  options: T[],
  view: (option: T) => { leaveAt: number; arriveAt: number; rides: number },
): T[] {
  const sorted = options
    .map((option) => ({ option, ...view(option) }))
    .sort((a, b) => a.arriveAt - b.arriveAt || b.leaveAt - a.leaveAt || a.rides - b.rides);
  const latest = [-Infinity, -Infinity, -Infinity];
  const kept: T[] = [];
  for (const { option, leaveAt, rides } of sorted) {
    if (
      latest.some(
        (leave, r) => leave - Math.max(0, r - rides) * TRANSFER_WORTH_MIN * MINUTE >= leaveAt,
      )
    )
      continue;
    kept.push(option);
    latest[rides] = Math.max(latest[rides], leaveAt);
  }
  return kept;
}

export type PlanSearch = {
  /** Runs for about `budgetMs` and says whether the search finished. */
  step: (budgetMs: number) => boolean;
  result: () => PlanResult;
};

export function startPlan(
  index: PlannerIndex,
  request: PlanRequest,
  clock: () => number = Date.now,
): PlanSearch {
  const schedule = index.schedule;
  const patterns = schedule.patterns;
  const arriving = request.mode === 'arrive';
  const from = arriving ? request.at - MAX_TRIP_MIN * MINUTE : request.at;
  const boardBy = arriving
    ? request.at - ARRIVE_EARLY_MIN * MINUTE
    : request.at + FIRST_WINDOW_MIN * MINUTE;
  const arriveBy = arriving
    ? request.at - ARRIVE_EARLY_MIN * MINUTE
    : request.at + MAX_TRIP_MIN * MINUTE;
  const saved = new Map<string, number>();
  const savedFrom = new Map<number, number[]>();
  const savedTo = new Map<number, number[]>();
  for (const walk of request.stopWalks) {
    const a = index.stopIds.get(walk.from_stop);
    const b = index.stopIds.get(walk.to_stop);
    if (a === undefined || b === undefined || a === b) continue;
    saved.set(`${a}/${b}`, walk.minutes);
    savedFrom.set(a, [...(savedFrom.get(a) ?? []), b]);
    savedTo.set(b, [...(savedTo.get(b) ?? []), a]);
  }
  const access = placeWalks(index, request.origin, request.originWalks, true);
  const egress = placeWalks(index, request.destination, request.destinationWalks, false);
  const context: PlanContext = {
    index,
    days: serviceDays(schedule, from, arriveBy),
    egress,
    finals: new Map(),
    saved,
    savedFrom,
    savedTo,
  };
  const days = context.days;
  for (const [stop] of egress) {
    const visits = index.visits[stop];
    for (let v = 0; v < visits.length; v += 2) {
      const pattern = visits[v];
      const position = visits[v + 1];
      if (position === 0 || patterns[pattern][position][5] === 1) continue;
      context.finals.set(pattern, [...(context.finals.get(pattern) ?? []), position]);
    }
  }
  let work = 0;
  const boardings: Boarding[] = [];
  const reached = new Map<number, number[]>();
  const feeds = new Map<number, Front[]>();
  const walksInto = new Map<number, Walk[]>();
  const candidates: Candidate[] = [];

  // First rides: every bus he can catch near the origin in the window, and when it reaches each
  // later stop. Per stop and line only a staircase survives: arriving later only to leave later.
  const firstRides = (stop: number, walk: Walk) => {
    const ready = from + (walk.minutes + BOARD_MARGIN_MIN) * MINUTE;
    const visits = index.visits[stop];
    for (let v = 0; v < visits.length; v += 2) {
      const pattern = patterns[visits[v]];
      const board = visits[v + 1];
      if (pattern[board][4] === 1) continue;
      const trips = index.patternTrips[visits[v]];
      for (let d = 0; d < days.length; d++) {
        const day = days[d];
        const need = Math.ceil((ready - day.start) / 1_000) - pattern[board][3];
        for (let t = lowerBound(trips, need); t < trips.length; t++) {
          const trip = trips[t];
          const departs = day.start + (trip[7] + pattern[board][3]) * 1_000;
          if (departs > boardBy) break;
          if (!day.active.has(trip[2])) continue;
          const leave = departs - (BOARD_MARGIN_MIN + walk.minutes) * MINUTE;
          const id = boardings.push({ trip, day, board, walk }) - 1;
          const key = routeKey(trip);
          for (let alight = board + 1; alight < pattern.length; alight++) {
            work++;
            const time = pattern[alight];
            if (time[5] === 1) continue;
            const arrives = day.start + (trip[7] + time[2]) * 1_000;
            if (arrives > arriveBy) break;
            const list = reached.get(time[0]);
            if (list) list.push(arrives, leave, key, id, alight);
            else reached.set(time[0], [arrives, leave, key, id, alight]);
          }
        }
      }
    }
  };

  const keepUseful = () => {
    for (const [stop, flat] of reached) {
      const order: number[] = [];
      for (let e = 0; e < flat.length; e += 5) order.push(e);
      order.sort((a, b) => flat[a] - flat[b] || flat[b + 1] - flat[a + 1]);
      const fronts: Front[] = [];
      for (const e of order) {
        let front = fronts.find((f) => f.key === flat[e + 2]);
        if (!front) {
          front = { key: flat[e + 2], arrival: [], leave: [], boarding: [], alight: [] };
          fronts.push(front);
        }
        if (front.leave.length && front.leave[front.leave.length - 1] >= flat[e + 1]) continue;
        front.arrival.push(flat[e]);
        front.leave.push(flat[e + 1]);
        front.boarding.push(flat[e + 3]);
        front.alight.push(flat[e + 4]);
      }
      feeds.set(stop, fronts);
    }
    reached.clear();
  };
  const fed = (stop: number) => feeds.has(stop);

  // Last rides: every bus that lets him off near the destination, boarded near the origin or
  // after walking from a stop where a first ride leaves him with the transfer margin to spare.
  const lastRides = (stop: number, out: Walk) => {
    const visits = index.visits[stop];
    for (let v = 0; v < visits.length; v += 2) {
      const pattern = patterns[visits[v]];
      const alight = visits[v + 1];
      if (alight === 0 || pattern[alight][5] === 1) continue;
      const trips = index.patternTrips[visits[v]];
      for (let d = 0; d < days.length; d++) {
        const day = days[d];
        const need = Math.ceil((from - day.start) / 1_000) - pattern[alight][2];
        for (let t = lowerBound(trips, need); t < trips.length; t++) {
          const trip = trips[t];
          const door = day.start + (trip[7] + pattern[alight][2]) * 1_000 + out.minutes * MINUTE;
          if (door > arriveBy) break;
          if (!day.active.has(trip[2])) continue;
          const key = routeKey(trip);
          let direct: { leave: number; board: number } | null = null;
          // The best first ride of each line, so a late bus on one still leaves the others to
          // re-rank with live data.
          const feeders: Feeder[] = [];
          for (let board = alight - 1; board >= 0; board--) {
            work++;
            const time = pattern[board];
            if (time[4] === 1) continue;
            const departs = day.start + (trip[7] + time[3]) * 1_000;
            if (departs < from) break;
            const walk = access.get(time[0]);
            if (walk && departs <= boardBy) {
              const leave = departs - (BOARD_MARGIN_MIN + walk.minutes) * MINUTE;
              if (leave >= from && (!direct || leave > direct.leave)) direct = { leave, board };
            }
            let into = walksInto.get(time[0]);
            if (!into) {
              into = transferWalks(context, time[0], 'into', fed);
              walksInto.set(time[0], into);
            }
            for (let w = 0; w < into.length; w++) {
              const transfer = into[w];
              const fronts = feeds.get(transfer.from!)!;
              const deadline = departs - (TRANSFER_MARGIN_MIN + transfer.minutes) * MINUTE;
              for (let f = 0; f < fronts.length; f++) {
                work++;
                const front = fronts[f];
                if (front.key === key) continue;
                const e = lastAtOrBefore(front.arrival, deadline);
                if (e < 0 || deadline - front.arrival[e] > MAX_TRANSFER_WAIT_MIN * MINUTE) continue;
                const slack = deadline + TRANSFER_MARGIN_MIN * MINUTE - front.arrival[e];
                const known = feeders.find((feeder) => feeder.key === front.key);
                if (
                  known &&
                  (known.leave > front.leave[e] ||
                    (known.leave === front.leave[e] && known.slack >= slack))
                )
                  continue;
                const feeder: Feeder = {
                  key: front.key,
                  leave: front.leave[e],
                  board,
                  boarding: front.boarding[e],
                  alight: front.alight[e],
                  transfer,
                  slack,
                };
                if (known) feeders[feeders.indexOf(known)] = feeder;
                else feeders.push(feeder);
              }
            }
          }
          const final = { trip, day, alight };
          if (direct)
            candidates.push({
              leave: direct.leave,
              arrive: door,
              rides: 1,
              final: { ...final, board: direct.board },
              egress: out,
              first: null,
              walkOnly: null,
            });
          for (const feeder of feeders)
            candidates.push({
              leave: feeder.leave,
              arrive: door,
              rides: 2,
              final: { ...final, board: feeder.board },
              egress: out,
              first: {
                boarding: feeder.boarding,
                alight: feeder.alight,
                transfer: feeder.transfer,
              },
              walkOnly: null,
            });
        }
      }
    }
  };

  const build = (candidate: Candidate): Itinerary => {
    if (candidate.walkOnly)
      return itinerary([], candidate.walkOnly, null, null, candidate.leave, candidate.arrive);
    const f = candidate.final!;
    const last = makeRide(schedule, f.trip, f.day, f.board, f.alight);
    if (!candidate.first) {
      const walk = access.get(last.departure.stopTime[0])!;
      return itinerary([last], walk, null, candidate.egress, candidate.leave, candidate.arrive);
    }
    const b = boardings[candidate.first.boarding];
    const first = makeRide(schedule, b.trip, b.day, b.board, candidate.first.alight);
    return itinerary(
      [first, last],
      b.walk,
      candidate.first.transfer,
      candidate.egress,
      candidate.leave,
      candidate.arrive,
    );
  };

  let result: PlanResult | null = null;
  const finish = () => {
    const metres = distanceMetres(request.origin, request.destination);
    let kept = candidates;
    if (metres <= WALK_ONLY_M) {
      const minutes = estimatedWalkMinutes(metres);
      const leave = arriving ? arriveBy - minutes * MINUTE : request.at;
      // Walking can start at any time, so a bus that takes as long as the walk is never better.
      kept = candidates.filter((c) => c.arrive - c.leave < minutes * MINUTE);
      kept.push({
        leave,
        arrive: leave + minutes * MINUTE,
        rides: 0,
        final: null,
        egress: null,
        first: null,
        walkOnly: { from: null, to: null, minutes, source: 'estimate', metres },
      });
    }
    // What matters is arriving early when leaving at a time, and leaving late when arriving by one.
    kept.sort((a, b) =>
      arriving
        ? b.leave - a.leave || a.arrive - b.arrive || a.rides - b.rides
        : a.arrive - b.arrive || b.leave - a.leave || a.rides - b.rides,
    );
    const pool = kept.slice(0, POOL).map(build);
    const day = agencyDate(request.at);
    result = {
      request,
      best: dominanceFilter(pool, (plan) => ({
        leaveAt: plan.leaveAt,
        arriveAt: plan.arriveAt,
        rides: plan.rides.length,
      })),
      pool,
      issue:
        day < schedule.validFrom || day > schedule.validTo
          ? 'outside-validity'
          : !access.size
            ? 'no-origin-stops'
            : !egress.size
              ? 'no-destination-stops'
              : pool.length
                ? null
                : 'none',
      work,
      context,
    };
  };

  const tasks: (() => void)[] = [
    ...[...access].map(
      ([stop, walk]) =>
        () =>
          firstRides(stop, walk),
    ),
    keepUseful,
    ...[...egress].map(
      ([stop, walk]) =>
        () =>
          lastRides(stop, walk),
    ),
    finish,
  ];
  let next = 0;
  return {
    step: (budgetMs) => {
      const started = clock();
      while (next < tasks.length) {
        tasks[next++]();
        if (clock() - started >= budgetMs) break;
      }
      return next >= tasks.length;
    },
    result: () => {
      if (!result) throw new Error('La búsqueda de viajes todavía no termina.');
      return result;
    },
  };
}

/** Runs a search in slices so the screen keeps drawing between them; null when cancelled. */
export async function runPlan(
  search: PlanSearch,
  control: { pause: () => Promise<void>; cancelled: () => boolean; budgetMs?: number },
): Promise<PlanResult | null> {
  for (;;) {
    if (control.cancelled()) return null;
    if (search.step(control.budgetMs ?? 8)) return search.result();
    await control.pause();
  }
}

export type NextRide = { ride: Ride; transfer: Walk; egress: Walk; arriveAt: number };

// The earliest way on to the destination from a stop he reaches at `readyAt`, without one trip:
// what to take after missing or losing a connection.
function continueFrom(
  context: PlanContext,
  stop: number,
  readyAt: number,
  skip: Ride,
): NextRide | null {
  const schedule = context.index.schedule;
  let best: NextRide | null = null;
  for (const transfer of transferWalks(context, stop, 'out')) {
    const ready = readyAt + (transfer.minutes + TRANSFER_MARGIN_MIN) * MINUTE;
    const visits = context.index.visits[transfer.to!];
    for (let v = 0; v < visits.length; v += 2) {
      const finals = context.finals.get(visits[v]);
      const board = visits[v + 1];
      const pattern = schedule.patterns[visits[v]];
      if (!finals || pattern[board][4] === 1 || !finals.some((m) => m > board)) continue;
      const trips = context.index.patternTrips[visits[v]];
      for (const day of context.days) {
        const need = Math.ceil((ready - day.start) / 1_000) - pattern[board][3];
        for (let t = lowerBound(trips, need); t < trips.length; t++) {
          const trip = trips[t];
          const departs = day.start + (trip[7] + pattern[board][3]) * 1_000;
          if (departs > ready + MAX_TRANSFER_WAIT_MIN * MINUTE) break;
          if (!day.active.has(trip[2])) continue;
          if (trip[0] === skip.trip[0] && day.date === skip.serviceDate) continue;
          for (const alight of finals) {
            if (alight <= board) continue;
            const egress = context.egress.get(pattern[alight][0])!;
            const arriveAt =
              day.start + (trip[7] + pattern[alight][2]) * 1_000 + egress.minutes * MINUTE;
            if (!best || arriveAt < best.arriveAt)
              best = {
                ride: makeRide(schedule, trip, day, board, alight),
                transfer,
                egress,
                arriveAt,
              };
          }
          break;
        }
      }
    }
  }
  return best;
}

export type RideLive = { board: LiveDeparture; alight: LiveDeparture };
export type PlanOption = {
  itinerary: Itinerary;
  live: RideLive[];
  leaveAt: number;
  arriveAt: number;
  slack: number | null;
  /** Under TIGHT_TRANSFER_MIN free at the transfer. */
  tight: boolean;
  /** What to take after missing the second bus of a tight transfer. */
  backup: NextRide | null;
  /** The second bus live data took away, already replaced in `itinerary`. */
  replaced: { ride: Ride; reason: 'late' | 'canceled' | 'skipped' } | null;
  /** Why the option no longer works, when live data says so. */
  problem: 'canceled' | 'skipped' | 'missed' | null;
  /**
   * A listed option that live data broke or made worse than another: kept only to say what
   * changed, so a cancelled or late bus does not just vanish from the list.
   */
  notice: boolean;
  /** The option as the schedule had it. */
  scheduleKey: string;
};

function rideLive(
  schedule: Schedule,
  ride: Ride,
  snapshot: LiveSnapshot | null,
  liveTrips: Set<string>,
  now: number,
): RideLive {
  const usable = snapshot && liveTrips.has(ride.trip[0]) ? snapshot : null;
  return {
    board: mergeLiveDeparture(schedule, ride.departure, usable, now),
    alight: mergeLiveDeparture(schedule, ride.arrival, usable, now),
  };
}

/** LTC's alerts for a ride's line, or for the stop where he boards or gets off. */
export function rideAlerts(
  schedule: Schedule,
  ride: Ride,
  snapshot: LiveSnapshot | null,
  now: number,
): LiveAlert[] {
  const alerts = new Map<string, LiveAlert>();
  for (const departure of [ride.departure, ride.arrival])
    for (const alert of relevantLiveAlerts(schedule, departure, snapshot, now))
      alerts.set(alert.id, alert);
  return [...alerts.values()];
}

function broken(live: RideLive): 'canceled' | 'skipped' | null {
  for (const event of [live.board, live.alight]) {
    if (event.status === 'canceled') return 'canceled';
    if (event.status === 'skipped') return 'skipped';
  }
  return null;
}

/**
 * The options as live data leaves them: each bus at its predicted time, a lost transfer
 * replaced by the next bus, a cancelled or skipping trip kept visible as such, and a backup for
 * a tight transfer. Without a snapshot it is the schedule.
 */
export function liveOptions(
  result: PlanResult,
  snapshot: LiveSnapshot | null,
  now: number,
): PlanOption[] {
  const context = result.context;
  const schedule = context.index.schedule;
  const { mode, at } = result.request;
  const liveTrips = new Set(snapshot?.tripUpdates.map((t) => t.tripId) ?? []);
  // Options share their buses, and what follows a stop at a given time is the same for all.
  const merged = new Map<string, RideLive>();
  const ridden = (ride: Ride) => {
    const key = rideKey(ride);
    let found = merged.get(key);
    if (!found) {
      found = rideLive(schedule, ride, snapshot, liveTrips, now);
      merged.set(key, found);
    }
    return found;
  };
  const continued = new Map<string, NextRide | null>();
  const after = (first: Ride, readyAt: number, skip: Ride) => {
    const key = `${first.arrival.stopTime[0]}/${readyAt}/${rideKey(skip)}`;
    if (!continued.has(key))
      continued.set(key, continueFrom(context, first.arrival.stopTime[0], readyAt, skip));
    return continued.get(key)!;
  };
  const evaluate = (plan: Itinerary): PlanOption => {
    let current = plan;
    let live = current.rides.map(ridden);
    let replaced: PlanOption['replaced'] = null;
    let problem: PlanOption['problem'] = live.map(broken).find(Boolean) ?? null;
    if (current.rides.length === 2 && current.transfer && !broken(live[0])) {
      const [first, second] = current.rides;
      const reason =
        broken(live[1]) ??
        (live[1].board.at - live[0].alight.at - current.transfer.minutes * MINUTE <
        TRANSFER_MARGIN_MIN * MINUTE
          ? 'late'
          : null);
      if (reason) {
        replaced = { ride: second, reason };
        const next = after(first, live[0].alight.at, second);
        if (next) {
          current = itinerary(
            [first, next.ride],
            current.access,
            next.transfer,
            next.egress,
            current.leaveAt,
            next.arriveAt,
          );
          live = [live[0], ridden(next.ride)];
          problem = broken(live[1]);
        } else problem = reason === 'late' ? 'missed' : reason;
      }
    }
    const first = live[0];
    const last = live.at(-1);
    // Walking the whole way can start whenever he does.
    const leaveAt = first
      ? first.board.at - (BOARD_MARGIN_MIN + current.access.minutes) * MINUTE
      : mode === 'now'
        ? Math.max(current.leaveAt, now)
        : current.leaveAt;
    const slack =
      current.rides.length === 2 && current.transfer
        ? live[1].board.at - live[0].alight.at - current.transfer.minutes * MINUTE
        : null;
    const tight = slack !== null && slack < TIGHT_TRANSFER_MIN * MINUTE;
    const backup =
      tight && !problem ? after(current.rides[0], live[0].alight.at, current.rides[1]) : null;
    return {
      itinerary: current,
      live,
      leaveAt,
      arriveAt: last
        ? last.alight.at + (current.egress?.minutes ?? 0) * MINUTE
        : leaveAt + current.access.minutes * MINUTE,
      slack,
      tight,
      backup,
      replaced,
      problem,
      notice: false,
      scheduleKey: plan.key,
    };
  };
  // A live time can move an option out of what was asked: leaving before the chosen time, or
  // arriving after the time to be there by.
  const fits = (option: PlanOption) =>
    mode === 'arrive'
      ? option.arriveAt <= at
      : option.leaveAt >= (mode === 'now' ? now : at) - MINUTE;
  const walking = result.pool.find((plan) => !plan.rides.length);
  const evaluated = result.pool
    .map(evaluate)
    .filter(
      (option) =>
        fits(option) &&
        (!walking ||
          !option.itinerary.rides.length ||
          option.arriveAt - option.leaveAt < walking.access.minutes * MINUTE),
    );
  const unique = new Map<string, PlanOption>();
  for (const option of evaluated) {
    const seen = unique.get(option.itinerary.key);
    if (!seen || option.leaveAt > seen.leaveAt) unique.set(option.itinerary.key, option);
  }
  const working = dominanceFilter(
    [...unique.values()].filter((option) => !option.problem),
    (option) => ({
      leaveAt: option.leaveAt,
      arriveAt: option.arriveAt,
      rides: option.itinerary.rides.length,
    }),
  );
  const listed = new Set(result.best.map((plan) => plan.key));
  const shown = new Set(working.map((option) => option.itinerary.key));
  const notices = new Map<string, PlanOption>();
  for (const option of evaluated)
    if (
      listed.has(option.scheduleKey) &&
      (option.problem || option.replaced) &&
      !shown.has(option.itinerary.key)
    )
      notices.set(option.scheduleKey, { ...option, notice: true });
  return [...working, ...notices.values()].sort(
    (a, b) => a.arriveAt - b.arriveAt || b.leaveAt - a.leaveAt,
  );
}

/** The boarding and alighting stops of the best options, in order, for the live query. */
export function planLiveStops(result: PlanResult, limit: number): string[] {
  const stops = result.context.index.schedule.stops;
  const ids: string[] = [];
  const best = result.request.mode === 'arrive' ? [...result.best].reverse() : result.best;
  for (const option of best)
    for (const ride of option.rides)
      for (const time of [ride.departure.stopTime, ride.arrival.stopTime]) {
        const id = stops[time[0]][0];
        if (!ids.includes(id)) ids.push(id);
        if (ids.length >= limit) return ids;
      }
  return ids;
}
