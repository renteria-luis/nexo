import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import * as training from '../training/read.ts';
import { database, plannerFixture } from '../transit/fixtures.ts';
import * as journey from '../transit/journey.ts';
import * as storage from '../transit/journey-store.ts';
import * as planner from '../transit/planner.ts';
import * as realtime from '../transit/realtime.ts';
import { queryInstant } from '../transit/schedule.ts';
import { nodes, renderModule } from '../ui/test-render.ts';

async function fixture(t: TestContext, existingWorkout: boolean) {
  const { db } = await database();
  const now = queryInstant('2026-10-13', '08:00');
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', (() => 0) as any);
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
  };
  await storage.saveJourneyState(db, {
    preferences: journey.DEFAULT_TRAVEL_PREFERENCES,
    next: trip,
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
    loadSessionTiming: (...args: unknown[]) => {
      reads.push(args);
      return timing;
    },
  };
  const module = renderModule('src/shell/TransitJourney.tsx', {
    'react-native': {
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    },
    '../db/index.ts': { openDatabase: async () => db },
    '../training/read.ts': training,
    '../transit/journey.ts': journey,
    '../transit/journey-store.ts': storage,
    '../transit/planner.ts': planner,
    '../transit/realtime.ts': realtime,
    '../transit/index.ts': { TRANSIT_ENABLED: true },
    '../transit/store.ts': {
      listPlaces: async () => [origin, destination],
      listWalkLinks: async () => [],
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
  return {
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

test('a saved journey whose workout is gone cancels its reminders instead of waiting forever', async (t) => {
  const f = await fixture(t, false);
  const view = await f.settle();
  assert.equal(f.reads.length, 0);
  assert.ok(f.syncs.length > 0);
  assert.ok(f.syncs.every((reminders) => reminders.length === 0));
  assert.equal(view.advice.feasible, false);
});
