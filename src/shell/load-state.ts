import type { IsoDate } from '../core/dates.ts';

export type LoadState<T> =
  | { phase: 'opening' }
  | {
      phase: 'ready';
      loaded: T;
      /** The last reload that failed, until a good one replaces it. */
      problem: string | null;
    }
  | { phase: 'failed'; message: string };

/**
 * Spec 17.4 rule 4: a failure must not take the shell down. Once the app has opened, a
 * reload that fails keeps the last good state on screen and says why on top of it.
 * Swapping every screen for the failure panel left a button that deletes the database
 * as the only thing he could press, so only a load that never succeeded gets the panel.
 */
export function afterFailedLoad<T>(current: LoadState<T>, message: string): LoadState<T> {
  return current.phase === 'ready'
    ? { ...current, problem: message }
    : { phase: 'failed', message };
}

/**
 * Si lo que esta en pantalla es de un dia que ya no es hoy.
 *
 * iOS deja la app dormida en memoria toda la noche, y al volver por la manana seguia
 * mostrando ayer como si fuera hoy: la primera botella se sumaba al total de ayer y se
 * guardaba en el dia nuevo. Solo un dia nuevo paga la recarga.
 */
export function showsAnotherDay(
  loaded: { today: { date: IsoDate } } | null,
  today: IsoDate,
): boolean {
  return loaded !== null && loaded.today.date !== today;
}
