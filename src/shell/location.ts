// Spec 5.2, arriving at a gym, wired to the phone. The rules live in `gym-locator.ts`;
// this is the one shared locator, so the cooldown and the in-flight reading outlive any
// screen that asks.

import * as Location from 'expo-location';

import { createGymLocator } from './gym-locator.ts';

export type { LocateMode, LocationOutcome } from './gym-locator.ts';

export const locateGym = createGymLocator(Location);
