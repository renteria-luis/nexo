import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addDays } from '../core/dates.ts';

import { trainingWeekStreak } from './history.ts';

/** Sessions on the given weekdays (1 = Monday) of the week starting that Monday. */
function week(monday: string, ...days: number[]): string[] {
  return days.map((day) => addDays(monday, day - 1));
}

// Friday October 9, 2026; its week starts Monday October 5.
const TODAY = '2026-10-09';

test('full Monday-to-Sunday weeks in a row make the training streak', () => {
  const dates = [
    ...week('2026-09-14', 1, 2, 3, 4), // four: breaks the run
    ...week('2026-09-21', 1, 2, 3, 5, 7),
    ...week('2026-09-28', 1, 2, 4, 5, 6, 7),
    ...week('2026-10-05', 1, 3), // this week, still going
  ];
  assert.equal(trainingWeekStreak(dates, TODAY), 2);
});

test('this week adds once it reaches five and never breaks the run before', () => {
  const before = [...week('2026-09-28', 1, 2, 3, 4, 5)];
  assert.equal(trainingWeekStreak(before, TODAY), 1);
  assert.equal(trainingWeekStreak([...before, ...week('2026-10-05', 1, 2, 3, 4, 5)], TODAY), 2);
  assert.equal(trainingWeekStreak(week('2026-10-05', 1, 2, 3, 4, 5), TODAY), 1);
});

test('a short last week ends the streak, and nothing ahead of today counts', () => {
  const dates = [...week('2026-09-21', 1, 2, 3, 4, 5), ...week('2026-09-28', 1, 2, 3, 4)];
  assert.equal(trainingWeekStreak(dates, TODAY), 0);
  assert.equal(trainingWeekStreak(week('2026-10-05', 1, 2, 3, 6, 7), TODAY), 0);
  assert.equal(trainingWeekStreak([], TODAY), 0);
});
