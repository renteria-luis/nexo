// En que gimnasio esta, con una lectura suelta y nada despues.
//
// Hay dos formas de pedirla. Sola, al entrar a Entreno: no pregunta permiso (eso le toca
// a la flecha), prueba primero la posicion que el telefono ya tiene y, si hace falta una
// nueva, la pide con precision media y como mucho una vez cada dos minutos, porque pasa
// por la pestana del medio a cada rato. Y con la flecha: pregunta el permiso si hace
// falta, no espera a nadie y pide precision alta.
//
// No hay vigilancia ni permiso de fondo: cada lectura se pide una vez y el radio se apaga
// solo. Separado de `location.ts` para poder probarlo sin el modulo nativo.

import type * as ExpoLocation from 'expo-location';

import { readGym, READING_MAX_ERROR_M, type GymLocation, type GymReading } from '../core/geo.ts';

export type LocationApi = Pick<
  typeof ExpoLocation,
  | 'getForegroundPermissionsAsync'
  | 'requestForegroundPermissionsAsync'
  | 'getLastKnownPositionAsync'
  | 'getCurrentPositionAsync'
> & { Accuracy: Pick<typeof ExpoLocation.Accuracy, 'Balanced' | 'High'> };

export type LocateMode = 'auto' | 'manual';

export type LocationOutcome = GymReading | { kind: 'denied' };

/**
 * Lo mas vieja que puede ser la posicion guardada. Corta a proposito: dos minutos en
 * coche son dos kilometros, y una posicion de antes no prueba que siga en el gimnasio.
 */
const CACHED_MAX_AGE_MS = 60_000;

/** Entre una lectura nueva y la siguiente que se pide sola. La flecha no espera. */
export const AUTO_COOLDOWN_MS = 120_000;

export function createGymLocator(api: LocationApi, now: () => number = Date.now) {
  let lastFresh = -Infinity;
  let pending: { mode: LocateMode; outcome: Promise<LocationOutcome> } | null = null;

  async function locate(gyms: readonly GymLocation[], mode: LocateMode): Promise<LocationOutcome> {
    const permission =
      mode === 'manual'
        ? await api.requestForegroundPermissionsAsync()
        : await api.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') return { kind: 'denied' };

    // Leerla es instantaneo y no enciende nada; si ya dice donde esta, o que esta lejos
    // de los dos, no hace falta otra.
    const cached = await api.getLastKnownPositionAsync({
      maxAge: CACHED_MAX_AGE_MS,
      requiredAccuracy: READING_MAX_ERROR_M,
    });
    if (cached) {
      const reading = readGym(
        gyms,
        { lat: cached.coords.latitude, lng: cached.coords.longitude },
        cached.coords.accuracy,
      );
      if (reading.kind !== 'unsure') return reading;
    }

    if (mode === 'auto' && now() - lastFresh < AUTO_COOLDOWN_MS) return { kind: 'unsure' };
    lastFresh = now();
    const position = await api.getCurrentPositionAsync({
      accuracy: mode === 'manual' ? api.Accuracy.High : api.Accuracy.Balanced,
    });
    return readGym(
      gyms,
      { lat: position.coords.latitude, lng: position.coords.longitude },
      position.coords.accuracy,
    );
  }

  function start(gyms: readonly GymLocation[], mode: LocateMode): Promise<LocationOutcome> {
    // Sigue contada hasta que el telefono contesta de verdad, aunque la pantalla ya haya
    // dejado de esperarla: asi no se amontonan lecturas nativas que nadie puede cancelar.
    const outcome = locate(gyms, mode).finally(() => {
      if (pending?.outcome === outcome) pending = null;
    });
    pending = { mode, outcome };
    return outcome;
  }

  return (gyms: readonly GymLocation[], mode: LocateMode): Promise<LocationOutcome> => {
    const joined = pending;
    if (joined === null) return start(gyms, mode);
    if (mode === 'auto' || joined.mode === 'manual') return joined.outcome;
    // La que esta en marcha es la automatica, que no pregunta permiso: su "sin permiso"
    // no contesta a la flecha, que si puede preguntarlo.
    return joined.outcome.then((outcome) =>
      outcome.kind === 'denied' ? start(gyms, 'manual') : outcome,
    );
  };
}
