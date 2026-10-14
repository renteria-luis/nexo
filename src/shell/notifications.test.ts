import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as coordinator from '../core/notification-plan.ts';
import { inTransaction } from '../db/transaction.ts';
import { database } from '../transit/fixtures.ts';
import * as journeyStore from '../transit/journey-store.ts';
import {
  DEFAULT_TRAVEL_PREFERENCES,
  type NextTrip,
  type TravelReminder,
} from '../transit/journey.ts';
import { renderModule } from '../ui/test-render.ts';

async function fixture() {
  const { db, raw } = await database();
  let now = new Date(2026, 9, 13, 12).getTime();
  const pending = new Map<string, any>();
  const calls: string[] = [];
  let permission = true;
  let last: any = null;
  const listeners: ((event: any) => void)[] = [];
  const presented: any[] = [];
  const nudge = {
    id: 'creatina',
    title: 'Creatina',
    body: 'Falta creatina',
    kind: 'creatina',
    actions: [],
  };
  let healthRecorded = false;
  const native = {
    SchedulableTriggerInputTypes: { DATE: 'date' },
    DEFAULT_ACTION_IDENTIFIER: 'default',
    setNotificationHandler() {},
    getPermissionsAsync: async () => ({ granted: permission, canAskAgain: false }),
    getAllScheduledNotificationsAsync: async () => [...pending.values()],
    cancelScheduledNotificationAsync: async (id: string) => {
      calls.push(`cancel:${id}`);
      pending.delete(id);
    },
    scheduleNotificationAsync: async (request: any) => {
      calls.push(`schedule:${request.identifier}`);
      if (request.trigger === null) presented.push({ request });
      else pending.set(request.identifier, request);
      return request.identifier;
    },
    getPresentedNotificationsAsync: async () => presented,
    setNotificationCategoryAsync: async () => undefined,
    getLastNotificationResponse: () => last,
    clearLastNotificationResponse: () => {
      last = null;
    },
    addNotificationResponseReceivedListener: (listener: (event: any) => void) => {
      listeners.push(listener);
      return { remove() {} };
    },
  };
  const module = renderModule('src/shell/notifications.ts', {
    'expo-notifications': native,
    'react-native': { Platform: { OS: 'ios' } },
    '../core/notification-plan.ts': coordinator,
    '../db/transaction.ts': { inTransaction },
    '../transit/journey-store.ts': journeyStore,
    '../core/throttle.ts': {
      throttled: (work: (...args: any[]) => void) => ({ call: work, flush() {} }),
    },
    './nudges.ts': {
      nudgePlan: async () => [nudge],
      fireAt: () => new Date(now + 3_600_000),
      recordNudges: async () => {
        healthRecorded = true;
      },
    },
  }).exports;
  const trip: NextTrip = {
    id: 'one',
    originId: 'a',
    destinationId: 'b',
    at: now,
    mode: 'now',
    workoutId: null,
    selectedKey: 'bus',
    selectedAt: now,
    reminders: true,
  };
  await journeyStore.saveJourneyState(db, { preferences: DEFAULT_TRAVEL_PREFERENCES, next: trip });
  const reminder = (kind: 'prepare' | 'leave', offset: number): TravelReminder => ({
    id: `transit:one:${kind}`,
    journeyId: 'one',
    kind,
    firesAt: now + offset,
    expiresAt: now + 600_000,
    title: kind,
    body: 'Last estimate',
    sound: true,
  });
  return {
    db,
    raw,
    pending,
    calls,
    module,
    trip,
    reminder,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    deny: () => {
      permission = false;
    },
    setLast: (event: any) => {
      last = event;
    },
    last: () => last,
    healthRecorded: () => healthRecorded,
    listeners,
    presented,
  };
}

test('real native adapter preserves health and creatine in either sync order and does not reschedule unchanged events', async (t) => {
  const f = await fixture();
  t.mock.method(Date, 'now', f.now);
  f.pending.set('legacy-health', {
    identifier: 'legacy-health',
    content: { data: { nudgeId: 'legacy-health' } },
  });
  const reminders = [f.reminder('prepare', 300_000), f.reminder('leave', 600_000)];
  await f.module.syncTransitReminders(f.db, f.trip, reminders);
  assert.ok(f.pending.has('legacy-health'));
  f.module.syncNudges(f.db, '2026-10-13');
  for (let i = 0; i < 30 && !f.healthRecorded(); i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.healthRecorded(), true);
  assert.deepEqual([...f.pending.keys()].sort(), [
    'creatina',
    'transit:one:leave',
    'transit:one:prepare',
  ]);
  const count = f.calls.length;
  await f.module.syncTransitReminders(f.db, f.trip, reminders);
  assert.equal(f.calls.length, count);
  await journeyStore.saveJourneyState(f.db, {
    preferences: DEFAULT_TRAVEL_PREFERENCES,
    next: null,
  });
  await f.module.syncTransitReminders(f.db, null, []);
  assert.deepEqual([...f.pending.keys()], ['creatina']);
});
test('a fired preparation alert cannot burst again after a later prediction or app restart', async (t) => {
  const f = await fixture();
  t.mock.method(Date, 'now', f.now);
  await f.module.syncTransitReminders(f.db, f.trip, [
    f.reminder('prepare', 60_000),
    f.reminder('leave', 360_000),
  ]);
  f.advance(120_000);
  f.pending.delete('transit:one:prepare');
  await f.module.syncTransitReminders(f.db, f.trip, [
    f.reminder('prepare', 60_000),
    f.reminder('leave', 360_000),
  ]);
  assert.equal(f.pending.has('transit:one:prepare'), false);
  assert.equal(
    f.raw.prepare("SELECT consumed FROM transit_reminder_event WHERE kind = 'prepare'").get()!
      .consumed,
    1,
  );
  assert.equal(f.pending.has('transit:one:leave'), true);
});

test('explicitly choosing a different journey allows fresh alerts after the previous one fired', async (t) => {
  const f = await fixture();
  t.mock.method(Date, 'now', f.now);
  await f.module.syncTransitReminders(f.db, f.trip, [f.reminder('prepare', 60_000)]);
  f.advance(120_000);
  const next = { ...f.trip, id: 'two' };
  await journeyStore.saveJourneyState(f.db, { preferences: DEFAULT_TRAVEL_PREFERENCES, next });
  await f.module.syncTransitReminders(f.db, next, [
    { ...f.reminder('prepare', 300_000), id: 'transit:two:prepare', journeyId: 'two' },
  ]);
  assert.equal(f.pending.has('transit:one:prepare'), false);
  assert.ok(f.pending.has('transit:two:prepare'));
});
test('a preparation alert cancelled before delivery can be scheduled for a later bus', async (t) => {
  const f = await fixture();
  t.mock.method(Date, 'now', f.now);
  await f.module.syncTransitReminders(f.db, f.trip, [f.reminder('prepare', 60_000)]);
  await f.module.syncTransitReminders(f.db, f.trip, []);
  f.advance(120_000);
  await f.module.syncTransitReminders(f.db, f.trip, [f.reminder('prepare', 300_000)]);
  assert.ok(f.pending.has('transit:one:prepare'));
  assert.equal(
    f.raw.prepare("SELECT consumed FROM transit_reminder_event WHERE kind = 'prepare'").get()!
      .consumed,
    0,
  );
});
test('old asynchronous work cannot restore a replaced destination; permission denial preserves manual planning', async (t) => {
  const f = await fixture();
  t.mock.method(Date, 'now', f.now);
  await journeyStore.saveJourneyState(f.db, {
    preferences: DEFAULT_TRAVEL_PREFERENCES,
    next: { ...f.trip, id: 'two', destinationId: 'c' },
  });
  await f.module.syncTransitReminders(f.db, f.trip, [f.reminder('leave', 600_000)]);
  assert.equal(f.pending.size, 0);
  await journeyStore.saveJourneyState(f.db, {
    preferences: DEFAULT_TRAVEL_PREFERENCES,
    next: f.trip,
  });
  f.deny();
  assert.equal(
    await f.module.syncTransitReminders(f.db, f.trip, [f.reminder('leave', 600_000)]),
    'denied',
  );
  assert.equal((await journeyStore.readJourneyState(f.db)).next?.selectedKey, 'bus');
});
test('a cold Transit tap survives health listener startup and is routed independently', async (t) => {
  const f = await fixture();
  t.mock.method(Date, 'now', f.now);
  f.setLast({
    actionIdentifier: 'default',
    notification: {
      request: {
        content: {
          data: { notificationOwner: 'transit', journeyId: 'one', expiresAt: f.now() - 1 },
        },
      },
    },
  });
  const health: any[] = [],
    travel: any[] = [];
  f.module.listenToNudges((value: any) => health.push(value));
  assert.ok(f.last(), 'health leaves the Transit response available');
  f.module.listenToTransitReminders((value: any) => travel.push(value));
  assert.deepEqual(travel, [{ kind: 'reminder', journeyId: 'one', expired: true }]);
  assert.equal(health.length, 0);
  assert.equal(f.last(), null);
});

test('a trip in progress shows each event once and holds its warnings apart from reminders', async (t) => {
  const f = await fixture();
  t.mock.method(Date, 'now', f.now);
  const trip = { id: 'abc' } as any;
  await f.module.syncTransitReminders(f.db, f.trip, [f.reminder('leave', 600_000)]);
  await f.module.syncTripAlarms(
    f.db,
    trip,
    [{ key: 'alight:0', at: f.now() + 120_000, title: 'Bájate pronto', body: 'Parada' }],
    true,
  );
  assert.deepEqual([...f.pending.keys()].sort(), ['transit:one:leave', 'trip:abc:alight:0']);
  assert.equal(f.pending.get('trip:abc:alight:0').content.data.notificationOwner, 'trip');
  // The GPS warning replaces the held one under the same identifier.
  const event = { key: 'alight:0', kind: 'alight', title: 'Bájate en la próxima', body: 'Parada' };
  await f.module.presentTripEvents(f.db, trip, [event], false);
  await f.module.presentTripEvents(f.db, trip, [event], false);
  assert.equal(f.presented.length, 1);
  assert.equal(f.presented[0].request.content.sound, false);
  await f.module.syncTripAlarms(f.db, trip, [], true);
  assert.deepEqual([...f.pending.keys()], ['transit:one:leave']);
  await f.module.syncTripAlarms(f.db, null, [], true);
  assert.deepEqual([...f.pending.keys()], ['transit:one:leave']);
  const routed: any[] = [];
  f.module.listenToTransitReminders((value: any) => routed.push(value));
  for (const listener of f.listeners)
    listener({
      actionIdentifier: 'default',
      notification: {
        request: { content: { data: { notificationOwner: 'trip', tripId: 'abc' } } },
      },
    });
  assert.deepEqual(routed, [{ kind: 'trip', tripId: 'abc' }]);
});

test('a dismissed scheduled trip warning stays consumed across later predictions', async (t) => {
  const f = await fixture();
  t.mock.method(Date, 'now', f.now);
  const trip = { id: 'trip' } as any;
  const alarm = { key: 'alight:0', at: f.now() + 60_000, title: 'Bájate pronto', body: 'Parada' };
  await f.module.syncTripAlarms(f.db, trip, [alarm], true);
  f.advance(61_000);
  // iOS delivered it and he dismissed it: neither pending nor presented remembers it.
  f.pending.clear();
  await f.module.syncTripAlarms(f.db, trip, [{ ...alarm, at: f.now() + 60_000 }], true);
  await f.module.presentTripEvents(f.db, trip, [{ ...alarm, kind: 'alight' }], true);
  assert.equal(f.pending.size, 0);
  assert.equal(f.presented.length, 0);
  // An explicit boarding correction creates a new event, unlike a passive prediction change.
  await f.module.presentTripEvents(
    f.db,
    trip,
    [{ ...alarm, key: 'alight:0:1', kind: 'alight' }],
    true,
  );
  assert.equal(f.presented.length, 1);
  f.presented.length = 0;
  await f.module.presentTripEvents(
    f.db,
    trip,
    [{ ...alarm, key: 'alight:0:1', kind: 'alight' }],
    true,
  );
  assert.equal(f.presented.length, 0);
});
