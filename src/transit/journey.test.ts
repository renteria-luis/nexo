import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorkoutFinish } from '../training/read.ts';
import {
  DEFAULT_TRAVEL_PREFERENCES,
  LEAVE_GRACE_MS,
  journeyNeedsReview,
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

test('a now journey expires with its search window, retaining overnight and explicitly dated trips', () => {
  assert.equal(journeyNeedsReview(trip, null, now + 180 * 60_000), false);
  assert.equal(journeyNeedsReview(trip, null, now + 181 * 60_000), true);
  assert.equal(
    journeyNeedsReview(
      { ...trip, selectedKey: null, selectedAt: null },
      null,
      now + 4 * 86_400_000,
    ),
    true,
  );
  const midnight = queryInstant('2026-10-14', '00:05');
  assert.equal(
    journeyNeedsReview({ ...trip, at: midnight - 10 * 60_000, selectedAt: null }, null, midnight),
    false,
  );
  assert.equal(journeyNeedsReview({ ...trip, mode: 'depart' }, null, now + 86_400_000), false);
  assert.equal(journeyNeedsReview({ ...trip, mode: 'arrive' }, null, now + 86_400_000), false);
  assert.equal(
    journeyNeedsReview(trip, workout, now + 5 * 3_600_000),
    false,
    'an ongoing workout remains linked',
  );
  assert.equal(
    journeyNeedsReview(trip, { ...workout, endedAt: now + 4 * 3_600_000 }, now + 5 * 3_600_000),
    false,
  );
  const later = now + 5 * 3_600_000;
  assert.equal(
    journeyNeedsReview(
      { ...trip, at: later, selectedAt: null },
      { ...workout, endedAt: now },
      later,
    ),
    false,
    'searching again after an old workout starts a fresh window',
  );
  assert.equal(
    journeyNeedsReview({ ...trip, selectedAt: later }, { ...workout, endedAt: now }, later),
    false,
    'choosing a different bus also refreshes the window',
  );
});

test('preparation reminders ask to finish only while the linked workout is still active', () => {
  const linked = { ...trip, workoutId: workout.sessionId };
  const active = travelAdvice(option, 5, workout, now);
  const completed = travelAdvice(
    option,
    5,
    { ...workout, endedAt: now, evidence: 'complete' },
    now,
  );
  assert.equal(
    travelReminders(linked, active, DEFAULT_TRAVEL_PREFERENCES, 'Casa', now)[0].title,
    'Termina y prepárate para salir',
  );
  assert.equal(
    travelReminders(linked, completed, DEFAULT_TRAVEL_PREFERENCES, 'Casa', now)[0].title,
    'Prepárate para salir',
  );
});

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

test('a live boarding prediction cannot label a derived arrival as official', () => {
  const advice = travelAdvice(
    {
      ...option,
      live: option.live.map((ride) => ({
        board: { ...ride.board, status: 'live', source: 'official' },
        alight: { ...ride.alight, status: 'estimated', source: 'estimate' },
      })),
    },
    5,
    null,
    now,
  );
  assert.equal(advice.source, 'Estimación con el retraso LTC');
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
    travelAdvice(option, 5, null, option.leaveAt + 5_000, undefined, prepared).feasible,
    true,
    'seconds after the leaving time the bus is still his',
  );
  assert.equal(
    travelAdvice(option, 5, null, option.leaveAt + LEAVE_GRACE_MS + 1, undefined, prepared)
      .feasible,
    false,
  );
  const late = travelAdvice(
    option,
    5,
    null,
    prepared + 4 * 60_000,
    undefined,
    prepared + 4 * 60_000,
  );
  assert.equal(late.feasible, true, 'a bus chosen late stays chosen');
  assert.equal(
    late.reason,
    'Vas con menos tiempo de preparación del habitual.',
    'selecting a bus does not hide that preparation is short',
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
test('the leave reminder survives the preparation reminder, with Training open or just finished', () => {
  const finishBy = option.leaveAt - 5 * 60_000;
  const kinds = (current: number, training: WorkoutFinish) =>
    travelReminders(
      trip,
      travelAdvice(option, 5, training, current, undefined, trip.selectedAt),
      DEFAULT_TRAVEL_PREFERENCES,
      '',
      current,
    ).map((reminder) => reminder.kind);
  const open = { ...workout, finishAt: finishBy };
  assert.deepEqual(kinds(finishBy - 60_000, open), ['prepare', 'leave']);
  for (const current of [finishBy, finishBy + 30_000, finishBy + 60_000]) {
    assert.deepEqual(kinds(current, open), ['leave'], 'still training when it rang');
    const done = { ...open, endedAt: current, finishAt: current, evidence: 'complete' as const };
    assert.deepEqual(kinds(current, done), ['leave'], 'finished after it rang');
  }
  assert.equal(
    travelAdvice(option, 5, { ...workout, finishAt: finishBy + 1 }, now, undefined, now).feasible,
    false,
    'before preparation time, a workout forecast to end late still rules the bus out',
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
