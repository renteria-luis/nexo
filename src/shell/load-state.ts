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

/**
 * Una recarga a la vez, y en pantalla solo la que empezo despues de la ultima escritura.
 *
 * Las recargas terminaban en cualquier orden: una larga, con el trabajo de fondo, leia el
 * agua al empezar y llegaba despues de una corta que ya tenia la botella nueva, y dejaba
 * en pantalla el total de antes. La siguiente botella se sumaba a ese. Ahora lo que se
 * pide mientras una corre espera a que acabe, todo junto en una sola recarga mas, y lo que
 * traia la que corria se tira porque ya es viejo.
 *
 * `join` junta dos pedidos en uno. `unfinished` es lo que una carga tirada o fallida deja
 * por hacer: lo que escribio en la base ya esta, pero lo que leyo para la pantalla se
 * perdio con ella, y la siguiente tiene que volver a leerlo.
 */
export type ReloadResult = { ok: true } | { ok: false; error: unknown };

type Complete = (result: ReloadResult) => void;

export function reloadQueue<R, T>(
  load: (request: R) => Promise<T>,
  apply: (result: T) => void,
  fail: (error: unknown) => void,
  join: (a: R, b: R) => R,
  unfinished: (request: R) => R,
): (request: R) => Promise<ReloadResult> {
  let running = false;
  let pending: R | null = null;
  let pendingWaiters: Complete[] = [];
  let owed: R | null = null;

  const next = (carried: Complete[] = []) => {
    running = false;
    if (pending === null) return;
    const request = pending;
    const waiters = [...carried, ...pendingWaiters];
    pending = null;
    pendingWaiters = [];
    start(request, waiters);
  };

  const start = (request: R, waiters: Complete[]) => {
    running = true;
    const asked = owed === null ? request : join(owed, request);
    owed = null;
    const failed = (error: unknown) => {
      owed = unfinished(asked);
      fail(error);
      waiters.forEach((resolve) => resolve({ ok: false, error }));
      next();
    };
    try {
      load(asked).then((result) => {
        if (pending !== null) {
          owed = unfinished(asked);
          next(waiters);
          return;
        }
        running = false;
        try {
          apply(result);
          waiters.forEach((resolve) => resolve({ ok: true }));
        } catch (error) {
          failed(error);
        }
      }, failed);
    } catch (error) {
      failed(error);
    }
  };

  return (request) =>
    new Promise((resolve) => {
      if (running) {
        pending = pending === null ? request : join(pending, request);
        pendingWaiters.push(resolve);
      } else start(request, [resolve]);
    });
}
