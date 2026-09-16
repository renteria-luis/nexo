// Spec 5.2, arriving at a gym. One reading and nothing after it.
//
// There is no watcher and no background permission: getCurrentPositionAsync resolves
// once and the radio goes quiet again by itself, so the cost is a single fix rather
// than a session-long trickle out of the battery.

import * as Location from 'expo-location';

import { gymAt, type GymFix, type GymLocation } from '../core/geo.ts';

export type LocationOutcome =
  { kind: 'match'; fix: GymFix } | { kind: 'elsewhere' } | { kind: 'denied' };

export async function locateGym(gyms: readonly GymLocation[]): Promise<LocationOutcome> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return { kind: 'denied' };

  // High rather than Balanced: at a plaza, a 100 m error picks the wrong unit, and
  // this runs once so the extra second of GPS is paid once.
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });

  const fix = gymAt(gyms, {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
  });

  return fix ? { kind: 'match', fix } : { kind: 'elsewhere' };
}
