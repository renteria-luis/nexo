import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import type { SQLiteDatabase } from 'expo-sqlite';

import { openDatabase } from '../db/index.ts';
import { readSchedule, replaceSchedule, type CachedSchedule } from '../transit/store.ts';
import { validateSchedule } from '../transit/schedule.ts';
import { syncSchedule } from '../transit/sync.ts';
import { distanceMetres, READING_MAX_ERROR_M, type Coordinates } from '../core/geo.ts';

const digest = (content: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content);

export async function loadTransit() {
  const db = await openDatabase();
  let cache = await readSchedule(db);
  if (!cache) {
    // Deferred so unused Transit does not parse the citywide schedule at app startup.
    const bundled = require('../../transit/schedule.json');
    const content = JSON.stringify(bundled);
    cache = await replaceSchedule(
      db,
      content,
      await digest(content),
      Date.now(),
      validateSchedule(bundled),
    );
    // Bootstrap does not claim that the phone has checked the remote publisher.
    await db.runAsync('UPDATE transit_schedule_cache SET checked_at = NULL WHERE id = 1;');
    cache.checked_at = null;
  }
  return { db, cache };
}

export async function refreshTransit(db: SQLiteDatabase, cache: CachedSchedule) {
  return syncSchedule(db, cache, { fetch, digest });
}

let locating: Promise<Coordinates> | null = null;

export function transitLocation(): Promise<Coordinates> {
  if (locating) return locating;
  locating = (async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted')
      throw new Error('Sin permiso de ubicación. Puedes usar el mapa o escribir las coordenadas.');
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    if (
      position.coords.accuracy === null ||
      position.coords.accuracy > READING_MAX_ERROR_M ||
      Date.now() - position.timestamp > 60_000
    ) {
      throw new Error('La ubicación no tiene suficiente precisión. Usa el mapa o las coordenadas.');
    }
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  })().finally(() => {
    locating = null;
  });
  return locating;
}

let finding: Promise<Coordinates | null> | null = null;

/**
 * Where he is as he opens Transit, quickly: the phone's last position when it is recent and
 * good, otherwise one balanced reading. Null without permission, or when the reading is too
 * rough to tell his places apart; an automatic reading says nothing, he did not ask for it.
 */
export function transitHere(): Promise<Coordinates | null> {
  if (finding) return finding;
  finding = (async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return null;
    const position =
      (await Location.getLastKnownPositionAsync({
        maxAge: 60_000,
        requiredAccuracy: READING_MAX_ERROR_M,
      })) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    if (position.coords.accuracy === null || position.coords.accuracy > READING_MAX_ERROR_M)
      return null;
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  })().finally(() => {
    finding = null;
  });
  return finding;
}

// Apple's geocoder receives the text he types. A match this far from downtown London is another
// city's street with the same name.
const ADDRESS_MAX_M = 40_000;
const LONDON = { lat: 42.9849, lng: -81.2453 };

/** Where an address he typed is, in or around London; null when nothing there matches. */
export async function transitAddress(text: string): Promise<Coordinates | null> {
  const query = /london/i.test(text) ? text : `${text}, London, Ontario`;
  const found = await Location.geocodeAsync(query);
  return (
    found
      .map((result) => ({ lat: result.latitude, lng: result.longitude }))
      .find((point) => distanceMetres(point, LONDON) <= ADDRESS_MAX_M) ?? null
  );
}
