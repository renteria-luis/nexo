import type { Coordinates } from '../core/geo.ts';
import type { Place, Stop } from '../transit/index.ts';

export type ReportedBus = Coordinates & {
  id: string;
  label: string;
  measuredAt: number | null;
  freshnessAt?: number | null;
  stale: boolean;
};

export type TransitMapProps = {
  center: Coordinates;
  places: Place[];
  stops: Stop[];
  selectedPlace: string | null;
  selectedStop: string | null;
  draft: Coordinates | null;
  buses?: ReportedBus[];
  routePoints?: Coordinates[];
  onPlace: (id: string) => void;
  onStop: (id: string) => void;
  onPoint?: (point: Coordinates) => void;
  onInteraction?: (active: boolean) => void;
};
