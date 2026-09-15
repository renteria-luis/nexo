import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CoreDailyLogRow } from '../db/types.ts';

import { addDays } from './dates.ts';
import { nextStepTarget, stepsAdvice, STEP_STAGES } from './steps.ts';

const TODAY = '2026-09-15';

function log(date: string, steps: number | null): CoreDailyLogRow {
  return {
    date,
    water_ml: null,
    creatine_taken: null,
    alcohol_drinks: null,
    alcohol_after_training: null,
    cannabis: null,
    sleep_minutes: null,
    sleep_source: null,
    resting_hr: null,
    hrv_ms: null,
    steps,
    weight_kg: null,
    score: null,
    has_data: 1,
  };
}

/** `perWeek` days of each of the last three weeks reach the target. */
function history(perWeek: number, steps = 7400): CoreDailyLogRow[] {
  const logs: CoreDailyLogRow[] = [];
  for (let day = 0; day < 21; day += 1) {
    const inWeek = day % 7;
    logs.push(log(addDays(TODAY, -day), inWeek < perWeek ? steps : 3000));
  }
  return logs;
}

test('the ladder climbs and then stops', () => {
  assert.deepEqual([...STEP_STAGES], [7000, 8500, 10000]);
  assert.equal(nextStepTarget(7000), 8500);
  assert.equal(nextStepTarget(8500), 10000);
  assert.equal(nextStepTarget(10000), null);
});

test('three weeks of five days each earns the next stage', () => {
  assert.deepEqual(stepsAdvice(history(5), 7000, TODAY), {
    current: 7000,
    next: 8500,
    weeksMet: 3,
  });
});

test('four days in a week is not a week', () => {
  assert.equal(stepsAdvice(history(4), 7000, TODAY), null);
});

test('a week that only just fell short breaks the run', () => {
  const logs = history(5);
  // One day of the oldest week drops below the target.
  const stale = logs.map((entry) =>
    entry.date === addDays(TODAY, -14) ? log(entry.date, 3000) : entry,
  );
  assert.equal(stepsAdvice(stale, 7000, TODAY), null);
});

test('days without a step count do not count as met', () => {
  const logs = history(5).map((entry) => (entry.steps === 7400 ? log(entry.date, null) : entry));
  assert.equal(stepsAdvice(logs, 7000, TODAY), null);
});

test('nothing is offered at the top of the ladder', () => {
  assert.equal(stepsAdvice(history(7, 12000), 10000, TODAY), null);
});
