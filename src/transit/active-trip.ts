import { addDays, type IsoDate } from '../core/dates.ts';
import { distanceMetres, type Coordinates } from '../core/geo.ts';
import {
  estimatedWalkMinutes,
  liveOptions,
  sharedPlannerIndex,
  startPlan,
  WALK_DETOUR,
  WALK_METRES_PER_MINUTE,
  type PlanOption,
  type Walk,
} from './planner.ts';
import {
  LIVE_ROUTES_MAX,
  LIVE_STOPS_MAX,
  LIVE_TRIPS_MAX,
  mergeLiveDeparture,
  pathStops,
  tripLiveDetail,
  type LiveDeparture,
  type LiveSnapshot,
} from './realtime.ts';
import {
  agencyClock,
  scheduledTime,
  type Departure,
  type Schedule,
  type Trip,
} from './schedule.ts';

// First thresholds for reading a trip from the phone's GPS. None was measured on his iPhone yet;
// they are deliberately strict about claiming a boarding, and every inference can be corrected.
/** A reading with a larger error never moves the trip along. */
export const FIX_MAX_ERROR_M = 50;
/** At a stop: this close, plus up to this much of the reading's own error. */
export const STOP_NEAR_M = 30;
/** At the destination, likewise. */
export const PLACE_NEAR_M = 40;
/** Out of the place he left, even counting the reading's error. */
export const PLACE_LEFT_M = 60;
/** The first reading this far from the origin means he did not start the walk there. */
export const START_AWAY_M = 150;
/** On the bus's path: this close, plus the reading's error. */
export const ON_ROUTE_M = 60;
/** Past the boarding stop along the path by this much before a boarding is considered. */
export const BOARD_PROGRESS_M = 250;
/** Faster than this (18 km/h) is not walking. */
export const BUS_SPEED_MS = 5;
/** Slower than this (9 km/h) is on foot. */
export const WALK_MAX_MS = 2.5;
/** Two readings in a row on the path at bus speed before an inferred boarding. */
export const BOARD_HITS = 2;
/** His reading and his bus's current GPS this close: he is on that bus. */
export const MATCH_BUS_M = 150;
/** His bus's current GPS this far while he moves along its route: he is on something else. */
export const OTHER_BUS_M = 500;
/** Moving along the route this long before his bus is due is another bus or a car. */
export const EARLY_BOARD_MS = 3 * 60_000;
/** Being at the boarding stop counts towards a boarding for this long. */
export const WAIT_STOP_MS = 10 * 60_000;
/** Still at the stop this long after his bus was due: he probably missed it. */
export const MISSED_MS = 4 * 60_000;
/** Off the bus's path by this much near the alighting stop: he got off. */
export const ALIGHT_OFF_M = 60;
/** Walking pace near the alighting stop for this long: he got off. */
export const ALIGHT_DWELL_MS = 45 * 1_000;
/** The warning to get off goes out this many stops before his; one left him too little time. */
export const WARN_STOPS_AHEAD = 2;
/** Past the alighting stop along the path by this much at bus speed: he stayed on. */
export const PASSED_M = 300;
/** A walk shorter than this is not a walk worth learning from. */
export const MIN_WALK_MS = 30 * 1_000;
/** Endpoint readings worse than this make an observation imprecise. */
export const IMPRECISE_M = 30;
/** A straight-line pace above this (7.2 km/h) is running or a ride, not his habitual walk. */
export const FAST_WALK_MS = 2;
/** The trip ends this long after the planned arrival unless he is still moving. */
export const EXPIRE_AFTER_MS = 45 * 60_000;
/** Each moving reading on a bus keeps the trip alive at least this long. */
export const MOVING_GRACE_MS = 20 * 60_000;
/** No trip is followed longer than this. */
export const MAX_TRIP_MS = 4 * 3_600_000;
/** Other buses for his last ride are looked for this far from him, at most this many. */
export const ALTERNATIVE_REACH_M = 200;
const MAX_ALTERNATIVES = 3;
/** And looked for again this often, or with each new live reading. */
export const ALTERNATIVES_EVERY_MS = 60_000;
const MAX_TRACE = 150;
const MAX_LOG = 40;

export type Fix = Coordinates & {
  /** Error radius in metres, as the phone reports it. */
  accuracy: number | null;
  /** Metres per second, when the phone knows it. */
  speed: number | null;
  at: number;
};

export type TripEnd = Coordinates & {
  /** A point is where he was or one he chose, not a saved place: no walk is learned to it. */
  kind: 'place' | 'stop' | 'point';
  id: string;
  name: string;
  /** The stop's public code; empty for a place. */
  code: string;
};

export type TripStop = Coordinates & {
  id: string;
  name: string;
  code: string;
  /** Its position in the trip's ordered stops, which is how live data refers to it. */
  position: number;
  arrival: number;
  departure: number;
};

/** One bus as it was chosen: its stops from boarding to getting off, and the street it takes. */
export type TripRide = {
  tripId: string;
  serviceDate: IsoDate;
  routeId: string;
  route: string;
  color: string;
  headsign: string;
  stops: TripStop[];
  path: Coordinates[];
  /** Where the bus goes after his stop, up to its next one: how a missed stop shows. */
  after: Coordinates[];
  /** Metres along `path` of each of `stops`. */
  along: number[];
  /** When he planned to board and to get off, live if it was when he left. */
  boardAt: number;
  arriveAt: number;
};

export type TripWalk = {
  kind: 'access' | 'transfer' | 'egress';
  from: TripEnd;
  to: TripEnd;
  minutes: number;
  source: Walk['source'];
  /** The way he saved for this walk, from end to end, when he has one. */
  path?: Coordinates[];
};

/** Another bus that takes him to the end no later than his last one. */
export type TripAlternative = {
  ride: TripRide;
  /** The walk to its stop: his own when it leaves from the stop he was heading to. */
  walk: TripWalk;
  egress: TripWalk;
  arriveAt: number;
};

export type TripPhase =
  | 'walking'
  | 'waiting'
  | 'riding'
  | 'transferring'
  | 'final'
  | 'completed'
  | 'canceled'
  | 'expired';
export type BoardingEvidence = 'manual' | 'matched' | 'inferred';
export type TripSource = 'start' | 'gps' | 'tap' | 'clock';

type WalkTrack = {
  startedAt: number;
  source: 'tap' | 'gps';
  /** Error of the reading that started it, when one did. */
  accuracy: number | null;
  /** When a reading first put him clearly out of the place he left, on the first walk. */
  leftAt: number | null;
  /** False once the readings show the walk did not start where it should. */
  usable: boolean;
  trace: [lat: number, lng: number, at: number][];
};

export type ActiveTrip = {
  version: 1;
  id: string;
  /** The saved next trip it started from. */
  journeyId: string | null;
  /** The schedule its rides were read from; live data for another one cannot name its buses. */
  sourceSha256: string;
  origin: TripEnd;
  destination: TripEnd;
  /** The walk before each ride, then the one after the last; a single walk when on foot. */
  walks: TripWalk[];
  rides: TripRide[];
  startedAt: number;
  plannedArriveAt: number;
  expiresAt: number;
  endedAt: number | null;
  phase: TripPhase;
  /** The ride he is on or heading to; rides.length once past the last one. */
  leg: number;
  boarded: (BoardingEvidence | null)[];
  log: { at: number; phase: TripPhase; leg: number; source: TripSource }[];
  walk: WalkTrack | null;
  /** The last reading at the stop he waits at. */
  nearStopAt: number | null;
  boarding: { hits: number; doubt: 'other-bus' | 'early' | null };
  /** On a bus: the furthest point along its path, and since when he is at the stop to get off. */
  progress: { at: number | null; atStopSince: number | null };
  lastFix: Fix | null;
  /** Events already told, so a reading or a restart never repeats one. */
  notified: string[];
  /** An explicitly corrected boarding gets a fresh warning without replaying the old one. */
  warningVersions?: number[];
  /**
   * Waiting for his last bus or walking to it, the others around him that get him there no
   * later; the GPS follows one he boards instead.
   */
  alternatives?: {
    leg: number;
    checkedAt: number;
    /** The live reading they were judged with. */
    liveAt: number | null;
    options: TripAlternative[];
  };
  /** Walks timed on this trip, which wait for his review in Transit. Older trips lack it. */
  measured?: number;
  /** What following the trip cost, for measuring it on the phone. */
  stats: {
    fixes: number;
    ignored: number;
    batches: number;
    liveReads: number;
    liveBytes: number;
    firstFixAt: number | null;
    lastFixAt: number | null;
  };
};

export type TripEvent = {
  key: string;
  kind:
    | 'alight'
    | 'passed'
    | 'transfer'
    | 'late'
    | 'connection'
    | 'missed'
    | 'doubt'
    | 'earlier'
    | 'expired';
  title: string;
  body: string;
};

export type WalkObservationDraft = {
  tripId: string;
  kind: TripWalk['kind'];
  placeId: string | null;
  fromStop: string | null;
  toStop: string | null;
  startedAt: number;
  leftAt: number | null;
  endedAt: number;
  startSource: 'tap' | 'gps';
  endSource: 'tap' | 'gps';
  /** The worse error of the two readings that bound it, when both are known. */
  accuracy: number | null;
  pathMetres: number;
  straightMetres: number;
  /** The minutes the plan used for it, to judge whether it was an ordinary walk. */
  plannedMinutes: number;
  trace: [lat: number, lng: number, at: number][];
  flag: 'imprecise' | 'fast' | 'slow' | null;
};

export type TripStep = {
  trip: ActiveTrip;
  events: TripEvent[];
  observations: WalkObservationDraft[];
};

export type TripLive = { schedule: Schedule; snapshot: LiveSnapshot | null };

export type TripAction =
  'boarded' | 'not-boarded' | 'alighted' | 'still-riding' | 'arrived' | 'finish' | 'cancel';

export const isActive = (trip: ActiveTrip | null): boolean =>
  !!trip && !['completed', 'canceled', 'expired'].includes(trip.phase);

// Planar metres around a reference latitude: the paths are a few kilometres long.
function planar(origin: Coordinates) {
  const cos = Math.cos((origin.lat * Math.PI) / 180);
  return (p: Coordinates) => ({
    x: (p.lng - origin.lng) * 111_320 * cos,
    y: (p.lat - origin.lat) * 110_540,
  });
}

function pathLength(points: readonly Coordinates[]): number[] {
  if (!points.length) return [];
  const xy = planar(points[0]);
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    const a = xy(points[i - 1]);
    const b = xy(points[i]);
    along.push(along[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return along;
}

/**
 * Where a point falls along a path and how far off it is. `after` keeps a noisy reading from
 * jumping back onto an earlier stretch of a path that passes the same street twice.
 */
export function locateOnPath(
  path: readonly Coordinates[],
  point: Coordinates,
  after: number | null = null,
): { at: number; off: number } {
  if (path.length === 1) return { at: 0, off: distanceMetres(path[0], point) };
  const xy = planar(point);
  let walked = 0;
  let best: { at: number; off: number; cost: number } | null = null;
  for (let k = 0; k < path.length - 1; k++) {
    const a = xy(path[k]);
    const b = xy(path[k + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const f = length === 0 ? 0 : Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / length ** 2));
    const off = Math.hypot(a.x + f * dx, a.y + f * dy);
    const at = walked + f * length;
    const cost = off + (after !== null && at < after - 150 ? after - 150 - at : 0);
    if (!best || cost < best.cost) best = { at, off, cost };
    walked += length;
  }
  return { at: best?.at ?? 0, off: best?.off ?? Infinity };
}

const tracks = new WeakMap<TripRide, Coordinates[]>();
/** The ride's path and where the bus goes after his stop, as one line to place him on. */
function rideTrack(ride: TripRide): Coordinates[] {
  let points = tracks.get(ride);
  if (!points) tracks.set(ride, (points = [...ride.path, ...ride.after]));
  return points;
}

function interpolate(points: Coordinates[], along: number[], target: number): Coordinates {
  let k = 0;
  while (k < points.length - 2 && along[k + 1] < target) k++;
  const span = along[k + 1] - along[k];
  const f = span <= 0 ? 0 : Math.min(1, Math.max(0, (target - along[k]) / span));
  return {
    lat: points[k].lat + f * (points[k + 1].lat - points[k].lat),
    lng: points[k].lng + f * (points[k + 1].lng - points[k].lng),
  };
}

function freezeRide(
  schedule: Schedule,
  ride: PlanOption['itinerary']['rides'][number],
  live: PlanOption['live'][number],
): TripRide {
  const pattern = schedule.patterns[ride.trip[6]];
  const stops = pattern.slice(ride.board, ride.alight + 1).map((time, k): TripStop => {
    const stop = schedule.stops[time[0]];
    return {
      id: stop[0],
      name: stop[2],
      code: stop[1],
      lat: stop[3],
      lng: stop[4],
      position: ride.board + k,
      arrival: scheduledTime(ride.serviceDate, ride.trip[7] + time[2]),
      departure: scheduledTime(ride.serviceDate, ride.trip[7] + time[3]),
    };
  });
  // The street the bus takes when its drawn path fits its stops, otherwise stop to stop.
  const shape = pathStops(schedule, ride.trip);
  const following = pattern[ride.alight + 1];
  let path: Coordinates[] = stops.map(({ lat, lng }) => ({ lat, lng }));
  let after: Coordinates[] = following
    ? [{ lat: schedule.stops[following[0]][3], lng: schedule.stops[following[0]][4] }]
    : [];
  if (shape) {
    const start = shape.stops[ride.board];
    const end = shape.stops[ride.alight];
    const beyond = shape.stops[ride.alight + 1] ?? end;
    const between = (from: number, to: number) =>
      shape.points.filter((_, k) => shape.along[k] > from && shape.along[k] < to);
    path = [
      interpolate(shape.points, shape.along, start),
      ...between(start, end),
      interpolate(shape.points, shape.along, end),
    ];
    after =
      beyond > end ? [...between(end, beyond), interpolate(shape.points, shape.along, beyond)] : [];
  }
  const total = pathLength(path).at(-1) ?? 0;
  const along = [0];
  for (let k = 1; k < stops.length - 1; k++)
    along.push(Math.min(total, locateOnPath(path, stops[k], along[k - 1]).at));
  if (stops.length > 1) along.push(total);
  return {
    tripId: ride.trip[0],
    serviceDate: ride.serviceDate,
    routeId: ride.route[0],
    route: ride.route[1],
    color: ride.route[3],
    headsign: ride.trip[3],
    stops,
    path,
    after,
    along,
    boardAt: live.board.at,
    arriveAt: live.alight.at,
  };
}

/** An end of the trip: a saved place, or with `point` where he was or a point he chose. */
export type TripPoint = Coordinates & { id: string; name: string; point?: boolean };

function stopEnd(schedule: Schedule, index: number): TripEnd {
  const stop = schedule.stops[index];
  return { kind: 'stop', id: stop[0], name: stop[2], code: stop[1], lat: stop[3], lng: stop[4] };
}

/** The trip as he leaves: the chosen option, frozen so it can be followed without the planner. */
export function freezeTrip(input: {
  id: string;
  journeyId: string | null;
  schedule: Schedule;
  option: PlanOption;
  origin: TripPoint;
  destination: TripPoint;
  /** His saved ways for the walks, by kind. */
  paths?: Partial<Record<TripWalk['kind'], Coordinates[]>>;
  now: number;
}): ActiveTrip {
  const { schedule, option, now } = input;
  const plan = option.itinerary;
  const placeEnd = (place: TripPoint): TripEnd => ({
    kind: place.point ? 'point' : 'place',
    id: place.id,
    name: place.name,
    code: '',
    lat: place.lat,
    lng: place.lng,
  });
  const walk = (kind: TripWalk['kind'], value: Walk, from: TripEnd, to: TripEnd): TripWalk => ({
    kind,
    from,
    to,
    minutes: value.minutes,
    source: value.source,
    ...(input.paths?.[kind] ? { path: input.paths[kind] } : {}),
  });
  const walks: TripWalk[] = [];
  if (!plan.rides.length)
    walks.push(walk('access', plan.access, placeEnd(input.origin), placeEnd(input.destination)));
  else {
    walks.push(
      walk('access', plan.access, placeEnd(input.origin), stopEnd(schedule, plan.access.to!)),
    );
    if (plan.rides.length === 2 && plan.transfer)
      walks.push(
        walk(
          'transfer',
          plan.transfer,
          stopEnd(schedule, plan.transfer.from!),
          stopEnd(schedule, plan.transfer.to!),
        ),
      );
    if (!plan.egress)
      throw new Error('El viaje elegido no dice cómo llegar desde la última parada.');
    walks.push(
      walk(
        'egress',
        plan.egress,
        stopEnd(schedule, plan.egress.from!),
        placeEnd(input.destination),
      ),
    );
  }
  const rides = plan.rides.map((ride, i) => freezeRide(schedule, ride, option.live[i]));
  return {
    version: 1,
    id: input.id,
    journeyId: input.journeyId,
    sourceSha256: schedule.sourceSha256,
    origin: placeEnd(input.origin),
    destination: placeEnd(input.destination),
    walks,
    rides,
    startedAt: now,
    plannedArriveAt: option.arriveAt,
    expiresAt: Math.min(now + MAX_TRIP_MS, Math.max(option.arriveAt, now) + EXPIRE_AFTER_MS),
    endedAt: null,
    phase: 'walking',
    leg: 0,
    boarded: rides.map(() => null),
    log: [{ at: now, phase: 'walking', leg: 0, source: 'start' }],
    walk: { startedAt: now, source: 'tap', accuracy: null, leftAt: null, usable: true, trace: [] },
    nearStopAt: null,
    boarding: { hits: 0, doubt: null },
    progress: { at: null, atStopSince: null },
    lastFix: null,
    notified: [],
    stats: {
      fixes: 0,
      ignored: 0,
      batches: 0,
      liveReads: 0,
      liveBytes: 0,
      firstFixAt: null,
      lastFixAt: null,
    },
  };
}

export function parseActiveTrip(content: string): ActiveTrip {
  const trip = JSON.parse(content) as ActiveTrip;
  if (
    trip?.version !== 1 ||
    typeof trip.id !== 'string' ||
    !Array.isArray(trip.rides) ||
    !Array.isArray(trip.walks) ||
    trip.walks.length !== (trip.rides.length ? trip.rides.length + 1 : 1) ||
    !Number.isInteger(trip.leg) ||
    trip.leg < 0 ||
    trip.leg > trip.rides.length ||
    !Number.isFinite(trip.expiresAt)
  )
    throw new Error('No se pudo leer el viaje en curso.');
  return trip;
}

// A step copies what it changes; the frozen rides and walks are shared and never edited.
function editable(trip: ActiveTrip): ActiveTrip {
  return {
    ...trip,
    boarded: [...trip.boarded],
    log: [...trip.log],
    walk: trip.walk && { ...trip.walk, trace: [...trip.walk.trace] },
    boarding: { ...trip.boarding },
    progress: { ...trip.progress },
    notified: [...trip.notified],
    stats: { ...trip.stats },
  };
}

const near = (fix: Fix, point: Coordinates, radius: number) =>
  distanceMetres(fix, point) <= radius + Math.min(fix.accuracy ?? radius, radius);

function record(trip: ActiveTrip, at: number, source: TripSource) {
  trip.log.push({ at, phase: trip.phase, leg: trip.leg, source });
  if (trip.log.length > MAX_LOG) trip.log.splice(1, trip.log.length - MAX_LOG);
}

function track(at: number, source: 'tap' | 'gps', accuracy: number | null): WalkTrack {
  return { startedAt: at, source, accuracy, leftAt: null, usable: true, trace: [] };
}

function remember(walk: WalkTrack, fix: Fix) {
  walk.trace.push([
    Math.round(fix.lat * 1e6) / 1e6,
    Math.round(fix.lng * 1e6) / 1e6,
    Math.round(fix.at),
  ]);
  // Halving keeps the shape of a long walk inside a bounded row.
  if (walk.trace.length > MAX_TRACE) walk.trace = walk.trace.filter((_, i) => i % 2 === 0);
}

function emit(step: TripStep, event: TripEvent) {
  if (step.trip.notified.includes(event.key)) return;
  step.trip.notified.push(event.key);
  step.events.push(event);
}

/** A stop as he reads it on the sign: its name without LTC's code suffix, then the code. */
export const stopLabel = (stop: { name: string; code: string }) =>
  `${stop.name.replace(/ - #\d+$/, '')}${stop.code ? ` (#${stop.code})` : ''}`;

const tripsBySchedule = new WeakMap<Schedule, Map<string, Trip>>();

/** The scheduled departure a ride's stop is, so live data can be matched to it. */
export function departureOf(
  trip: ActiveTrip,
  ride: TripRide,
  index: number,
  schedule: Schedule,
): Departure | null {
  if (schedule.sourceSha256 !== trip.sourceSha256) return null;
  let trips = tripsBySchedule.get(schedule);
  if (!trips)
    tripsBySchedule.set(schedule, (trips = new Map(schedule.trips.map((t) => [t[0], t]))));
  const scheduled = trips.get(ride.tripId);
  const stop = ride.stops[index];
  const time = scheduled && schedule.patterns[scheduled[6]][stop.position];
  if (!scheduled || !time || schedule.stops[time[0]][0] !== stop.id) return null;
  return {
    trip: scheduled,
    route: schedule.routes[scheduled[1]],
    stopTime: time,
    serviceDate: ride.serviceDate,
    at: scheduledTime(ride.serviceDate, scheduled[7] + time[3]),
  };
}

/** LTC's word on a stop of the ride, merged with the timetable exactly as the trip cards do. */
export function rideStopLive(
  trip: ActiveTrip,
  ride: TripRide,
  index: number,
  context: TripLive | null,
  now: number,
): LiveDeparture | null {
  const departure = context && departureOf(trip, ride, index, context.schedule);
  // Past the stop he boards at, what matters is when the bus gets to each stop, not when it leaves.
  return departure
    ? mergeLiveDeparture(
        context.schedule,
        departure,
        context.snapshot,
        now,
        index > 0 ? 'arrival' : 'departure',
      )
    : null;
}

/** When the bus is expected at a stop of the ride: a current prediction, else the plan. */
export function rideStopAt(
  trip: ActiveTrip,
  ride: TripRide,
  index: number,
  context: TripLive | null,
  now: number,
): { at: number; live: boolean } {
  const live = rideStopLive(trip, ride, index, context, now);
  if (live?.status === 'live') return { at: live.at, live: true };
  const planned = index === 0 ? ride.boardAt : index === ride.stops.length - 1 ? ride.arriveAt : 0;
  if (planned) return { at: planned, live: false };
  // An intermediate stop keeps the delay he planned with at the boarding stop.
  return { at: ride.stops[index].arrival + (ride.boardAt - ride.stops[0].departure), live: false };
}

/** His bus's current GPS, when LTC reports it on this trip. */
function rideBus(
  trip: ActiveTrip,
  ride: TripRide,
  context: TripLive | null,
  now: number,
): Coordinates | null {
  const departure = context?.snapshot && departureOf(trip, ride, 0, context.schedule);
  if (!departure) return null;
  const bus = tripLiveDetail(context.schedule, departure, context.snapshot, now).bus;
  return bus && bus.placedBy === 'gps' && bus.why !== 'other-trip' ? bus.point : null;
}

/** What is left of the walk he is on from his last reading: straight-line metres and minutes. */
export function walkAhead(trip: ActiveTrip): { metres: number; minutes: number } | null {
  const fix = trip.lastFix;
  if (!fix || !isActive(trip) || !['walking', 'transferring', 'final'].includes(trip.phase))
    return null;
  const walk = trip.walks[Math.min(trip.leg, trip.walks.length - 1)];
  return {
    metres: Math.round(distanceMetres(fix, walk.to)),
    minutes: Math.max(1, Math.ceil(remainingWalkMs(walk, fix) / 60_000)),
  };
}

/** The share of a walk still ahead, in the minutes the plan gave it. */
function remainingWalkMs(walk: TripWalk, fix: Fix): number {
  const total = distanceMetres(walk.from, walk.to);
  const left = distanceMetres(fix, walk.to);
  const minutes =
    total > 0
      ? walk.minutes * Math.min(2, left / total)
      : (left * WALK_DETOUR) / WALK_METRES_PER_MINUTE;
  return minutes * 60_000;
}

function observe(
  trip: ActiveTrip,
  step: TripStep,
  endedAt: number,
  endSource: 'tap' | 'gps',
  endAccuracy: number | null,
) {
  const walk = trip.walks[trip.leg];
  const track = trip.walk;
  if (
    !track ||
    !track.usable ||
    !trip.rides.length ||
    endedAt - track.startedAt < MIN_WALK_MS ||
    // A walk is learned per saved place; one from where he happened to be teaches nothing.
    walk.from.kind === 'point' ||
    walk.to.kind === 'point'
  )
    return;
  const seconds = (endedAt - track.startedAt) / 1_000;
  const straight = distanceMetres(walk.from, walk.to);
  const trace = track.trace;
  let pathMetres = 0;
  for (let i = 1; i < trace.length; i++)
    pathMetres += distanceMetres(
      { lat: trace[i - 1][0], lng: trace[i - 1][1] },
      { lat: trace[i][0], lng: trace[i][1] },
    );
  const accuracy =
    track.accuracy === null || endAccuracy === null ? null : Math.max(track.accuracy, endAccuracy);
  trip.measured = (trip.measured ?? 0) + 1;
  step.observations.push({
    tripId: trip.id,
    kind: walk.kind,
    placeId:
      walk.from.kind === 'place' ? walk.from.id : walk.to.kind === 'place' ? walk.to.id : null,
    fromStop: walk.from.kind === 'stop' ? walk.from.id : null,
    toStop: walk.to.kind === 'stop' ? walk.to.id : null,
    startedAt: track.startedAt,
    leftAt: track.leftAt,
    endedAt,
    startSource: track.source,
    endSource,
    accuracy,
    pathMetres: Math.round(pathMetres),
    straightMetres: Math.round(straight),
    plannedMinutes: walk.minutes,
    trace,
    flag:
      accuracy !== null && accuracy > IMPRECISE_M
        ? 'imprecise'
        : straight / seconds > FAST_WALK_MS
          ? 'fast'
          : seconds / 60 > walk.minutes * 3 + 5
            ? 'slow'
            : null,
  });
}

function finish(
  trip: ActiveTrip,
  phase: 'completed' | 'canceled' | 'expired',
  at: number,
  source: TripSource,
) {
  trip.phase = phase;
  trip.endedAt = at;
  trip.walk = null;
  record(trip, at, source);
}

function alightKey(trip: ActiveTrip) {
  const version = trip.warningVersions?.[trip.leg] ?? 0;
  return `alight:${trip.leg}${version ? `:${version}` : ''}`;
}

function alightEvent(trip: ActiveTrip, step: TripStep) {
  const ride = trip.rides[trip.leg];
  const ahead = Math.min(WARN_STOPS_AHEAD, ride.stops.length - 1);
  emit(step, {
    key: alightKey(trip),
    kind: 'alight',
    title: ahead === 1 ? 'Bájate en la próxima' : `Bájate en ${ahead} paradas`,
    body: `${stopLabel(ride.stops.at(-1)!)} · línea ${ride.route}.`,
  });
}

function board(
  trip: ActiveTrip,
  step: TripStep,
  evidence: BoardingEvidence,
  at: number,
  source: TripSource,
) {
  trip.phase = 'riding';
  trip.boarded[trip.leg] = evidence;
  trip.boarding = { hits: 0, doubt: null };
  trip.progress = { at: null, atStopSince: null };
  trip.walk = null;
  record(trip, at, source);
  // With too few stops in between, the warning is due from the moment he boards.
  if (trip.rides[trip.leg].stops.length <= WARN_STOPS_AHEAD + 1) alightEvent(trip, step);
}

function alight(
  trip: ActiveTrip,
  step: TripStep,
  at: number,
  source: 'tap' | 'gps',
  accuracy: number | null,
  context: TripLive | null,
) {
  const leg = trip.leg;
  trip.progress = { at: null, atStopSince: null };
  if (leg + 1 < trip.rides.length) {
    const transfer = trip.walks[leg + 1];
    const next = trip.rides[leg + 1];
    trip.leg = leg + 1;
    const due = rideStopAt(trip, next, 0, context, at);
    const when = `El ${next.route} sale a las ${agencyClock(due.at)}${due.live ? '' : ' (horario)'}.`;
    emit(step, {
      key: `transfer:${leg}`,
      kind: 'transfer',
      title: 'Transbordo',
      body:
        transfer.source === 'same'
          ? `Espera el ${next.route} en esta parada. ${when}`
          : `Camina a ${stopLabel(transfer.to)}, unos ${transfer.minutes} min. ${when}`,
    });
    if (transfer.source === 'same') {
      trip.phase = 'waiting';
      trip.walk = null;
      trip.nearStopAt = at;
    } else {
      trip.phase = 'transferring';
      trip.walk = track(at, source, accuracy);
    }
  } else {
    trip.leg = trip.rides.length;
    trip.phase = 'final';
    trip.walk = track(at, source, accuracy);
  }
  trip.boarding = { hits: 0, doubt: null };
  record(trip, at, source);
}

function walking(
  trip: ActiveTrip,
  step: TripStep,
  fix: Fix,
  speed: number | null,
  context: TripLive | null,
) {
  const walk = trip.walks[trip.leg];
  const current = (trip.walk ??= track(fix.at, 'gps', fix.accuracy));
  if (
    trip.phase === 'transferring' &&
    fix.at - current.startedAt <= WAIT_STOP_MS &&
    tookOther(trip, step, fix, speed, context)
  )
    return;
  const hadLeft = current.leftAt !== null;
  remember(current, fix);
  current.accuracy ??= fix.accuracy;
  if (walk.kind === 'access' && walk.from.kind === 'place') {
    const away = distanceMetres(fix, walk.from) - (fix.accuracy ?? 0);
    if (current.trace.length === 1 && current.source === 'tap' && away > START_AWAY_M)
      current.usable = false;
    if (current.usable && current.leftAt === null && away > PLACE_LEFT_M) current.leftAt = fix.at;
  }
  if (walk.to.kind !== 'stop') {
    if (near(fix, walk.to, PLACE_NEAR_M)) {
      if (trip.phase === 'final') observe(trip, step, fix.at, 'gps', fix.accuracy);
      finish(trip, 'completed', fix.at, 'gps');
    }
    return;
  }
  if (near(fix, walk.to, STOP_NEAR_M)) {
    observe(trip, step, fix.at, 'gps', fix.accuracy);
    trip.walk = null;
    trip.phase = 'waiting';
    trip.nearStopAt = fix.at;
    trip.boarding = { hits: 0, doubt: null };
    record(trip, fix.at, 'gps');
    return;
  }
  const ride = trip.rides[trip.leg];
  if (trip.leg === 0 && !hadLeft && fix.at - trip.startedAt <= 3 * 60_000) {
    const first = { lat: current.trace[0][0], lng: current.trace[0][1] };
    const place = locateOnPath(ride.path, fix, null);
    const onRoute =
      place.off <= ON_ROUTE_M + (fix.accuracy ?? 0) && place.at - ride.along[0] >= STOP_NEAR_M;
    const bus = rideBus(trip, ride, context, fix.at);
    const matched = bus !== null && distanceMetres(bus, fix) <= MATCH_BUS_M + (fix.accuracy ?? 0);
    if (
      distanceMetres(first, walk.to) <= STOP_NEAR_M * 4 &&
      onRoute &&
      ((speed !== null && speed >= BUS_SPEED_MS) || matched)
    ) {
      trip.walk = null;
      trip.phase = 'waiting';
      trip.nearStopAt = trip.startedAt;
      trip.boarding = { hits: 0, doubt: null };
      record(trip, fix.at, 'gps');
      waiting(trip, step, fix, speed, context);
      return;
    }
  }
  const due = rideStopAt(trip, ride, 0, context, fix.at);
  const short = fix.at + remainingWalkMs(walk, fix) - due.at;
  if (short > 30_000) {
    const left = Math.max(1, Math.round(remainingWalkMs(walk, fix) / 60_000));
    emit(
      step,
      trip.leg === 0
        ? {
            key: `late:${trip.leg}`,
            kind: 'late',
            title: `Vas justo para el ${ride.route}`,
            body: `Sale de ${stopLabel(ride.stops[0])} a las ${agencyClock(due.at)}${due.live ? '' : ' (horario)'} y te faltan unos ${left} min.`,
          }
        : {
            key: `connection:${trip.leg}`,
            kind: 'connection',
            title: 'El transbordo se complica',
            body: `El ${ride.route} sale a las ${agencyClock(due.at)}${due.live ? '' : ' (horario)'} y te faltan unos ${left} min a ${stopLabel(ride.stops[0])}. Revisa otra opción en Transit.`,
          },
    );
  }
}

function switchRide(trip: ActiveTrip, alternative: TripAlternative) {
  const leg = trip.leg;
  trip.rides = [...trip.rides.slice(0, leg), alternative.ride];
  trip.walks = [...trip.walks.slice(0, leg), alternative.walk, alternative.egress];
  trip.plannedArriveAt = alternative.arriveAt;
  trip.alternatives = undefined;
}

// One of `alternatives` he boarded instead of his bus, which becomes his ride: he moves along its
// street at bus speed, beside its GPS, or once it is due while his own is still minutes away.
function tookOther(
  trip: ActiveTrip,
  step: TripStep,
  fix: Fix,
  speed: number | null,
  context: TripLive | null,
): boolean {
  const options = trip.alternatives?.leg === trip.leg ? trip.alternatives.options : [];
  if (!options.length || speed === null || speed < BUS_SPEED_MS) return false;
  const ride = trip.rides[trip.leg];
  const error = fix.accuracy ?? 0;
  const own = rideBus(trip, ride, context, fix.at);
  const fromOwn = own && distanceMetres(own, fix);
  if (fromOwn !== null && fromOwn <= MATCH_BUS_M + error) return false;
  const ownFits =
    locateOnPath(ride.path, fix, null).off <= ON_ROUTE_M + error &&
    fix.at >= rideStopAt(trip, ride, 0, context, fix.at).at - EARLY_BOARD_MS &&
    (fromOwn === null || fromOwn <= OTHER_BUS_M + error);
  for (const option of options) {
    const place = locateOnPath(option.ride.path, fix, null);
    if (place.off > ON_ROUTE_M + error || place.at - option.ride.along[0] < BOARD_PROGRESS_M)
      continue;
    const bus = rideBus(trip, option.ride, context, fix.at);
    const matched = bus !== null && distanceMetres(bus, fix) <= MATCH_BUS_M + error;
    if (
      !matched &&
      (ownFits ||
        bus !== null ||
        fix.at < rideStopAt(trip, option.ride, 0, context, fix.at).at - EARLY_BOARD_MS)
    )
      continue;
    if (!matched && trip.boarding.hits + 1 < BOARD_HITS) {
      trip.boarding = { hits: trip.boarding.hits + 1, doubt: null };
      return true;
    }
    const boardedAt = trip.phase === 'waiting' ? (trip.nearStopAt ?? fix.at) : fix.at;
    switchRide(trip, option);
    board(trip, step, matched ? 'matched' : 'inferred', boardedAt, 'gps');
    riding(trip, step, fix, speed, context);
    return true;
  }
  return false;
}

function waiting(
  trip: ActiveTrip,
  step: TripStep,
  fix: Fix,
  speed: number | null,
  context: TripLive | null,
) {
  const ride = trip.rides[trip.leg];
  const stop = ride.stops[0];
  const due = rideStopAt(trip, ride, 0, context, fix.at);
  if (near(fix, stop, STOP_NEAR_M)) {
    trip.nearStopAt = fix.at;
    trip.boarding = { hits: 0, doubt: null };
    if (fix.at > due.at + MISSED_MS && trip.boarded[trip.leg] === null)
      emit(step, {
        key: `missed:${trip.leg}`,
        kind: 'missed',
        title: `¿Perdiste el ${ride.route}?`,
        body: `Salía de ${stopLabel(stop)} a las ${agencyClock(due.at)}. Si ya subiste, toca «Ya subí»; si no, busca otra opción en Transit.`,
      });
    return;
  }
  const recent = trip.nearStopAt !== null && fix.at - trip.nearStopAt <= WAIT_STOP_MS;
  if (recent && tookOther(trip, step, fix, speed, context)) return;
  const place = locateOnPath(ride.path, fix, null);
  const onRoute =
    place.off <= ON_ROUTE_M + (fix.accuracy ?? 0) && place.at - ride.along[0] >= BOARD_PROGRESS_M;
  if (!recent || !onRoute) {
    trip.boarding = { hits: 0, doubt: null };
    return;
  }
  if (speed === null || speed < BUS_SPEED_MS) {
    trip.boarding = { hits: 0, doubt: trip.boarding.doubt };
    return;
  }
  const doubt = (kind: 'other-bus' | 'early') => {
    trip.boarding = { hits: 0, doubt: kind };
    emit(step, {
      key: `doubt:${trip.leg}`,
      kind: 'doubt',
      title: `¿Ya vas en el ${ride.route}?`,
      body:
        kind === 'early'
          ? `Te mueves por su ruta antes de que pase tu bus de las ${agencyClock(due.at)}. Si subiste a uno, abre Nexo y toca «Ya subí» para el aviso de bajar.`
          : 'Te mueves por su ruta, pero tu bus está lejos de ti. Si subiste a uno, abre Nexo y toca «Ya subí» para el aviso de bajar.',
    });
  };
  if (fix.at < due.at - EARLY_BOARD_MS) return doubt('early');
  const bus = rideBus(trip, ride, context, fix.at);
  const fromBus = bus && distanceMetres(bus, fix);
  if (fromBus !== null && fromBus <= MATCH_BUS_M + (fix.accuracy ?? 0)) {
    board(trip, step, 'matched', trip.nearStopAt!, 'gps');
    return riding(trip, step, fix, speed, context);
  }
  if (fromBus !== null && fromBus > OTHER_BUS_M) return doubt('other-bus');
  if (trip.boarding.hits + 1 < BOARD_HITS) {
    trip.boarding = { hits: trip.boarding.hits + 1, doubt: null };
    return;
  }
  board(trip, step, 'inferred', trip.nearStopAt!, 'gps');
  riding(trip, step, fix, speed, context);
}

function riding(
  trip: ActiveTrip,
  step: TripStep,
  fix: Fix,
  speed: number | null,
  context: TripLive | null,
) {
  const leg = trip.leg;
  const ride = trip.rides[leg];
  const last = ride.stops.length - 1;
  const target = ride.stops[last];
  const place = locateOnPath(rideTrack(ride), fix, trip.progress.at);
  const onPath = place.off <= ON_ROUTE_M + (fix.accuracy ?? 0);
  if (speed !== null && speed > 1)
    trip.expiresAt = Math.min(
      trip.startedAt + MAX_TRIP_MS,
      Math.max(trip.expiresAt, fix.at + MOVING_GRACE_MS),
    );
  if (trip.boarded[leg] === 'inferred') {
    const bus = rideBus(trip, ride, context, fix.at);
    if (bus && distanceMetres(bus, fix) <= MATCH_BUS_M + (fix.accuracy ?? 0))
      trip.boarded[leg] = 'matched';
  }
  if (onPath) trip.progress.at = Math.max(trip.progress.at ?? place.at, place.at);
  const progress = trip.progress.at;
  const fast = speed !== null && speed >= BUS_SPEED_MS;
  if (progress !== null && progress >= ride.along[Math.max(0, last - WARN_STOPS_AHEAD)] + 20)
    alightEvent(trip, step);
  if (progress !== null && progress >= ride.along[last] + PASSED_M && fast) {
    trip.progress.atStopSince = null;
    emit(step, {
      key: `passed:${leg}`,
      kind: 'passed',
      title: 'Te pasaste de tu parada',
      body: `Bájate en la siguiente y regresa a ${stopLabel(target)}.`,
    });
    return;
  }
  const finalStretch =
    last <= 0 || (progress ?? place.at) >= ride.along[last - 1] - STOP_NEAR_M * 2;
  if (finalStretch && near(fix, target, STOP_NEAR_M)) trip.progress.atStopSince ??= fix.at;
  const since = trip.progress.atStopSince;
  const away = place.off > ALIGHT_OFF_M + (fix.accuracy ?? 0);
  if (since === null) {
    if (leg === trip.rides.length - 1 && near(fix, trip.destination, PLACE_NEAR_M) && !fast) {
      alight(trip, step, fix.at, 'gps', fix.accuracy, context);
      finish(trip, 'completed', fix.at, 'gps');
      return;
    }
    if (
      Math.max(progress ?? 0, place.at) >= ride.along[Math.max(0, last - 1)] &&
      away &&
      !fast &&
      speed !== null &&
      speed < WALK_MAX_MS
    ) {
      alight(trip, step, fix.at, 'gps', fix.accuracy, context);
      if (trip.walk && distanceMetres(fix, target) - (fix.accuracy ?? 0) > START_AWAY_M)
        trip.walk.usable = false;
    }
    return;
  }
  const lingering =
    !fast &&
    (speed === null || speed < WALK_MAX_MS) &&
    fix.at - since >= ALIGHT_DWELL_MS &&
    distanceMetres(fix, target) <= STOP_NEAR_M * 3;
  if (away || lingering) alight(trip, step, since, 'gps', fix.accuracy, context);
}

function resumeRide(trip: ActiveTrip, leg: number, at: number, source: TripSource) {
  trip.leg = leg;
  trip.phase = 'riding';
  trip.walk = null;
  trip.progress = { at: null, atStopSince: null };
  trip.notified = trip.notified.filter(
    (key) => key !== `transfer:${leg}` && key !== `passed:${leg}`,
  );
  record(trip, at, source);
}

// A walk or same-stop wait that began from an inferred alighting, while he keeps going along the
// bus's path at bus speed, was the bus waiting at his stop: he is still on it.
function stillRiding(trip: ActiveTrip, fix: Fix, speed: number | null): boolean {
  const leg = trip.phase === 'final' ? trip.rides.length - 1 : trip.leg - 1;
  const ride = trip.rides[leg];
  const startedAt =
    trip.walk?.source === 'gps'
      ? trip.walk.startedAt
      : trip.phase === 'waiting' &&
          trip.leg > 0 &&
          trip.boarded[trip.leg] === null &&
          trip.log.at(-1)?.source === 'gps'
        ? trip.nearStopAt
        : null;
  if (
    !ride ||
    startedAt === null ||
    fix.at - startedAt > 3 * 60_000 ||
    speed === null ||
    speed < BUS_SPEED_MS
  )
    return false;
  const place = locateOnPath(rideTrack(ride), fix, null);
  return (
    place.off <= ON_ROUTE_M + (fix.accuracy ?? 0) &&
    place.at >= (ride.along.at(-1) ?? 0) + PASSED_M / 2
  );
}

/**
 * Waiting for his last bus, or walking to it, the other buses around him that get him to the end
 * no later. Each is told once; the screen offers to take it and the GPS follows one he boards.
 */
export function refreshAlternatives(
  trip: ActiveTrip,
  context: TripLive | null,
  now: number,
): TripStep {
  const leg = trip.leg;
  const known = trip.alternatives;
  if (
    !context ||
    context.schedule.sourceSha256 !== trip.sourceSha256 ||
    !isActive(trip) ||
    (trip.phase !== 'waiting' && trip.phase !== 'transferring') ||
    leg !== trip.rides.length - 1 ||
    trip.boarded[leg] !== null
  )
    return {
      trip: known ? { ...trip, alternatives: undefined } : trip,
      events: [],
      observations: [],
    };
  const liveAt = context.snapshot?.generatedAt ?? null;
  if (
    known?.leg === leg &&
    now - known.checkedAt < ALTERNATIVES_EVERY_MS &&
    known.liveAt === liveAt
  )
    return { trip, events: [], observations: [] };
  const { schedule, snapshot } = context;
  const ride = trip.rides[leg];
  const own = trip.walks[leg];
  const egress = trip.walks[leg + 1];
  const last = ride.stops[ride.stops.length - 1];
  const boardAt = rideStopAt(trip, ride, 0, context, now).at;
  const arriveAt =
    rideStopAt(trip, ride, ride.stops.length - 1, context, now).at + egress.minutes * 60_000;
  const from = trip.phase === 'waiting' ? ride.stops[0] : (trip.lastFix ?? own.from);
  const kept = egress.source === 'saved' || egress.source === 'learned';
  const search = startPlan(sharedPlannerIndex(schedule), {
    origin: { lat: from.lat, lng: from.lng },
    destination: { lat: trip.destination.lat, lng: trip.destination.lng },
    originWalks: new Map(),
    destinationWalks: new Map(kept ? [[last.id, egress.minutes]] : []),
    stopWalks: [],
    learned: new Set(egress.source === 'learned' ? [`from:${last.id}`] : []),
    accessRadiusM: ALTERNATIVE_REACH_M,
    here: true,
    mode: 'now',
    at: now,
  });
  while (!search.step(1_000));
  const options = liveOptions(search.result(), snapshot, now)
    .filter((option) => {
      const first = option.itinerary.rides[0];
      return (
        option.itinerary.rides.length === 1 &&
        !option.problem &&
        !option.missed &&
        !option.notice &&
        !(first.trip[0] === ride.tripId && first.serviceDate === ride.serviceDate) &&
        option.arriveAt <= arriveAt &&
        (option.live[0].board.at < boardAt || option.arriveAt < arriveAt)
      );
    })
    .slice(0, MAX_ALTERNATIVES)
    .map((option): TripAlternative => {
      const plan = option.itinerary;
      const first = plan.rides[0];
      const stop = stopEnd(schedule, first.departure.stopTime[0]);
      const end = stopEnd(schedule, first.arrival.stopTime[0]);
      return {
        ride: freezeRide(schedule, first, option.live[0]),
        walk:
          stop.id === own.to.id
            ? own
            : {
                kind: own.kind,
                from: own.from,
                to: stop,
                minutes: estimatedWalkMinutes(distanceMetres(own.from, stop)),
                source: 'estimate',
              },
        egress: {
          kind: 'egress',
          from: end,
          to: trip.destination,
          minutes: plan.egress!.minutes,
          source: plan.egress!.source,
          ...(end.id === last.id && egress.path ? { path: egress.path } : {}),
        },
        arriveAt: option.arriveAt,
      };
    });
  const next = editable(trip);
  const step: TripStep = { trip: next, events: [], observations: [] };
  next.alternatives = { leg, checkedAt: now, liveAt, options };
  for (const option of options)
    emit(step, {
      key: `earlier:${leg}:${option.ride.tripId}`,
      kind: 'earlier',
      title: `También te sirve el ${option.ride.route}`,
      body: `Sale de ${stopLabel(option.ride.stops[0])} a las ${agencyClock(option.ride.boardAt)} y llegas a las ${agencyClock(option.arriveAt)}, no más tarde que con el ${ride.route}. Si subes, Nexo lo sigue.`,
    });
  return step;
}

/** He takes one of the other buses for his last ride instead of his own. */
export function takeAlternative(trip: ActiveTrip, tripId: string, at: number): TripStep {
  const option =
    trip.alternatives?.leg === trip.leg
      ? trip.alternatives.options.find((o) => o.ride.tripId === tripId)
      : undefined;
  if (!isActive(trip) || !option) return { trip, events: [], observations: [] };
  const next = editable(trip);
  const moved = option.walk.to.id !== next.walks[next.leg].to.id;
  switchRide(next, option);
  // From the stop he waited at, its stop is a walk away.
  if (moved && next.phase === 'waiting') {
    next.phase = next.leg ? 'transferring' : 'walking';
    next.walk = { ...track(at, 'tap', null), usable: false };
    next.nearStopAt = null;
  }
  record(next, at, 'tap');
  return { trip: next, events: [], observations: [] };
}

export function applyFix(trip: ActiveTrip, fix: Fix, context: TripLive | null): TripStep {
  if (!isActive(trip) || (trip.lastFix && fix.at <= trip.lastFix.at))
    return { trip, events: [], observations: [] };
  const previous = trip.lastFix;
  const next = editable(trip);
  const step: TripStep = { trip: next, events: [], observations: [] };
  next.stats.fixes++;
  next.stats.firstFixAt ??= fix.at;
  next.stats.lastFixAt = fix.at;
  next.lastFix = fix;
  if (fix.at >= next.expiresAt) return expire(next, step, fix.at);
  if (fix.accuracy === null || fix.accuracy > FIX_MAX_ERROR_M) {
    next.stats.ignored++;
    return step;
  }
  const speed =
    fix.speed !== null && fix.speed >= 0
      ? fix.speed
      : previous &&
          previous.accuracy !== null &&
          previous.accuracy <= FIX_MAX_ERROR_M &&
          fix.at - previous.at >= 3_000
        ? distanceMetres(previous, fix) / ((fix.at - previous.at) / 1_000)
        : null;
  if (
    (next.phase === 'transferring' ||
      next.phase === 'final' ||
      (next.phase === 'waiting' && next.leg > 0 && next.boarded[next.leg] === null)) &&
    stillRiding(next, fix, speed)
  ) {
    resumeRide(next, next.phase === 'final' ? next.rides.length - 1 : next.leg - 1, fix.at, 'gps');
  }
  switch (next.phase) {
    case 'walking':
    case 'transferring':
    case 'final':
      walking(next, step, fix, speed, context);
      break;
    case 'waiting':
      waiting(next, step, fix, speed, context);
      break;
    case 'riding':
      riding(next, step, fix, speed, context);
      break;
  }
  return step;
}

function expire(trip: ActiveTrip, step: TripStep, at: number): TripStep {
  finish(trip, 'expired', at, 'clock');
  emit(step, {
    key: 'expired',
    kind: 'expired',
    title: 'Dejé de seguir tu viaje',
    body: 'Pasó la hora prevista de llegada. El GPS del viaje ya está apagado.',
  });
  return step;
}

/** The clock alone can only end a trip that outlived its time. */
export function applyClock(trip: ActiveTrip, now: number): TripStep {
  if (!isActive(trip) || now < trip.expiresAt) return { trip, events: [], observations: [] };
  const next = editable(trip);
  return expire(next, { trip: next, events: [], observations: [] }, now);
}

/** What he says himself, which always outranks what the readings suggest. */
export function applyAction(
  trip: ActiveTrip,
  action: TripAction,
  at: number,
  context: TripLive | null = null,
): TripStep {
  if (!isActive(trip)) return { trip, events: [], observations: [] };
  const next = editable(trip);
  const step: TripStep = { trip: next, events: [], observations: [] };
  const phase = next.phase;
  const leg = next.leg;
  switch (action) {
    case 'boarded':
      if (!['walking', 'waiting', 'transferring'].includes(phase) || leg >= next.rides.length)
        break;
      observe(next, step, at, 'tap', null);
      board(next, step, 'manual', at, 'tap');
      break;
    case 'not-boarded':
      if (phase !== 'riding') break;
      next.phase = 'waiting';
      next.boarded[leg] = null;
      next.nearStopAt = null;
      next.progress = { at: null, atStopSince: null };
      // A dismissed native warning is still consumed; a corrected boarding needs its own ID.
      next.warningVersions = [...(next.warningVersions ?? next.rides.map(() => 0))];
      next.warningVersions[leg]++;
      record(next, at, 'tap');
      break;
    case 'alighted':
      if (phase !== 'riding') break;
      alight(next, step, at, 'tap', null, context);
      break;
    case 'still-riding': {
      const previous = phase === 'final' ? next.rides.length - 1 : leg - 1;
      if (!['transferring', 'final', 'waiting'].includes(phase) || previous < 0) break;
      if (phase === 'waiting' && next.boarded[leg] !== null) break;
      resumeRide(next, previous, at, 'tap');
      break;
    }
    case 'arrived':
      if (phase === 'final') observe(next, step, at, 'tap', null);
      finish(next, 'completed', at, 'tap');
      break;
    case 'finish':
      finish(next, 'completed', at, 'tap');
      break;
    case 'cancel':
      finish(next, 'canceled', at, 'tap');
      break;
  }
  return step;
}

/** Notifications the phone should hold for a time, in case no reading arrives to send them. */
export type TripAlarm = { key: string; at: number; title: string; body: string };

/** A held warning gives the GPS's own, for passing the stop that starts it, this long first. */
export const ALARM_AFTER_MS = 60_000;

export function tripAlarms(trip: ActiveTrip, context: TripLive | null, now: number): TripAlarm[] {
  if (!isActive(trip)) return [];
  const alarms: TripAlarm[] = [];
  const ride = trip.rides[trip.leg];
  const last = ride ? ride.stops.length - 1 : 0;
  // With few stops the warning goes out as he boards; there is nothing to hold.
  if (
    trip.phase === 'riding' &&
    last > WARN_STOPS_AHEAD &&
    !trip.notified.includes(alightKey(trip))
  ) {
    let boardedAt = now;
    for (const entry of trip.log) if (entry.phase === 'riding') boardedAt = entry.at;
    const from = last - WARN_STOPS_AHEAD;
    const predicted = rideStopAt(trip, ride, from, context, now);
    const at =
      (predicted.live
        ? predicted.at
        : ride.stops[from].arrival + Math.max(0, boardedAt - ride.stops[0].departure)) +
      ALARM_AFTER_MS;
    if (at > now)
      alarms.push({
        key: alightKey(trip),
        at,
        title: `Bájate en ${WARN_STOPS_AHEAD} paradas`,
        body: `Tu parada es ${stopLabel(ride.stops[last])}, línea ${ride.route}. Calculado con la hora ${predicted.live ? 'predicha por LTC' : 'del horario'}, sin el GPS.`,
      });
  }
  alarms.push({
    key: 'expiry',
    at: trip.expiresAt + 2 * 60_000,
    title: 'Tu viaje sigue abierto',
    body: 'Pasó la hora prevista de llegada. Abre Nexo para terminarlo; así se apaga el GPS.',
  });
  return alarms;
}

/** The stops, buses and lines of the rides still ahead, for the live service. */
export function tripLiveSelection(
  trip: ActiveTrip | null,
  today: IsoDate,
): { stopIds: string[]; trips: { tripId: string; serviceDate: IsoDate }[]; routeIds: string[] } {
  const selection = {
    stopIds: [] as string[],
    trips: [] as { tripId: string; serviceDate: IsoDate }[],
    routeIds: [] as string[],
  };
  if (!trip || !isActive(trip)) return selection;
  const others =
    trip.alternatives?.leg === trip.leg ? trip.alternatives.options.map((o) => o.ride) : [];
  for (const ride of [...trip.rides.slice(trip.leg), ...others]) {
    // The service only answers for trips from two days back to tomorrow.
    if (ride.serviceDate < addDays(today, -2) || ride.serviceDate > addDays(today, 1)) continue;
    const stops = [ride.stops[0].id, ride.stops.at(-1)!.id].filter(
      (id) => !selection.stopIds.includes(id),
    );
    const route = selection.routeIds.includes(ride.routeId) ? 0 : 1;
    // What one live query may name; his own rides come first.
    if (
      selection.trips.length >= LIVE_TRIPS_MAX ||
      selection.stopIds.length + stops.length > LIVE_STOPS_MAX ||
      selection.routeIds.length + route > LIVE_ROUTES_MAX
    )
      continue;
    selection.stopIds.push(...stops);
    selection.trips.push({ tripId: ride.tripId, serviceDate: ride.serviceDate });
    if (route) selection.routeIds.push(ride.routeId);
  }
  return selection;
}
