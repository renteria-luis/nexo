import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import * as training from '../training/read.ts';
import { database, plannerFixture } from '../transit/fixtures.ts';
import * as journey from '../transit/journey.ts';
import * as storage from '../transit/journey-store.ts';
import * as map from '../transit/map.ts';
import * as planner from '../transit/planner.ts';
import * as realtime from '../transit/realtime.ts';
import * as activeTrip from '../transit/active-trip.ts';
import * as schedules from '../transit/schedule.ts';
import { queryInstant } from '../transit/schedule.ts';
import * as walks from '../transit/walks.ts';
import { nodes, renderModule } from '../ui/test-render.ts';

async function fixture(
  t: TestContext,
  existingWorkout: boolean,
  cleanupProblem: string | null = null,
  options: { trip?: Partial<journey.NextTrip>; following?: boolean } = {},
) {
  const { db } = await database();
  const now = queryInstant('2026-10-13', '08:00');
  let clock = now;
  t.mock.method(Date, 'now', () => clock);
  const clocks: (() => void)[] = [];
  let ticks = 0;
  t.mock.method(globalThis, 'setInterval', ((callback: () => void) => {
    clocks.push(callback);
    return 0;
  }) as any);
  const schedule = plannerFixture();
  const origin = { id: 'from', name: 'From', lat: 43, lng: -81.2, gym_id: 'gym' };
  const destination = { id: 'to', name: 'To', lat: 42.9878, lng: -81.17, gym_id: null };
  const search = planner.startPlan(planner.buildPlannerIndex(schedule), {
    origin,
    destination,
    originWalks: new Map(),
    destinationWalks: new Map(),
    stopWalks: [],
    mode: 'depart',
    at: now,
  });
  while (!search.step(1_000));
  const option = planner.liveOptions(search.result(), null, now)[0];
  const trip: journey.NextTrip = {
    id: 'saved',
    originId: 'from',
    destinationId: 'to',
    at: now,
    mode: 'now',
    workoutId: 'workout',
    selectedKey: option.scheduleKey,
    selectedAt: now,
    reminders: true,
    ...options.trip,
  };
  await storage.saveJourneyState(db, {
    preferences: journey.DEFAULT_TRAVEL_PREFERENCES,
    next: cleanupProblem ? null : trip,
  });
  const session = {
    id: 'workout',
    gym_id: 'gym',
    start_time: now,
    end_time: null,
    is_retroactive: 0,
  };
  let resolveTiming!: (value: unknown) => void;
  const timing = new Promise((resolve) => {
    resolveTiming = resolve;
  });
  const reads: unknown[][] = [];
  const syncs: journey.TravelReminder[][] = [];
  let searches = 0;
  let walkReads = 0;
  let placeReads = 0;
  const starts: Record<string, any>[] = [];
  const app = {
    state: {
      phase: 'ready',
      loaded: {
        today: { session: existingWorkout ? session : null },
        plan: [{ exerciseId: 'press', position: 0, sets: 1, restSeconds: 60 }],
        exercise: { exercises: [{ id: 'press', equipment_type: 'machine', unilateral: 0 }] },
        sessionDraft: null,
      },
    },
    dataRevision: 1,
    restoreRevision: 0,
    loadSessionTiming: (...args: unknown[]) => {
      reads.push(args);
      return timing;
    },
  };
  const module = renderModule('src/shell/TransitJourney.tsx', {
    'react-native': {
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      LayoutAnimation: { configureNext() {}, Presets: { easeInEaseOut: {} } },
    },
    '../db/index.ts': { openDatabase: async () => db },
    '../training/read.ts': training,
    '../transit/journey.ts': journey,
    '../transit/journey-store.ts': storage,
    '../transit/map.ts': map,
    '../transit/planner.ts': {
      ...planner,
      startPlan: (...args: Parameters<typeof planner.startPlan>) => {
        searches++;
        return planner.startPlan(...args);
      },
    },
    '../transit/realtime.ts': realtime,
    '../transit/index.ts': { TRANSIT_ENABLED: true },
    '../transit/active-trip.ts': activeTrip,
    '../transit/schedule.ts': schedules,
    '../transit/walks.ts': walks,
    '../transit/trip-store.ts': { listAcceptedWalks: async () => [] },
    './trip-task.ts': {
      tripTracker: {
        getState: () => ({
          trip: options.following ? { id: 'riding', phase: 'riding', sourceSha256: '' } : null,
          gps: 'off',
          problem: cleanupProblem,
        }),
        subscribe: () => () => undefined,
        reconcile: async () => undefined,
        tick: async () => {
          ticks++;
        },
        start: async (input: Record<string, any>) => {
          starts.push(input);
        },
        setSchedule() {},
        setLive() {},
      },
    },
    '../transit/store.ts': {
      listPlaces: async () => {
        placeReads++;
        return [origin, destination];
      },
      listWalkLinks: async (_db: unknown, placeId: string) => {
        walkReads++;
        return placeId === 'from'
          ? [
              {
                place_id: 'from',
                stop_id: 'ORIGIN_SB',
                direction: 'to_stop',
                minutes: 3,
                available: 1,
                note: '',
                path: JSON.stringify([
                  [43.0005, -81.2002],
                  [43.0004, -81.2001],
                ]),
                crossings: '[]',
                updated_at: now,
              },
            ]
          : [];
      },
      listStopWalks: async () => [],
    },
    './AppData.tsx': { useAppData: () => app },
    './transit.ts': {
      loadTransit: async () => ({
        db,
        cache: { schedule, sha256: 'fixture', saved_at: now, checked_at: now, last_error: null },
      }),
    },
    './transit-live.ts': {
      loadTransitLiveConfig: async () => null,
      createTransitLiveClient: () => ({ setQuery() {}, setForeground() {}, dispose() {} }),
    },
    './notifications.ts': {
      syncTransitReminders: async (
        _db: unknown,
        _trip: unknown,
        reminders: journey.TravelReminder[],
      ) => {
        syncs.push(reminders);
        return 'scheduled';
      },
    },
  }).mount('TransitJourneyProvider', { children: null });
  const settle = async () => {
    for (let i = 0; i < 15; i++) {
      await module.settle();
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    return nodes(await module.settle()).find(
      (node) => node.props.value?.saved && 'advice' in node.props.value,
    )?.props.value;
  };
  const actions = async () =>
    nodes(await module.settle()).find((node) => node.props.value?.startTrip)?.props.value;
  return {
    app,
    clocks,
    /** Moves the clock on by whole minutes, each with the screen's own tick. */
    wait: async (minutes: number) => {
      for (let i = 0; i < minutes; i++) {
        clock += 60_000;
        clocks.at(-1)!();
        await settle();
      }
    },
    ticks: () => ticks,
    searches: () => searches,
    walkReads: () => walkReads,
    placeReads: () => placeReads,
    starts,
    actions,
    settle,
    syncs,
    reads,
    resolve: () => resolveTiming({ session, sets: [], history: [], exercises: [] }),
  };
}

test('cold startup preserves armed reminders until Training has answered its read-only request', async (t) => {
  const f = await fixture(t, true);
  await f.settle();
  assert.equal(f.syncs.length, 0, 'loading is not a request to cancel existing alerts');
  assert.equal(f.reads.length, 1);
  assert.ok(
    f.reads.every((args) => args.length === 1 && args[0] === 'workout'),
    'no prepare=true Training write',
  );
  f.resolve();
  await f.settle();
  assert.ok(f.syncs.some((reminders) => reminders.length === 2));
});

test('the visible journey clock also reconciles the active trip timeout', async (t) => {
  const f = await fixture(t, false);
  await f.settle();
  assert.ok(f.clocks.length > 0);
  f.clocks.at(-1)!();
  await f.settle();
  assert.equal(f.ticks(), 1);
});

test('cleanup retries keep a clock even after the saved journey and active trip have ended', async (t) => {
  const f = await fixture(t, false, 'No se pudo detener el GPS');
  const view = await f.settle();
  assert.equal(view.saved.next, null);
  assert.equal(view.trip, null);
  assert.ok(f.clocks.length > 0);
  f.clocks.at(-1)!();
  await f.settle();
  assert.equal(f.ticks(), 1);
});

test('a saved journey whose workout is gone cancels its reminders instead of waiting forever', async (t) => {
  const f = await fixture(t, false);
  const view = await f.settle();
  assert.equal(f.reads.length, 0);
  assert.ok(f.syncs.length > 0);
  assert.ok(f.syncs.every((reminders) => reminders.length === 0));
  assert.equal(view.advice.feasible, false);
});

const leavingNow = { selectedKey: null, selectedAt: null, workoutId: null, reminders: false };

test('leaving now, the minute re-judges the buses found and the search runs again every ten minutes', async (t) => {
  const f = await fixture(t, false, null, { trip: leavingNow });
  assert.ok((await f.settle()).advice?.feasible);
  const searches = f.searches();
  const walkReads = f.walkReads();
  assert.ok(searches > 0 && walkReads > 0);
  await f.wait(9);
  assert.equal(f.searches(), searches, 'nine minutes without a new search');
  await f.wait(1);
  assert.equal(f.searches(), searches + 1);
  assert.equal(f.walkReads(), walkReads, 'the clock does not read his walks again');
});

test('during a trip in progress the clock does not search the next trip again', async (t) => {
  const f = await fixture(t, false, null, { trip: leavingNow, following: true });
  await f.settle();
  const searches = f.searches();
  assert.ok(searches > 0);
  await f.wait(15);
  assert.equal(f.searches(), searches);
});

test('a restored backup reads the saved trip and places again', async (t) => {
  const f = await fixture(t, false);
  await f.settle();
  const placeReads = f.placeReads();
  f.app.restoreRevision++;
  await f.settle();
  assert.equal(f.placeReads(), placeReads + 1);
});

test('starting the saved trip passes his saved walk paths to the tracker', async (t) => {
  const f = await fixture(t, false, null, { trip: leavingNow });
  await f.settle();
  const act = await f.actions();
  await act.startTrip();
  assert.equal(f.starts.length, 1);
  assert.equal(f.starts[0].paths?.access?.length, 4);
  assert.deepEqual(f.starts[0].paths.access[1], { lat: 43.0005, lng: -81.2002 });
});
