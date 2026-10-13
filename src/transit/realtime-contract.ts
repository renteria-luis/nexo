export const REALTIME_SCHEMA = 1;
export const REALTIME_FRESH_MS = 90_000;
export const REALTIME_ALERT_FRESH_MS = 600_000;
export const REALTIME_CACHE_MS = 30_000;
export const REALTIME_MAX_RESPONSE_BYTES = 250_000;

export type LiveTripRef = { tripId: string; serviceDate: string };

export type RealtimeQuery = {
  schema: 1;
  /** Older apps reject calendar exceptions, so the service sends them only on opt-in. */
  includeReportedTrips?: true;
  staticVersion: string;
  staticSourceSha256: string;
  stopIds: string[];
  trips: LiveTripRef[];
  routeIds: string[];
};

export type RealtimeSource = 'trips' | 'vehicles' | 'alerts';
export type RealtimeHealth = {
  status: 'ok' | 'stale' | 'error';
  feedTimestamp: number | null;
  fetchedAt: number | null;
  error: string | null;
};

export type LiveIdentity = LiveTripRef & {
  /** An explicitly dated, assigned LTC report contradicts the static service calendar. */
  calendarException?: true;
  routeId: string;
  directionId: number | null;
  startTime: string | null;
};

export type LiveEvent = {
  time: number | null;
  delay: number | null;
  uncertainty: number | null;
};

export type LiveStopUpdate = {
  stopId: string;
  stopSequence: number;
  relationship: 'scheduled' | 'skipped' | 'no_data' | 'unsupported';
  arrival: LiveEvent | null;
  departure: LiveEvent | null;
};

export type LiveTripUpdate = LiveIdentity & {
  entityId: string;
  vehicleId: string | null;
  measuredAt: number | null;
  relationship: 'scheduled' | 'canceled' | 'unsupported';
  delay: number | null;
  stops: LiveStopUpdate[];
};

export type LiveVehicle = LiveIdentity & {
  entityId: string;
  vehicleId: string | null;
  measuredAt: number | null;
  stopId: string | null;
  stopSequence: number | null;
  status: 'incoming' | 'stopped' | 'in_transit' | null;
  position: { lat: number; lng: number; bearing: number | null; speed: number | null } | null;
};

export type LiveAlertSelector = {
  routeId: string | null;
  stopId: string | null;
  tripId: string | null;
  serviceDate: string | null;
  directionId: number | null;
};

export type LiveAlert = {
  id: string;
  activePeriods: { start: number | null; end: number | null }[];
  selectors: LiveAlertSelector[];
  cause: number | null;
  effect: number | null;
  header: string;
  description: string;
  url: string | null;
};

export type RealtimeResponse = {
  schema: 1;
  generatedAt: number;
  staticVersion: string;
  staticSourceSha256: string;
  staticCompatible: boolean;
  health: Record<RealtimeSource, RealtimeHealth>;
  tripUpdates: LiveTripUpdate[];
  vehicles: LiveVehicle[];
  alerts: LiveAlert[];
  issues: {
    unmatchedTrips: number;
    ambiguousStops: number;
    invalidEntities: number;
    truncated: boolean;
  };
};
