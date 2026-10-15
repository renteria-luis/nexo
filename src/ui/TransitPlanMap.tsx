import { useMemo, useState } from 'react';
import { Text } from 'react-native';
import { itineraryPaths } from '../transit/map.ts';
import type { PlanOption } from '../transit/planner.ts';
import type { LiveSnapshot } from '../transit/realtime.ts';
import type { Departure, Schedule } from '../transit/schedule.ts';
import type { Place, StopWalk, WalkLink } from '../transit/store.ts';
import { TransitLiveMap } from './TransitLiveMap.tsx';
import { routeColor } from './routeColors.ts';
import { font, sheet } from './theme.ts';

export function TransitPlanMap({
  schedule,
  places,
  origin,
  target,
  option,
  links,
  transfers,
  snapshot,
  active,
  focus,
  onInteraction,
}: {
  schedule: Schedule;
  places: Place[];
  origin?: Place;
  target?: Place;
  option: PlanOption | null;
  links: WalkLink[];
  transfers: StopWalk[];
  snapshot: LiveSnapshot | null;
  active: boolean;
  focus: { departure: Departure; at: number } | null;
  onInteraction?: (active: boolean) => void;
}) {
  const [selectedStop, setSelectedStop] = useState<string | null>(null);
  const paths = useMemo(
    () =>
      origin && target && option
        ? itineraryPaths(schedule, option.itinerary, origin, target, links, transfers).map(
            (path) => ({ ...path, color: path.dashed ? path.color : routeColor(path.color) }),
          )
        : [],
    [schedule, origin, target, option, links, transfers],
  );
  const endpoints = [
    ...new Map([origin, target].filter((p): p is Place => !!p).map((p) => [p.id, p])).values(),
  ];
  const points = [...endpoints, ...paths.flatMap((path) => path.points)];
  const viewport = { key: JSON.stringify(points.map((p) => [p.lat, p.lng])), points };
  return (
    <>
      <TransitLiveMap
        schedule={schedule}
        snapshot={snapshot}
        active={active}
        center={origin ?? target ?? { lat: 43, lng: -81.24 }}
        places={places}
        selectedPlace={null}
        selectedPlaces={endpoints.map((p) => p.id)}
        tripPlaceIds={endpoints.map((p) => p.id)}
        selectedStop={selectedStop}
        draft={null}
        viewport={viewport}
        journeyPaths={paths}
        followed={focus?.departure ?? option?.itinerary.rides[0]?.departure ?? null}
        focusKey={focus?.at ?? null}
        onPlace={() => undefined}
        onStop={setSelectedStop}
        onInteraction={onInteraction}
      />
      {paths.length > 0 && (
        <Text style={styles.note}>
          Bus: línea de su color. Caminata: negro punteado; aproximada si no has guardado el camino.
        </Text>
      )}
    </>
  );
}

const styles = sheet((theme) => ({
  note: { fontFamily: font.regular, fontSize: 12, color: theme.textFaint },
}));
