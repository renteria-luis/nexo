// Follows the trip he started: the phone's readings move it along, what it learns is saved, and
// its notifications go out once. Everything native comes in through `deps`, so the rules are
// tested without a phone; `trip-task.ts` wires the real location and notification modules.

import type { SQLiteDatabase } from 'expo-sqlite';

import {
  applyAction,
  applyClock,
  applyFix,
  freezeTrip,
  isActive,
  tripAlarms,
  tripLiveSelection,
  type ActiveTrip,
  type Fix,
  type TripAction,
  type TripAlarm,
  type TripEvent,
  type TripLive,
  type TripPhase,
  type TripStep,
} from '../transit/active-trip.ts';
import type { PlanOption } from '../transit/planner.ts';
import type { LiveSnapshot } from '../transit/realtime.ts';
import { agencyDate, type Schedule } from '../transit/schedule.ts';
import { readActiveTrip, saveTrip } from '../transit/trip-store.ts';

/** How the readings arrive: from the background with the screen locked, or only while open. */
export type GpsStatus = 'off' | 'background' | 'foreground' | 'denied' | 'unavailable';

/**
 * Best accuracy on the whole trip, since a boarding needs it; what changes is how often iOS
 * hands the readings over while Nexo is in the background, faster on a bus where stops come
 * quickly. No distance filter: a still phone keeps reporting, which is what lets a forgotten
 * trip end itself.
 */
export type TrackingMode = { deferMs: number; activity: 'fitness' | 'transit' };
export function trackingMode(phase: TripPhase): TrackingMode {
  return phase === 'riding'
    ? { deferMs: 5_000, activity: 'transit' }
    : { deferMs: 10_000, activity: 'fitness' };
}

/** Readings while open repaint the card at most this often; a phase change shows at once. */
const REPAINT_MS = 5_000;
/** Readings that change nothing important are saved this often, so a restart loses little. */
const SAVE_MS = 30_000;
/** A live reading in the background at most this often. */
export const BACKGROUND_LIVE_MS = 60_000;

export type TrackerDeps = {
  now: () => number;
  database: () => Promise<SQLiteDatabase>;
  appActive: () => boolean;
  location: {
    permission: () => Promise<'granted' | 'denied' | 'unavailable'>;
    /** Starts the updates, or retunes them when already running, and says how they run. */
    start: (mode: TrackingMode) => Promise<'background' | 'foreground'>;
    stop: () => Promise<void>;
    running: () => Promise<boolean>;
  };
  notify: {
    present: (trip: ActiveTrip, events: readonly TripEvent[]) => Promise<void>;
    alarms: (trip: ActiveTrip | null, alarms: readonly TripAlarm[]) => Promise<void>;
  };
  /** One live reading for the rides ahead, only while Nexo is in the background. */
  readLive?: (
    schedule: Schedule,
    selection: ReturnType<typeof tripLiveSelection>,
  ) => Promise<{ snapshot: LiveSnapshot; bytes: number } | null>;
  report: (error: unknown) => void;
};

export type TrackerState = {
  /** The trip in progress, or the one that just ended until he closes it. */
  trip: ActiveTrip | null;
  gps: GpsStatus;
  problem: string | null;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createTripTracker(deps: TrackerDeps) {
  let state: TrackerState = { trip: null, gps: 'off', problem: null };
  let loaded = false;
  let schedule: Schedule | null = null;
  let snapshot: LiveSnapshot | null = null;
  let liveAt = -Infinity;
  let reading = false;
  let savedAt = -Infinity;
  let paintedAt = -Infinity;
  let modeKey: string | null = null;
  let alarmsKey: string | null = null;
  let stopPending = false;
  const listeners = new Set<(state: TrackerState) => void>();
  let queue: Promise<unknown> = Promise.resolve();

  const emit = (changes: Partial<TrackerState>) => {
    state = { ...state, ...changes };
    paintedAt = deps.now();
    for (const listener of listeners) listener(state);
  };
  // Readings, taps and resumes change the same trip; one at a time.
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  };
  const context = (): TripLive | null => (schedule ? { schedule, snapshot } : null);

  async function load() {
    if (loaded) return;
    const trip = await readActiveTrip(await deps.database());
    loaded = true;
    if (trip || !state.trip) emit({ trip });
  }

  async function syncAlarms(trip: ActiveTrip | null) {
    const alarms = trip && isActive(trip) ? tripAlarms(trip, context(), deps.now()) : [];
    const key = JSON.stringify([trip && isActive(trip) ? trip.id : null, alarms]);
    if (key === alarmsKey) return;
    try {
      await deps.notify.alarms(trip, alarms);
      alarmsKey = key;
    } catch (error) {
      deps.report(error);
    }
  }

  async function shutdown() {
    modeKey = null;
    try {
      if (await deps.location.running()) await deps.location.stop();
    } catch (error) {
      deps.report(error);
      stopPending = true;
      emit({ problem: `No se pudo detener el GPS. Nexo volverá a intentarlo: ${message(error)}` });
      return;
    }
    const retrying = stopPending;
    stopPending = false;
    emit({
      ...(state.gps !== 'denied' && state.gps !== 'unavailable' ? { gps: 'off' as const } : {}),
      ...(retrying ? { problem: null } : {}),
    });
  }

  async function follow(trip: ActiveTrip, force = false) {
    const mode = trackingMode(trip.phase);
    const key = JSON.stringify(mode);
    if (!force && key === modeKey) return;
    try {
      const how = await deps.location.start(mode);
      modeKey = key;
      if (how !== state.gps) emit({ gps: how });
    } catch (error) {
      deps.report(error);
      emit({ gps: 'unavailable', problem: `No se pudo seguir el GPS: ${message(error)}` });
    }
  }

  async function commit(step: TripStep, force = false) {
    const before = state.trip;
    const trip = step.trip;
    const important =
      force ||
      step.events.length > 0 ||
      step.observations.length > 0 ||
      !before ||
      before.id !== trip.id ||
      before.phase !== trip.phase ||
      before.leg !== trip.leg ||
      before.boarded.join() !== trip.boarded.join() ||
      before.boarding.doubt !== trip.boarding.doubt;
    if (important || deps.now() - savedAt >= SAVE_MS) {
      await saveTrip(await deps.database(), trip, step.observations);
      savedAt = deps.now();
    }
    if (important || deps.now() - paintedAt >= REPAINT_MS) emit({ trip, problem: null });
    else state = { ...state, trip };
    if (step.events.length) await deps.notify.present(trip, step.events).catch(deps.report);
    await syncAlarms(trip);
    if (!isActive(trip)) await shutdown();
    else if (state.gps === 'background' || state.gps === 'foreground') await follow(trip);
  }

  async function liveIfDue(trip: ActiveTrip) {
    const now = deps.now();
    if (
      !deps.readLive ||
      !schedule ||
      schedule.sourceSha256 !== trip.sourceSha256 ||
      reading ||
      deps.appActive() ||
      !isActive(trip) ||
      trip.leg >= trip.rides.length ||
      now - liveAt < BACKGROUND_LIVE_MS
    )
      return;
    const selection = tripLiveSelection(trip, agencyDate(now));
    if (!selection.trips.length) return;
    reading = true;
    liveAt = now;
    try {
      const result = await deps.readLive(schedule, selection);
      if (!result) return;
      if (!snapshot || result.snapshot.generatedAt >= snapshot.generatedAt)
        snapshot = result.snapshot;
      await serial(async () => {
        const current = state.trip;
        if (!current || current.id !== trip.id || !isActive(current)) return;
        await commit({
          trip: {
            ...current,
            stats: {
              ...current.stats,
              liveReads: current.stats.liveReads + 1,
              liveBytes: current.stats.liveBytes + result.bytes,
            },
          },
          events: [],
          observations: [],
        });
      });
    } catch (error) {
      deps.report(error);
    } finally {
      reading = false;
    }
  }

  return {
    getState: () => state,
    subscribe(listener: (state: TrackerState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setSchedule(value: Schedule) {
      schedule = value;
    },
    /** A newer reading from the screens; the background keeps its own. */
    setLive(value: LiveSnapshot | null) {
      if (value && (!snapshot || value.generatedAt >= snapshot.generatedAt)) snapshot = value;
    },

    start: (input: {
      option: PlanOption;
      schedule: Schedule;
      origin: { id: string; name: string; lat: number; lng: number };
      destination: { id: string; name: string; lat: number; lng: number };
      journeyId: string | null;
    }) =>
      serial(async () => {
        await load();
        if (state.trip && isActive(state.trip))
          throw new Error('Ya hay un viaje en curso. Termínalo antes de empezar otro.');
        schedule = input.schedule;
        const now = deps.now();
        const trip = freezeTrip({
          id: `trip-${now}-${Math.floor(Math.random() * 1e9)}`,
          journeyId: input.journeyId,
          schedule: input.schedule,
          option: input.option,
          origin: input.origin,
          destination: input.destination,
          now,
        });
        await saveTrip(await deps.database(), trip);
        savedAt = now;
        emit({ trip, problem: null });
        const permission = await deps.location.permission().catch((error: unknown) => {
          deps.report(error);
          return 'unavailable' as const;
        });
        if (permission === 'granted') await follow(trip, true);
        else emit({ gps: permission });
        await syncAlarms(trip);
        return trip;
      }),

    handleLocations: (fixes: readonly Fix[]) =>
      serial(async () => {
        await load();
        const trip = state.trip;
        if (!trip || !isActive(trip)) {
          // Updates that outlived their trip, after a crash or a restored backup.
          await shutdown();
          return;
        }
        const step: TripStep = {
          trip: { ...trip, stats: { ...trip.stats, batches: trip.stats.batches + 1 } },
          events: [],
          observations: [],
        };
        for (const fix of [...fixes].sort((a, b) => a.at - b.at)) {
          const next = applyFix(step.trip, fix, context());
          step.trip = next.trip;
          step.events.push(...next.events);
          step.observations.push(...next.observations);
        }
        const clocked = applyClock(step.trip, deps.now());
        step.trip = clocked.trip;
        step.events.push(...clocked.events);
        await commit(step);
        void liveIfDue(step.trip);
      }).catch((error: unknown) => {
        deps.report(error);
        emit({ problem: message(error) });
      }),

    act: (action: TripAction) =>
      serial(async () => {
        await load();
        const trip = state.trip;
        if (!trip || !isActive(trip)) return;
        await commit(applyAction(trip, action, deps.now(), context()), true);
      }),

    /** The clock's turn: only a trip that outlived its time ends. */
    tick: () =>
      serial(async () => {
        await load();
        const trip = state.trip;
        if (!trip || !isActive(trip)) {
          if (stopPending) await shutdown();
          await syncAlarms(trip);
          return;
        }
        const step = applyClock(trip, deps.now());
        if (step.trip !== trip) await commit(step, true);
        else await syncAlarms(trip);
      }),

    /**
     * On launch and on every return to Nexo: the saved trip is the truth. A finished one stops
     * the GPS and its notifications; an active one gets its readings back if they stopped.
     */
    reconcile: () =>
      serial(async () => {
        const saved = await readActiveTrip(await deps.database());
        loaded = true;
        if (!saved) {
          // Ended here, or erased by a reset or a restored backup.
          if (state.trip && isActive(state.trip)) emit({ trip: null });
          await shutdown();
          await syncAlarms(null);
          return;
        }
        // The copy in memory may hold readings not saved yet.
        const trip = state.trip?.id === saved.id && isActive(state.trip) ? state.trip : saved;
        emit({ trip });
        const clocked = applyClock(trip, deps.now());
        if (clocked.trip !== trip) {
          await commit(clocked, true);
          return;
        }
        let running = false;
        try {
          running = await deps.location.running();
        } catch (error) {
          deps.report(error);
        }
        if (running || deps.appActive()) {
          const permission = deps.appActive() ? await deps.location.permission() : 'granted';
          if (permission === 'granted') await follow(trip, true);
          else {
            await shutdown();
            emit({ gps: permission });
          }
        }
        await syncAlarms(trip);
      }),

    /** Puts away a finished trip's summary. */
    dismiss: () =>
      serial(async () => {
        if (stopPending) await shutdown();
        if (stopPending) return;
        if (state.trip && !isActive(state.trip)) emit({ trip: null });
      }),
  };
}

export type TripTracker = ReturnType<typeof createTripTracker>;
