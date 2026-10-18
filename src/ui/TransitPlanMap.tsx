import { useMemo, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import type { Coordinates } from '../core/geo.ts';
import { itineraryPaths } from '../transit/map.ts';
import type { PlanOption } from '../transit/planner.ts';
import type { LiveSnapshot } from '../transit/realtime.ts';
import type { Departure, Schedule } from '../transit/schedule.ts';
import type { Place, StopWalk, WalkLink } from '../transit/store.ts';
import { TransitLiveMap } from './TransitLiveMap.tsx';
import type { TransitMapProps } from './TransitMap.types.ts';
import { routeColor } from './routeColors.ts';
import { font, sheet } from './theme.ts';

/** An end of the trip on the map: a saved place, or where he is or a point he chose. */
export type MapEnd = Coordinates & { id: string; name: string; saved: boolean };

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
  line = null,
  choices,
  onChoice,
  pointFocus,
  onPoint,
  popup,
  onInteraction,
}: {
  schedule: Schedule;
  places: Place[];
  origin?: MapEnd;
  target?: MapEnd;
  option: PlanOption | null;
  links: WalkLink[];
  transfers: StopWalk[];
  snapshot: LiveSnapshot | null;
  active: boolean;
  focus: { departure: Departure; at: number } | null;
  /** A line opened from a stop: its whole route and its bus. */
  line?: Departure | null;
  choices?: TransitMapProps['choices'];
  onChoice?: (id: string) => void;
  pointFocus?: TransitMapProps['focus'];
  /** Choosing a point on the map for one end of the trip. */
  onPoint?: (point: Coordinates) => void;
  /** Drawn over the bottom of the map. */
  popup?: ReactNode;
  onInteraction?: (active: boolean) => void;
}) {
  const paths = useMemo(
    () =>
      origin && target && option
        ? itineraryPaths(schedule, option.itinerary, origin, target, links, transfers).map(
            (path) => ({ ...path, color: path.dashed ? path.color : routeColor(path.color) }),
          )
        : [],
    [schedule, origin, target, option, links, transfers],
  );
  const lineShape = line?.trip[5];
  const routePoints = useMemo(
    () => (lineShape ? (schedule.shapes[lineShape] ?? []).map(([lat, lng]) => ({ lat, lng })) : []),
    [schedule, lineShape],
  );
  const endpoints = [origin, target].filter((end): end is MapEnd => !!end);
  const saved = [...new Set(endpoints.filter((end) => end.saved).map((end) => end.id))];
  const ends = useMemo(
    () =>
      [
        origin && !origin.saved && { ...origin, kind: 'origin' as const, label: origin.name },
        target && !target.saved && { ...target, kind: 'target' as const, label: target.name },
      ].filter((end) => !!end),
    [origin, target],
  );
  const choosingStop = !option && !line && !!choices?.length;
  const points = choosingStop
    ? [...(origin ? [origin] : []), ...choices]
    : [...endpoints, ...(choices ?? []), ...paths.flatMap((path) => path.points), ...routePoints];
  const viewport = { key: JSON.stringify(points.map((p) => [p.lat, p.lng])), points };
  return (
    <>
      <View>
        <TransitLiveMap
          schedule={schedule}
          snapshot={snapshot}
          active={active}
          center={origin ?? target ?? { lat: 43, lng: -81.24 }}
          places={places}
          selectedPlace={null}
          selectedPlaces={saved}
          tripPlaceIds={saved}
          layers={false}
          selectedStop={null}
          draft={null}
          viewport={viewport}
          journeyPaths={paths}
          routePoints={routePoints}
          routeColor={line ? routeColor(line.route[3]) : undefined}
          ends={ends}
          choices={choices}
          onChoice={onChoice}
          followed={focus?.departure ?? line ?? option?.itinerary.rides[0]?.departure ?? null}
          focusKey={focus?.at ?? null}
          pointFocus={pointFocus}
          onPlace={() => undefined}
          onStop={() => undefined}
          onPoint={onPoint}
          onInteraction={onInteraction}
        />
        {popup && <View style={styles.popup}>{popup}</View>}
      </View>
      {!!choices?.length && (
        <Text style={styles.note}>
          1, 2 y 3: los paraderos que te llevan, del que más te conviene al que menos. Gris con ×:
          cerrado por ahora.{ends.length ? ' Negro: tu ubicación o el punto que elegiste.' : ''}
        </Text>
      )}
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
  popup: { position: 'absolute', left: 8, right: 8, bottom: 8 },
}));
