import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  coordinateNotifications,
  ownedNotificationChanges,
  type PendingNotice,
} from './notification-plan.ts';

const notice = (identifier: string, data: Record<string, unknown> = {}): PendingNotice => ({
  identifier,
  content: { data },
});
test('health cancellation adopts old nudge IDs but preserves Transit and unknown requests', () => {
  const pending = [
    notice('creatina-22', { nudgeId: 'creatina-22' }),
    notice('transit:trip:leave'),
    notice('unknown'),
  ];
  assert.deepEqual(ownedNotificationChanges(pending, [], 'health').cancel, ['creatina-22']);
  assert.deepEqual(ownedNotificationChanges(pending, [], 'transit').cancel, ['transit:trip:leave']);
});
test('unchanged requests survive a sync; a new prediction replaces only that event', () => {
  const first = notice('transit:trip:prepare', { planSignature: 'a' });
  const old = notice('transit:trip:leave', { planSignature: 'b' });
  const next = notice('transit:trip:leave', { planSignature: 'c' });
  assert.deepEqual(ownedNotificationChanges([first, old], [first, next], 'transit'), {
    cancel: [old.identifier],
    schedule: [next],
  });
});
test('ownership, duplicate IDs and OS capacity are checked before touching existing requests', () => {
  assert.throws(() => ownedNotificationChanges([], [notice('unknown')], 'transit'), /ownership/);
  const trip = notice('transit:trip:leave');
  assert.throws(() => ownedNotificationChanges([], [trip, trip], 'transit'), /Duplicate/);
  const full = Array.from({ length: 64 }, (_, i) => notice(`other-${i}`));
  assert.throws(() => ownedNotificationChanges(full, [trip], 'transit'), /espacio/);
});
test('overlapping module syncs serialize, and a rejected sync does not block the next', async () => {
  const calls: string[] = [];
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const a = coordinateNotifications(async () => {
    calls.push('health');
    await wait;
    calls.push('health-done');
  });
  const b = coordinateNotifications(async () => {
    calls.push('transit');
    throw new Error('native failure');
  });
  const rejected = assert.rejects(b, /native failure/);
  const c = coordinateNotifications(async () => {
    calls.push('retry');
  });
  await Promise.resolve();
  assert.deepEqual(calls, ['health']);
  release();
  await Promise.all([a, rejected, c]);
  assert.deepEqual(calls, ['health', 'health-done', 'transit', 'retry']);
});
