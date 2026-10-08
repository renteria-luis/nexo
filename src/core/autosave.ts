export type SaveState = { status: 'saved' | 'saving' | 'error'; error?: string };

/** Serialize writes and coalesce typing while storage is busy; a stale completion never marks newer text saved. */
export function autosave<T>(
  initial: T,
  write: (value: T) => Promise<void>,
  changed: (state: SaveState) => void,
) {
  let desired = initial;
  let saved = initial;
  let active: Promise<void> | null = null;
  const flush = (): Promise<void> => {
    if (active) return active;
    if (Object.is(desired, saved)) {
      changed({ status: 'saved' });
      return Promise.resolve();
    }
    changed({ status: 'saving' });
    active = (async () => {
      try {
        while (!Object.is(desired, saved)) {
          const value = desired;
          await Promise.resolve().then(() => write(value));
          saved = value;
        }
        changed({ status: 'saved' });
      } catch (error) {
        changed({
          status: 'error',
          error: error instanceof Error ? error.message : 'No se pudo guardar.',
        });
      } finally {
        active = null;
      }
    })();
    return active;
  };
  return {
    change(value: T) {
      desired = value;
      return flush();
    },
    retry: flush,
  };
}
