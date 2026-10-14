import { memo, useMemo, useState } from 'react';

import { liveFreshness, tripLiveDetail, type LiveSnapshot } from '../transit/realtime.ts';
import type { Departure, Schedule } from '../transit/schedule.ts';
import { TransitMap } from './TransitMap';
import { useLiveClock } from './TransitDepartures.tsx';
import type { FollowedMarker, ReportedBus, TransitMapProps } from './TransitMap.types.ts';

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
  ...map
}: Omit<TransitMapProps, 'buses' | 'followed' | 'focus'> & {
  schedule: Schedule;
  snapshot: LiveSnapshot | null;
  active: boolean;
  followed: Departure | null;
  /** Changes on each tap on the followed bus, to bring the camera to it. */
  focusKey: number | null;
  pointFocus?: TransitMapProps['focus'];
}) {
  const now = useLiveClock(active, snapshot);
  const detail = useMemo(
    () => (followed ? tripLiveDetail(schedule, followed, snapshot, now) : null),
    [schedule, followed, snapshot, now],
  );
  const trips = useMemo(() => new Map(schedule.trips.map((t) => [t[0], t])), [schedule]);
  const bus = detail?.bus ?? null;
  const buses = useMemo<ReportedBus[]>(() => {
    if (!snapshot?.staticCompatible) return [];
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
  }, [snapshot, schedule, trips, bus, now]);
  const marker = useMemo<FollowedMarker | null>(() => {
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
  }, [bus, detail, followed]);
  // The point as it is at the tap; the camera then stays where he leaves it.
  const [focus, setFocus] = useState<TransitMapProps['focus']>(null);
  if (focusKey !== null && focusKey !== focus?.key && marker)
    setFocus({ key: focusKey, point: { lat: marker.lat, lng: marker.lng } });
  const selectedFocus =
    pointFocus && pointFocus.key > (focus?.key ?? -Infinity) ? pointFocus : focus;
  return <TransitMap {...map} buses={buses} followed={marker} focus={selectedFocus} />;
});
