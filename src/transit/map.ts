import type { Coordinates } from '../core/geo.ts';
import type { Itinerary, Ride, Walk } from './planner.ts';
import { pathStops } from './realtime.ts';
import type { Schedule } from './schedule.ts';
import type { Place, StopWalk, WalkLink } from './store.ts';
import { parsePath } from './walks.ts';

export type JourneyPath = { id: string; points: Coordinates[]; color: string; dashed: boolean };

/** Only the part actually ridden, following the ordered GTFS shape through loops. */
export function ridePath(schedule: Schedule, ride: Ride): Coordinates[] {
  const path = pathStops(schedule, ride.trip);
  if (!path)
    return schedule.patterns[ride.trip[6]].slice(ride.board, ride.alight + 1).map(([i]) => ({
      lat: schedule.stops[i][3],
      lng: schedule.stops[i][4],
    }));
  const start = path.stops[ride.board];
  const end = path.stops[ride.alight];
  const pointAt = (at: number): Coordinates => {
    let k = 0;
    while (k < path.along.length - 2 && path.along[k + 1] < at) k++;
    const span = path.along[k + 1] - path.along[k];
    const f = span > 0 ? Math.max(0, Math.min(1, (at - path.along[k]) / span)) : 0;
    return {
      lat: path.points[k].lat + f * (path.points[k + 1].lat - path.points[k].lat),
      lng: path.points[k].lng + f * (path.points[k + 1].lng - path.points[k].lng),
    };
  };
  return [
    pointAt(start),
    ...path.points.filter((_, i) => path.along[i] > start && path.along[i] < end),
    pointAt(end),
  ];
}

export function itineraryPaths(
  schedule: Schedule,
  plan: Itinerary,
  origin: Place,
  target: Place,
  links: WalkLink[],
  transfers: StopWalk[],
): JourneyPath[] {
  const stopPoint = (index: number): Coordinates => ({
    lat: schedule.stops[index][3],
    lng: schedule.stops[index][4],
  });
  const paths: JourneyPath[] = plan.rides.map((ride, i) => ({
    id: `ride-${i}`,
    points: ridePath(schedule, ride),
    color: ride.route[3],
    dashed: false,
  }));
  const addWalk = (id: string, walk: Walk | null) => {
    if (!walk) return;
    const from = walk.from === null ? origin : stopPoint(walk.from);
    const to = walk.to === null ? target : stopPoint(walk.to);
    let encoded: string | undefined;
    if (walk.from === null && walk.to !== null)
      encoded = links.find(
        (link) =>
          link.place_id === origin.id &&
          link.stop_id === schedule.stops[walk.to!][0] &&
          link.direction === 'to_stop',
      )?.path;
    else if (walk.to === null && walk.from !== null)
      encoded = links.find(
        (link) =>
          link.place_id === target.id &&
          link.stop_id === schedule.stops[walk.from!][0] &&
          link.direction === 'from_stop',
      )?.path;
    else if (walk.from !== null && walk.to !== null)
      encoded = transfers.find(
        (link) =>
          link.from_stop === schedule.stops[walk.from!][0] &&
          link.to_stop === schedule.stops[walk.to!][0],
      )?.path;
    let saved: Coordinates[] = [];
    try {
      if (encoded) saved = parsePath(encoded);
    } catch {
      /* A corrupt personal path still has known endpoints. */
    }
    paths.push({ id, points: [from, ...saved, to], color: '#121212', dashed: true });
  };
  addWalk('access', plan.access);
  addWalk('transfer', plan.transfer);
  addWalk('egress', plan.egress);
  return paths;
}

export function mapRegion(points: Coordinates[]) {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const lowLat = Math.min(...lats),
    highLat = Math.max(...lats);
  const lowLng = Math.min(...lngs),
    highLng = Math.max(...lngs);
  return {
    center: { lat: (lowLat + highLat) / 2, lng: (lowLng + highLng) / 2 },
    latDelta: Math.max(0.006, (highLat - lowLat) * 1.5),
    lngDelta: Math.max(0.008, (highLng - lowLng) * 1.5),
  };
}
