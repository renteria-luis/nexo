import type { Coordinates } from '../core/geo.ts';
import type { Place, Stop } from '../transit/index.ts';
import type { MapNote } from '../transit/store.ts';
import type { JourneyPath, StopDot } from '../transit/map.ts';

export type ReportedBus = Coordinates & {
  id: string;
  label: string;
  measuredAt: number | null;
  stale: boolean;
};

/** The bus of the trip he follows, drawn apart from the rest. */
export type FollowedMarker = Coordinates & {
  label: string;
  /** Short text under the marker: the bus number and what places it. */
  tag: string;
  placedBy: 'gps' | 'last-gps' | 'estimate';
  measuredAt: number | null;
};

export type TransitMapProps = {
  center: Coordinates;
  places: Place[];
  stops: Stop[];
  selectedPlace: string | null;
  selectedPlaces?: string[];
  selectedStop: string | null;
  draft: Coordinates | null;
  buses?: ReportedBus[];
  followed?: FollowedMarker | null;
  /** Moves the camera there once; a new key moves it again, even to the same point. */
  focus?: { key: number; point: Coordinates } | null;
  /** Fit endpoints or an itinerary once per selection, leaving later pans alone. */
  viewport?: { key: string; points: Coordinates[] };
  journeyPaths?: JourneyPath[];
  /** The stops of the buses he takes, as dots on their lines. */
  stopDots?: StopDot[];
  routePoints?: Coordinates[];
  /** The selected trip's line colour, already deepened for the screen. */
  routeColor?: string;
  walkPaths?: { id: string; points: Coordinates[]; drawing?: boolean }[];
  notes?: MapNote[];
  location?: (Coordinates & { at: number; accuracy: number | null }) | null;
  /** The phone's own live dot, in place of `location`, where the map can draw it. */
  showsUserLocation?: boolean;
  onNote?: (id: string) => void;
  onPlace: (id: string) => void;
  onStop: (id: string) => void;
  onPoint?: (point: Coordinates) => void;
  onInteraction?: (active: boolean) => void;
};
