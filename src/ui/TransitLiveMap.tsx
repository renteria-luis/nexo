import { memo, useMemo, useState } from 'react';

import { liveFreshness, tripLiveDetail, type LiveSnapshot } from '../transit/realtime.ts';
import type { Departure, Schedule } from '../transit/schedule.ts';
import { TransitMap } from './TransitMap';
import { useLiveClock } from './TransitDepartures.tsx';
import { categoryKey, placeCategories } from '../transit/place-categories.ts';
import { stopsForRoutes, type LayerSelection } from '../transit/map-layers.ts';
import { TransitMapFilters } from './TransitMapFilters.tsx';
import type { FollowedMarker, ReportedBus, TransitMapProps } from './TransitMap.types.ts';

/** The bus he follows where its trip card places it, and what places it there. */
export function followedMarker(
  detail: ReturnType<typeof tripLiveDetail> | null,
  followed: Departure | null,
): FollowedMarker | null {
  const bus = detail?.bus;
  if (!bus || !detail || !followed) return null;
  const name = bus.vehicle?.vehicleId ?? detail.update?.vehicleId ?? 'LTC';
  const what =
    bus.why === 'other-trip'
      ? 'en su viaje anterior'
      : bus.placedBy === 'gps'
        ? 'GPS'
        : bus.placedBy === 'last-gps'
          ? 'último GPS'
          : 'estimado';
  return {
    lat: bus.point.lat,
    lng: bus.point.lng,
    label: `Bus ${name} · ${followed.route[1]} → ${followed.trip[3]} · ${what}`,
    tag: `${name} · ${what}`,
    placedBy: bus.placedBy,
    measuredAt: bus.vehicle?.measuredAt ?? null,
  };
}

/**
 * The map with LTC's buses. The bus of the trip he follows comes from the same evidence its trip
 * card uses, so the line and the map show the same bus at the same point; the rest are drawn as
 * reported. It keeps its own clock, so the screen around it does not redraw every quarter minute.
 */
export const TransitLiveMap = memo(function TransitLiveMap({
  schedule,
  snapshot,
  active,
  followed,
  focusKey,
  pointFocus,
  tripPlaceIds = [],
  layers = true,
  ...map
}: Omit<TransitMapProps, 'buses' | 'followed' | 'focus' | 'stops'> & {
  schedule: Schedule;
  snapshot: LiveSnapshot | null;
  active: boolean;
  followed: Departure | null;
  /** Changes on each tap on the followed bus, to bring the camera to it. */
  focusKey: number | null;
  pointFocus?: TransitMapProps['focus'];
  /** The planner's endpoints; the explorer keeps its own independent selected place. */
  tripPlaceIds?: string[];
  /** False draws only the trip's places and bus, with no stops, other buses or filters. */
  layers?: boolean;
}) {
  const [selectedRoutes, setSelectedRoutes] = useState<LayerSelection>(null);
  const [selectedCategories, setSelectedCategories] = useState<LayerSelection>(null);
  const [tripOnly, setTripOnly] = useState(false);
  const routes = useMemo(
    () => [...schedule.routes].sort((a, b) => a[1].localeCompare(b[1], 'es', { numeric: true })),
    [schedule],
  );
  const categories = useMemo(() => {
    const groups = placeCategories(map.places);
    if (map.places.some((place) => !categoryKey(place.category)))
      groups.push({ id: '', label: 'Sin categoría' });
    return groups;
  }, [map.places]);
  const stops = useMemo(
    () => (layers ? stopsForRoutes(schedule, selectedRoutes) : []),
    [layers, schedule, selectedRoutes],
  );
  const places = map.places.filter((place) =>
    tripOnly || !layers
      ? tripPlaceIds.includes(place.id)
      : selectedCategories === null || selectedCategories.has(categoryKey(place.category)),
  );
  const now = useLiveClock(active, snapshot);
  const detail = useMemo(
    () => (followed ? tripLiveDetail(schedule, followed, snapshot, now) : null),
    [schedule, followed, snapshot, now],
  );
  const trips = useMemo(() => new Map(schedule.trips.map((t) => [t[0], t])), [schedule]);
  const bus = detail?.bus ?? null;
  const buses = useMemo<ReportedBus[]>(() => {
    if (!layers || !snapshot?.staticCompatible) return [];
    return snapshot.vehicles.flatMap((vehicle) => {
      const trip = trips.get(vehicle.tripId);
      if (!vehicle.position || !trip || vehicle === bus?.vehicle) return [];
      return [
        {
          id: `${vehicle.entityId}-${vehicle.tripId}-${vehicle.serviceDate}`,
          label: `Bus ${vehicle.vehicleId ?? 'LTC'} · ${schedule.routes[trip[1]][1]} → ${trip[3]}`,
          lat: vehicle.position.lat,
          lng: vehicle.position.lng,
          measuredAt: vehicle.measuredAt,
          stale: !liveFreshness(snapshot, 'vehicles', vehicle.measuredAt, now),
        },
      ];
    });
  }, [layers, snapshot, schedule, trips, bus, now]);
  const marker = useMemo(() => followedMarker(detail, followed), [detail, followed]);
  // The point as it is at the tap; the camera then stays where he leaves it.
  const [focus, setFocus] = useState<TransitMapProps['focus']>(null);
  if (focusKey !== null && focusKey !== focus?.key && marker)
    setFocus({ key: focusKey, point: { lat: marker.lat, lng: marker.lng } });
  const selectedFocus =
    pointFocus && pointFocus.key > (focus?.key ?? -Infinity) ? pointFocus : focus;
  return (
    <>
      {layers && (
        <TransitMapFilters
          routes={routes}
          categories={categories}
          selectedRoutes={selectedRoutes}
          selectedCategories={selectedCategories}
          tripOnly={tripOnly}
          onRoutes={setSelectedRoutes}
          onCategories={setSelectedCategories}
          onTripOnly={setTripOnly}
        />
      )}
      <TransitMap
        {...map}
        places={places}
        stops={stops}
        buses={buses}
        followed={marker}
        focus={selectedFocus}
      />
    </>
  );
});
