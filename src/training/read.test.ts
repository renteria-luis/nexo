import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readWorkoutFinish } from './read.ts';
import { analyzeTiming, remainingEstimate, type SessionTiming } from './timing.ts';
import type { TrainingSessionRow } from '../db/types.ts';

const now = Date.UTC(2026, 9, 13, 18);
const session: TrainingSessionRow = {
  id: 'session',
  date: '2026-10-13',
  start_time: now - 600_000,
  end_time: null,
  gym_id: 'gym',
  routine_id: 'push',
  alone_or_partner: 'alone',
  time_budget: 'completo',
  crowding: null,
  is_retroactive: 0,
  notes: null,
  duration_trusted: 0,
};
const plan = [{ exerciseId: 'press', position: 0, sets: 4, restSeconds: 120 }];
const catalog = [{ id: 'press', equipment_type: 'machine', unilateral: 0 }];
const data: SessionTiming = { session, sets: [], history: [], exercises: [] };

test('the read interface exactly reuses Training ETA and preserves initial confidence', () => {
  const before = JSON.stringify({ data, plan, catalog });
  const result = readWorkoutFinish(data, plan, catalog, now);
  assert.equal(result.finishAt, now + remainingEstimate(data, plan, catalog, now).seconds * 1000);
  assert.equal(result.evidence, 'initial');
  assert.equal(result.remainingSets, 4);
  assert.equal(JSON.stringify({ data, plan, catalog }), before);
});
test('limited history remains limited, complete Training stops estimating and a missing plan is unknown', () => {
  const history = [
    {
      sessionId: 'prior',
      date: '2026-10-12',
      exerciseId: 'press',
      implement: 'machine',
      sets: 4,
      samples: 3,
      flagged: 0,
      minutes: 12,
    },
  ];
  const learned = { ...data, history, exercises: analyzeTiming(session, [], history) };
  assert.equal(readWorkoutFinish(learned, plan, catalog, now).evidence, 'limited');
  assert.equal(readWorkoutFinish(learned, [], catalog, now).finishAt, null);
  const finished = readWorkoutFinish(
    { ...learned, session: { ...session, end_time: now - 1000 } },
    plan,
    catalog,
    now,
  );
  assert.equal(finished.finishAt, now - 1000);
  assert.equal(finished.evidence, 'complete');
});

test('the final planned set fixes completion time instead of postponing preparation on every clock tick', () => {
  const completed: SessionTiming = {
    ...data,
    sets: Array.from({ length: 4 }, (_, i) => ({
      id: String(i),
      exerciseId: 'press',
      implement: 'machine',
      setIndex: i + 1,
      timestamp: now - (4 - i) * 60_000,
      warmup: false,
      eligible: true,
      review: 'auto',
      correctedSeconds: null,
    })),
  };
  const result = readWorkoutFinish(completed, plan, catalog, now);
  assert.equal(result.evidence, 'complete');
  assert.equal(result.finishAt, now - 60_000);
  assert.equal(
    readWorkoutFinish(completed, plan, catalog, now + 120_000).finishAt,
    result.finishAt,
  );
});
