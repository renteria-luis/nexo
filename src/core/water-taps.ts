// Los toques de agua de hoy, para poder deshacerlos uno por uno.
//
// Decision del 2026-10-03: "Deshacer" quita el ultimo toque a cualquiera de los botones
// de agua; dos veces, los dos ultimos, y asi hasta el primero del dia. Antes la unica
// correccion era "Reiniciar", que borraba el agua entera sin preguntar y estaba a ocho
// puntos de la botella.
//
// Se guardan como un ajuste mas, en texto y con su fecha, para que sigan ahi si iOS cierra
// la app en medio del dia; al dia siguiente ya no hay nada que deshacer.

import type { IsoDate } from './dates.ts';

export function serializeWaterTaps(date: IsoDate, taps: readonly number[]): string {
  return JSON.stringify({ date, taps });
}

/** Los mililitros de cada toque de ese dia, del primero al ultimo. */
export function parseWaterTaps(stored: string | undefined, date: IsoDate): number[] {
  if (!stored) return [];

  let body: unknown;
  try {
    body = JSON.parse(stored);
  } catch {
    // Un ajuste corrupto no puede tumbar el arranque: solo deja sin nada que deshacer.
    return [];
  }

  if (typeof body !== 'object' || body === null) return [];
  const { date: storedDate, taps } = body as Record<string, unknown>;
  if (storedDate !== date || !Array.isArray(taps)) return [];
  return taps.filter((ml): ml is number => typeof ml === 'number' && ml > 0);
}

/** La lista sin su ultimo toque, y cuanto era. Null cuando ya no queda nada que deshacer. */
export function undoLastTap(taps: readonly number[]): { taps: number[]; ml: number } | null {
  const ml = taps.at(-1);
  return ml === undefined ? null : { taps: taps.slice(0, -1), ml };
}
