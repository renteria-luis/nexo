import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkoutFinish } from '../training/read.ts';
import {
  DEFAULT_TRAVEL_PREFERENCES,
  parseJourneyState,
  travelAdvice,
  travelReminders,
  type NextTrip,
} from './journey.ts';
import { readJourneyState, saveJourneyState } from './journey-store.ts';
import { database, plannerFixture } from './fixtures.ts';
import { buildPlannerIndex, startPlan, liveOptions } from './planner.ts';
import { queryInstant } from './schedule.ts';
import { exportBackup, importBackup } from '../core/backup.ts';

const now = queryInstant('2026-10-13', '08:00');
const schedule = plannerFixture();
const search = startPlan(buildPlannerIndex(schedule), {
  origin: { lat: 43, lng: -81.2 },
  destination: { lat: 42.9878, lng: -81.17 },
  originWalks: new Map(),
  destinationWalks: new Map(),
  stopWalks: [],
  mode: 'depart',
  at: now,
});
while (!search.step(100)) {
  /* Complete the bounded fixture. */
}
const option = liveOptions(search.result(), null, now)[0];
const trip: NextTrip = {
  id: 'journey',
  originId: 'origin',
  destinationId: 'destination',
  mode: 'now',
  at: now,
  selectedKey: option.scheduleKey,
  selectedAt: now,
  workoutId: null,
  reminders: true,
};
const workout: WorkoutFinish = {
  sessionId: 'workout',
  gymId: 'gym',
  endedAt: null,
  finishAt: now,
  remainingSets: 4,
  evidence: 'initial',
  fewestSessions: null,
  overdue: false,
};

test('workout deadline subtracts preparation once from the planner door departure', () => {
  const advice = travelAdvice(option, 5, workout, now);
  assert.equal(
    advice.leaveAt,
    option.live[0].board.at - (option.itinerary.access.minutes + 2) * 60_000,
  );
  assert.equal(advice.finishBy, advice.leaveAt - 5 * 60_000);
  assert.equal(advice.reachStopBy, advice.boardAt! - 2 * 60_000);
  // The plan's illustrative bus already includes 3 min boarding + 7 min walking.
  const illustrative = { ...option, leaveAt: queryInstant('2026-10-13', '18:32') };
  assert.equal(
    travelAdvice(illustrative, 4, null, now).finishBy,
    queryInstant('2026-10-13', '18:28'),
  );
});
test('unknown or too-late Training estimates cannot recommend a catchable bus', () => {
  const finishBy = option.leaveAt - 5 * 60_000;
  assert.equal(travelAdvice(option, 5, { ...workout, finishAt: finishBy }, now).feasible, true);
  assert.equal(
    travelAdvice(option, 5, { ...workout, finishAt: finishBy + 1 }, now).feasible,
    false,
  );
  assert.equal(
    travelAdvice(option, 5, { ...workout, finishAt: null, evidence: 'none' }, now).feasible,
    false,
  );
  assert.equal(travelAdvice({ ...option, problem: 'canceled' }, 5, null, now).feasible, false);
});
test('completing Training allows the already prepared departure until leave time', () => {
  const prepared = option.leaveAt - 5 * 60_000;
  assert.equal(
    travelAdvice(
      option,
      5,
      { ...workout, endedAt: prepared, finishAt: prepared, evidence: 'complete' },
      prepared + 4 * 60_000,
      undefined,
      prepared,
    ).feasible,
    true,
  );
  assert.equal(
    travelAdvice(option, 5, null, prepared + 4 * 60_000, undefined, prepared).feasible,
    true,
  );
  assert.equal(
    travelAdvice(option, 5, null, option.leaveAt + 1, undefined, prepared).feasible,
    false,
  );
  assert.equal(
    travelAdvice(option, 5, null, prepared + 4 * 60_000, undefined, prepared + 4 * 60_000).feasible,
    false,
    'selecting a bus does not remove preparation time',
  );
  assert.equal(
    travelAdvice(
      option,
      5,
      { ...workout, finishAt: prepared, evidence: 'complete' },
      prepared + 4 * 60_000,
    ).feasible,
    true,
    'finishing the final set starts preparation even before closing the session',
  );
});
test('arrive-by includes the final walk and keeps its arrival margin after delays', () => {
  assert.equal(travelAdvice(option, 5, null, now, option.arriveAt + 3 * 60_000).feasible, true);
  assert.equal(travelAdvice(option, 5, null, now, option.arriveAt + 2 * 60_000).feasible, false);
});
test('two stable opt-in events, explicit quiet policy and no immediate stale alerts', () => {
  const advice = travelAdvice(option, 5, null, now);
  const reminders = travelReminders(trip, advice, DEFAULT_TRAVEL_PREFERENCES, 'Destination', now);
  assert.deepEqual(
    reminders.map((r) => r.kind),
    ['prepare', 'leave'],
  );
  assert.equal(reminders[0].firesAt, advice.finishBy);
  assert.match(reminders[0].body, /Último cálculo/);
  assert.deepEqual(
    travelReminders({ ...trip, reminders: false }, advice, DEFAULT_TRAVEL_PREFERENCES, '', now),
    [],
  );
  assert.deepEqual(
    travelReminders(trip, { ...advice, feasible: false }, DEFAULT_TRAVEL_PREFERENCES, '', now),
    [],
  );
  const afterPrepare = travelReminders(
    trip,
    advice,
    DEFAULT_TRAVEL_PREFERENCES,
    '',
    advice.finishBy + 1,
  );
  assert.deepEqual(
    afterPrepare.map((r) => r.kind),
    ['leave'],
  );
  const night = new Date(2026, 9, 13, 22).getTime();
  const late = { ...advice, finishBy: night, leaveAt: night + 5 * 60_000 };
  assert.equal(travelReminders(trip, late, DEFAULT_TRAVEL_PREFERENCES, '', night - 1).length, 2);
  assert.equal(
    travelReminders(trip, late, { ...DEFAULT_TRAVEL_PREFERENCES, quiet: true }, '', night - 1)
      .length,
    0,
  );
});
test('changing a destination or later bus uses only the newly selected trip', () => {
  const advice = travelAdvice(option, 5, null, now);
  const next = { ...trip, id: 'new', destinationId: 'other' };
  const reminders = travelReminders(
    next,
    { ...advice, leaveAt: advice.leaveAt + 10 * 60_000, finishBy: advice.finishBy + 10 * 60_000 },
    DEFAULT_TRAVEL_PREFERENCES,
    'Other',
    now,
  );
  assert.equal(reminders[1].id, 'transit:new:leave');
  assert.equal(reminders[1].firesAt, advice.leaveAt + 10 * 60_000);
});
test('trip/preferences persist and join personal backups without touching Training', async () => {
  const { db, raw } = await database();
  const before = raw.prepare('SELECT * FROM training_session').all();
  const state = {
    next: trip,
    preferences: { ...DEFAULT_TRAVEL_PREFERENCES, preparationMinutes: 8 },
  };
  await saveJourneyState(db, state);
  assert.deepEqual(await readJourneyState(db), state);
  const backup = await exportBackup(db);
  const restored = await database();
  await importBackup(restored.db, backup);
  assert.deepEqual(await readJourneyState(restored.db), state);
  assert.deepEqual(raw.prepare('SELECT * FROM training_session').all(), before);
});
test('corrupt settings or trip data fail visibly instead of inventing travel advice', () => {
  assert.throws(
    () =>
      parseJourneyState(
        JSON.stringify({
          preferences: { ...DEFAULT_TRAVEL_PREFERENCES, preparationMinutes: -5 },
          next: null,
        }),
      ),
    /ajustes/,
  );
  assert.throws(
    () =>
      parseJourneyState(
        JSON.stringify({ preferences: DEFAULT_TRAVEL_PREFERENCES, next: { ...trip, at: null } }),
      ),
    /viaje/,
  );
});
