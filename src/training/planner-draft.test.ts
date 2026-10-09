import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  freshPlannerDraft,
  parsePlannerDraft,
  serializePlannerDraft,
  withPlannerEdits,
  type PlannerDraft,
} from './planner-draft.ts';
import type { PlannedExercise } from './routines.ts';

const draft: PlannerDraft = {
  date: '2026-10-09',
  routineId: 'legs',
  gymId: 'fit4less',
  company: 'with_someone',
  budget: 'minus_25',
  edits: {
    plan: '["legs","minus_25","fit4less"]',
    exercises: [
      { exerciseId: 'hack-squat', sets: 4, position: 1 },
      { exerciseId: 'adductor', sets: 2, position: 2 },
    ],
  },
};

function planned(exerciseId: string, position: number, sets = 3): PlannedExercise {
  return {
    exerciseId,
    name: exerciseId,
    unilateral: false,
    position,
    tier: 1,
    sets,
    repMode: 'range',
    repMin: 8,
    repMax: 12,
    restSeconds: 120,
  };
}

test('the same day restores every choice', () => {
  assert.deepEqual(parsePlannerDraft(serializePlannerDraft(draft), '2026-10-09'), draft);
});

test('another day keeps only the gym, with Solo and the full budget again', () => {
  assert.deepEqual(
    parsePlannerDraft(serializePlannerDraft(draft), '2026-10-10'),
    freshPlannerDraft('2026-10-10', 'fit4less'),
  );
  assert.equal(freshPlannerDraft('2026-10-10').company, 'alone');
});

test('nothing stored, broken text or unknown values fall back to the defaults', () => {
  assert.deepEqual(parsePlannerDraft(undefined, '2026-10-09'), freshPlannerDraft('2026-10-09'));
  assert.deepEqual(parsePlannerDraft('{not json', '2026-10-09'), freshPlannerDraft('2026-10-09'));
  const odd = parsePlannerDraft(
    JSON.stringify({
      ...draft,
      company: 'everyone',
      budget: 'forever',
      edits: { plan: 'x', exercises: [{ exerciseId: 'a', sets: -1, position: 1 }] },
    }),
    '2026-10-09',
  );
  assert.equal(odd.company, 'alone');
  assert.equal(odd.budget, 'completo');
  assert.equal(odd.edits, null);
  assert.equal(odd.routineId, 'legs');
});

test('serializing ignores everything but order, sets and position', () => {
  const full = { ...draft, edits: { plan: 'p', exercises: [planned('press', 1, 2)] } };
  assert.equal(
    serializePlannerDraft(full),
    serializePlannerDraft({
      ...draft,
      edits: { plan: 'p', exercises: [{ exerciseId: 'press', sets: 2, position: 1 }] },
    }),
  );
});

test('saved edits reorder the fresh plan and keep its other details', () => {
  const restored = withPlannerEdits(
    [planned('adductor', 1), planned('hack-squat', 2)],
    draft.edits!.exercises,
  );
  assert.deepEqual(
    restored?.map(({ exerciseId, sets, position, restSeconds }) => [
      exerciseId,
      sets,
      position,
      restSeconds,
    ]),
    [
      ['hack-squat', 4, 1, 120],
      ['adductor', 2, 2, 120],
    ],
  );
});

test('edits for a plan that no longer has the same exercises are dropped', () => {
  const edits = draft.edits!.exercises;
  assert.equal(withPlannerEdits([planned('hack-squat', 1)], edits), null);
  assert.equal(withPlannerEdits([planned('hack-squat', 1), planned('leg-curl', 2)], edits), null);
  assert.equal(
    withPlannerEdits(
      [planned('hack-squat', 1), planned('adductor', 2)],
      [edits[0], { ...edits[0], position: 2 }],
    ),
    null,
  );
});
