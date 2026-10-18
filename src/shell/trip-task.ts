// The trip tracker wired to the phone. Imported first in index.ts: iOS can hand over readings
// before any screen mounts, and expo drops a location task that is not defined by then.
//
// Location is asked "while using the app" only. Updates started from the screen keep arriving
// with the screen locked, under iOS's blue location indicator. A force-quit stops delivery;
// this does not request "Always" permission or promise to relaunch a closed app.

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';

import { openDatabase } from '../db/index.ts';
import type { Fix } from '../transit/active-trip.ts';
import { readJourneyState } from '../transit/journey-store.ts';
import { buildLiveQuery, fetchLiveSnapshot, type TransitLiveConfig } from '../transit/realtime.ts';
import { presentTripEvents, syncTripAlarms } from './notifications.ts';
import { loadTransitLiveConfig } from './transit-live.ts';
import { createTripTracker, type TrackingMode } from './trip-tracker.ts';

export const TRIP_LOCATION_TASK = 'nexo-transit-trip';

const toFix = (location: Location.LocationObject): Fix => ({
  lat: location.coords.latitude,
  lng: location.coords.longitude,
  accuracy: location.coords.accuracy ?? null,
  speed:
    location.coords.speed !== null && location.coords.speed >= 0 ? location.coords.speed : null,
  // iOS stamps a reading with a fraction of a millisecond, which the INTEGER columns refuse.
  at: Math.round(location.timestamp),
});

let watch: Location.LocationSubscription | null = null;
// The keychain is locked with the screen, so the connection is read whenever the updates start
// or change, usually while Nexo is open, and the background reuses it.
let liveConfig: TransitLiveConfig | null | undefined;
const warm = async () => {
  liveConfig = await loadTransitLiveConfig().catch(() => liveConfig);
};

const sound = async () => (await readJourneyState(await openDatabase())).preferences.sound;
const background = async () =>
  Platform.OS === 'ios' && (await TaskManager.isAvailableAsync().catch(() => false));

export const tripTracker = createTripTracker({
  now: Date.now,
  database: openDatabase,
  appActive: () => AppState.currentState === 'active',
  location: {
    permission: async () => {
      if (!(await Location.hasServicesEnabledAsync())) return 'unavailable';
      const { status } = await Location.requestForegroundPermissionsAsync();
      return status === 'granted' ? 'granted' : 'denied';
    },
    start: async (mode: TrackingMode) => {
      await warm();
      if (await background()) {
        try {
          await Location.startLocationUpdatesAsync(TRIP_LOCATION_TASK, {
            accuracy: Location.Accuracy.High,
            activityType:
              mode.activity === 'transit'
                ? Location.ActivityType.OtherNavigation
                : Location.ActivityType.Fitness,
            pausesUpdatesAutomatically: false,
            showsBackgroundLocationIndicator: true,
            deferredUpdatesInterval: mode.deferMs,
          });
          watch?.remove();
          watch = null;
          return 'background';
        } catch (error) {
          // A build without background location still follows the trip while it is open.
          console.error(error);
        }
      }
      watch ??= await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5_000 },
        (location) => void tripTracker.handleLocations([toFix(location)]),
      );
      return 'foreground';
    },
    stop: async () => {
      watch?.remove();
      watch = null;
      if (
        (await background()) &&
        (await Location.hasStartedLocationUpdatesAsync(TRIP_LOCATION_TASK))
      )
        await Location.stopLocationUpdatesAsync(TRIP_LOCATION_TASK);
    },
    running: async () =>
      watch !== null ||
      ((await background()) && (await Location.hasStartedLocationUpdatesAsync(TRIP_LOCATION_TASK))),
  },
  notify: {
    present: async (trip, events) =>
      presentTripEvents(await openDatabase(), trip, events, await sound()),
    alarms: async (trip, alarms) =>
      syncTripAlarms(await openDatabase(), trip, alarms, await sound()),
  },
  readLive: async (schedule, selection) => {
    if (liveConfig === undefined) await warm();
    if (!liveConfig) return null;
    const snapshot = await fetchLiveSnapshot(
      liveConfig,
      schedule,
      buildLiveQuery(schedule, selection),
      { timeoutMs: 8_000 },
    );
    return { snapshot, bytes: JSON.stringify(snapshot).length };
  },
  report: (error) => console.error(error),
});

TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
  TRIP_LOCATION_TASK,
  async ({ data, error }) => {
    if (error) {
      console.error(error);
      return;
    }
    await tripTracker.handleLocations((data?.locations ?? []).map(toFix));
  },
);
