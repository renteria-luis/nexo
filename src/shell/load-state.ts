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
