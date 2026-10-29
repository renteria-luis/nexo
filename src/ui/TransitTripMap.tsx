import { memo, useMemo, useState } from 'react';
import { View } from 'react-native';

import type { Coordinates } from '../core/geo.ts';
import { departureOf, type ActiveTrip, type TripLive } from '../transit/active-trip.ts';
import { tripLayers } from '../transit/map.ts';
import { tripLiveDetail } from '../transit/realtime.ts';
import type { Place } from '../transit/store.ts';
import { Button } from './Button.tsx';
import { TransitMap } from './TransitMap';
import { followedMarker } from './TransitLiveMap.tsx';
import { routeColor } from './routeColors.ts';
import { sheet } from './theme.ts';

const none = () => undefined;

/**
 * The trip in progress and nothing else: its buses in their line's colours with a dot per stop,
 * the walks, his bus and where he is. Drawn from the frozen trip, so it lasts until the trip ends.
 */
export const TransitTripMap = memo(function TransitTripMap({
  trip,
  live,
  now,
  places,
  focusKey = null,
  onInteraction,
}: {
  trip: ActiveTrip;
  live: TripLive | null;
  now: number;
  places: Place[];
  focusKey?: number | null;
  onInteraction?: (active: boolean) => void;
}) {
  // A stop closing does not need the second.
  const minute = Math.floor(now / 60_000) * 60_000;
  const layers = useMemo(() => tripLayers(trip, live, minute), [trip, live, minute]);
  const paths = useMemo(
    () =>
      layers.paths.map((path) => ({
        ...path,
        color: path.dashed ? path.color : routeColor(path.color),
      })),
    [layers],
  );
  const ride = trip.rides[trip.leg];
  const departure = useMemo(
    () => (live && ride ? departureOf(trip, ride, 0, live.schedule) : null),
    [trip, ride, live],
  );
  const bus = useMemo(
    () =>
      followedMarker(
        live && departure ? tripLiveDetail(live.schedule, departure, live.snapshot, now) : null,
        departure,
      ),
    [live, departure, now],
  );
  const ends = useMemo(
    () => places.filter((p) => p.id === trip.origin.id || p.id === trip.destination.id),
    [places, trip.origin.id, trip.destination.id],
  );
  // Where he left from or a point he chose, which are not saved places.
  const points = useMemo(
    () =>
      (
        [
          ['origin', trip.origin],
          ['target', trip.destination],
        ] as const
      )
        .filter(([, end]) => end.kind === 'point')
        .map(([kind, end]) => ({ kind, label: end.name, lat: end.lat, lng: end.lng })),
    [trip.origin, trip.destination],
  );
  const [fits, setFits] = useState(0);
  const viewport = useMemo(
    () => ({
      key: `${trip.id}:${fits}`,
      points: [trip.origin, trip.destination, ...paths.flatMap((path) => path.points)],
    }),
    [trip.id, trip.origin, trip.destination, paths, fits],
  );
  const [focus, setFocus] = useState<{ key: number; point: Coordinates } | null>(null);
  const [seenBusKey, setSeenBusKey] = useState<number | null>(null);
  if (focusKey !== null && focusKey !== seenBusKey) {
    setSeenBusKey(focusKey);
    if (bus) setFocus({ key: focusKey, point: { lat: bus.lat, lng: bus.lng } });
  }
  const fix = trip.lastFix;
  return (
    <View style={styles.block}>
      <TransitMap
        center={trip.origin}
        places={ends}
        stops={[]}
        selectedPlace={null}
        selectedPlaces={ends.map((p) => p.id)}
        selectedStop={null}
        draft={null}
        viewport={viewport}
        focus={focus}
        journeyPaths={paths}
        stopDots={layers.dots}
        followed={bus}
        ends={points}
        location={fix}
        showsUserLocation
        onPlace={none}
        onStop={none}
        onInteraction={onInteraction}
      />
      <Button label="Todo el viaje" variant="ghost" block onPress={() => setFits((n) => n + 1)} />
      <View style={styles.row}>
        {fix && (
          <Button
            label="Dónde estoy"
            variant="ghost"
            onPress={() => setFocus({ key: Date.now(), point: fix })}
          />
        )}
        {bus && (
          <Button
            label="Mi bus"
            variant="ghost"
            onPress={() => setFocus({ key: Date.now(), point: bus })}
          />
        )}
      </View>
    </View>
  );
});

const styles = sheet((theme) => ({
  block: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
}));
