import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addDays,
  daysBetween,
  isWithin,
  todayIso,
  trailingDays,
  weekEnd,
  weekRange,
  weekStart,
  weekday,
  shortDate,
} from './dates.ts';

test('weeks run Monday to Sunday', () => {
  // 2026-09-13 is a Sunday.
  assert.equal(weekday('2026-09-13'), 7);
  assert.equal(weekStart('2026-09-13'), '2026-09-07');
  assert.equal(weekEnd('2026-09-13'), '2026-09-13');

  // 2026-09-14 is the Monday that starts the next week.
  assert.equal(weekday('2026-09-14'), 1);
  assert.equal(weekStart('2026-09-14'), '2026-09-14');
  assert.equal(weekEnd('2026-09-14'), '2026-09-20');
});

test('a Monday is its own week start', () => {
  assert.equal(weekStart('2026-09-07'), '2026-09-07');
  assert.deepEqual(weekRange('2026-09-07'), { from: '2026-09-07', to: '2026-09-13' });
});

test('day arithmetic crosses months and years', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('day arithmetic handles a leap year', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

test('a daylight saving change does not shift a day', () => {
  // Canada moves the clock on the second Sunday in March and the first in November.
  assert.equal(addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(daysBetween('2026-10-31', '2026-11-02'), 2);
});

test('daysBetween counts in both directions', () => {
  assert.equal(daysBetween('2026-09-07', '2026-09-13'), 6);
  assert.equal(daysBetween('2026-09-13', '2026-09-07'), -6);
  assert.equal(daysBetween('2026-09-13', '2026-09-13'), 0);
});

test('a trailing window includes the day it ends on', () => {
  assert.deepEqual(trailingDays('2026-09-13', 7), { from: '2026-09-07', to: '2026-09-13' });
  assert.deepEqual(trailingDays('2026-09-13', 1), { from: '2026-09-13', to: '2026-09-13' });
  // Spec 6.3 compares against the last 8 weeks.
  assert.deepEqual(trailingDays('2026-09-13', 56), { from: '2026-07-20', to: '2026-09-13' });
});

test('a trailing window of less than a day is a mistake, not an empty range', () => {
  assert.throws(() => trailingDays('2026-09-13', 0), /at least one whole day/);
  assert.throws(() => trailingDays('2026-09-13', -3), /at least one whole day/);
});

test('a malformed or impossible date fails loudly', () => {
  assert.throws(() => addDays('13-09-2026', 1), /not a YYYY-MM-DD date/);
  assert.throws(() => addDays('2026-9-13', 1), /not a YYYY-MM-DD date/);
  assert.throws(() => addDays('2026-02-31', 1), /not a date that exists/);
  assert.throws(() => addDays('2026-13-01', 1), /not a date that exists/);
});

test('isWithin includes both ends', () => {
  const range = { from: '2026-09-07', to: '2026-09-13' };
  assert.equal(isWithin('2026-09-07', range), true);
  assert.equal(isWithin('2026-09-13', range), true);
  assert.equal(isWithin('2026-09-06', range), false);
  assert.equal(isWithin('2026-09-14', range), false);
});

test('today is read in local time, not UTC', () => {
  // Late evening local time is already the next day in UTC. The day the owner
  // logged a session on is the local one.
  const lateEvening = new Date(2026, 8, 13, 23, 30, 0);
  assert.equal(todayIso(lateEvening), '2026-09-13');
});

test('a date reads with the month in letters, never as two numbers', () => {
  assert.equal(shortDate('2026-08-08'), '08-ago-2026');
  assert.equal(shortDate('2026-01-31'), '31-ene-2026');
  assert.equal(shortDate('2026-12-01'), '01-dic-2026');
  assert.throws(() => shortDate('2026-13-01'), /is not a date/);
});
