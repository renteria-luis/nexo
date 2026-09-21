import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bestAndWorstE1rm,
  epleyE1rm,
  setCountsByMuscle,
  topSetE1rm,
  volumeLoad,
  volumeLoadByExercise,
  volumeLoadByMuscle,
  volumeLoadBySession,
  averageRestSeconds,
  estimatedRestSeconds,
  repDropOffs,
  type ExerciseMuscles,
  type LoggedSet,
} from './calculations.ts';

// e1RM is left unrounded so comparisons keep their precision; rounding for
// display belongs to the screen that shows it.
function close(actual: number | null, expected: number): void {
  assert.ok(actual !== null, 'expected a number, got null');
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${actual} to be within 1e-9 of ${expected}`,
  );
}

function set(partial: Partial<LoggedSet> & { weightKg: number; reps: number }): LoggedSet {
  return {
    sessionId: 'session-1',
    date: '2026-09-13',
    exerciseId: 'incline-db-press',
    setIndex: 1,
    ...partial,
  };
}

// The push day from spec 13.1, with the muscles seeded for those exercises.
const pushMuscles: ExerciseMuscles = new Map([
  [
    'incline-db-press',
    [
      { muscle: 'chest', contribution: 1 },
      { muscle: 'front_delts', contribution: 0.5 },
      { muscle: 'triceps', contribution: 0.5 },
    ],
  ],
  ['peck-deck', [{ muscle: 'chest', contribution: 1 }]],
  [
    'seated-chest-press',
    [
      { muscle: 'chest', contribution: 1 },
      { muscle: 'front_delts', contribution: 0.5 },
      { muscle: 'triceps', contribution: 0.5 },
    ],
  ],
]);

test('Epley matches the formula in spec 6.2', () => {
  close(epleyE1rm(100, 5), 116.66666666666667);
  close(epleyE1rm(60, 1), 62);
  close(epleyE1rm(40, 10), 53.333333333333336);
  assert.equal(epleyE1rm(0, 8), 0);
});

test('Epley stops at 12 reps, where spec 6.2 says it degrades', () => {
  assert.notEqual(epleyE1rm(50, 12), null);
  assert.equal(epleyE1rm(50, 13), null);
  assert.equal(epleyE1rm(20, 30), null);
});

test('an impossible set is a mistake, not a zero', () => {
  assert.throws(() => epleyE1rm(-10, 5), /cannot weigh/);
  assert.throws(() => epleyE1rm(50, 0), /cannot have 0 reps/);
  assert.throws(() => epleyE1rm(50, 2.5), /cannot have 2.5 reps/);
});

test('volume load is weight times reps, summed', () => {
  const sets = [set({ weightKg: 30, reps: 8 }), set({ weightKg: 32.5, reps: 6 })];
  assert.equal(volumeLoad(sets), 30 * 8 + 32.5 * 6);
  assert.equal(volumeLoad([]), 0);
});

test('volume load splits by exercise and by session', () => {
  const sets = [
    set({ weightKg: 30, reps: 8 }),
    set({ exerciseId: 'peck-deck', weightKg: 50, reps: 12 }),
    set({ sessionId: 'session-2', exerciseId: 'peck-deck', weightKg: 55, reps: 10 }),
  ];

  assert.deepEqual(
    [...volumeLoadByExercise(sets)],
    [
      ['incline-db-press', 240],
      ['peck-deck', 600 + 550],
    ],
  );
  assert.deepEqual(
    [...volumeLoadBySession(sets)],
    [
      ['session-1', 240 + 600],
      ['session-2', 550],
    ],
  );
});

test('volume load per muscle weights a secondary at half', () => {
  const sets = [set({ weightKg: 30, reps: 10 })];
  const byMuscle = volumeLoadByMuscle(sets, pushMuscles);

  assert.equal(byMuscle.get('chest'), 300);
  assert.equal(byMuscle.get('front_delts'), 150);
  assert.equal(byMuscle.get('triceps'), 150);
});

test('a whole push day reproduces the chest count in spec 13.2', () => {
  // Incline press 3 sets, peck deck 4, seated chest press 3, per spec 13.1.
  const sets = [
    ...Array.from({ length: 3 }, (_, i) =>
      set({ exerciseId: 'incline-db-press', setIndex: i + 1, weightKg: 30, reps: 8 }),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      set({ exerciseId: 'peck-deck', setIndex: i + 1, weightKg: 50, reps: 14 }),
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      set({ exerciseId: 'seated-chest-press', setIndex: i + 1, weightKg: 45, reps: 11 }),
    ),
  ];

  const counts = setCountsByMuscle(sets, pushMuscles);

  // Ten direct chest sets a day, two push days a week, which is the ~20 in spec 13.2.
  assert.deepEqual(counts.get('chest'), { direct: 10, weighted: 10 });

  // Triceps get no direct work on this day but are not untrained either. Spec
  // 13.2 quotes direct sets, spec 13.3 point 3 argues from the same distinction.
  assert.deepEqual(counts.get('triceps'), { direct: 0, weighted: 3 });
  assert.deepEqual(counts.get('front_delts'), { direct: 0, weighted: 3 });
});

test('an exercise with no muscles recorded fails instead of disappearing', () => {
  const sets = [set({ exerciseId: 'unknown-lift', weightKg: 20, reps: 10 })];
  assert.throws(() => setCountsByMuscle(sets, pushMuscles), /has no muscles recorded/);
  assert.throws(() => volumeLoadByMuscle(sets, pushMuscles), /has no muscles recorded/);
});

test('best and worst marks ignore sets above 12 reps', () => {
  const sets = [
    set({ setIndex: 1, weightKg: 30, reps: 8 }),
    set({ setIndex: 2, weightKg: 32.5, reps: 6 }),
    // Heavier on paper but 20 reps, where the estimate does not hold.
    set({ setIndex: 3, weightKg: 40, reps: 20 }),
  ];

  const marks = bestAndWorstE1rm(sets);
  assert.ok(marks);
  assert.equal(marks.best.set.setIndex, 2);
  close(marks.best.e1rm, 39);
  assert.equal(marks.worst.set.setIndex, 1);
  assert.equal(topSetE1rm(sets), marks.best.e1rm);
});

test('a window with nothing under 12 reps has no marks, which is an answer', () => {
  const sets = [set({ weightKg: 50, reps: 15 })];
  assert.equal(bestAndWorstE1rm(sets), null);
  assert.equal(topSetE1rm(sets), null);
  assert.equal(bestAndWorstE1rm([]), null);
});

test('a heavier set at fewer reps can beat a lighter set at more', () => {
  // Spec 6.3: raw weight ignores reps and raw volume ignores intensity, e1RM
  // respects both.
  const sets = [
    set({ setIndex: 1, weightKg: 60, reps: 12 }),
    set({ setIndex: 2, weightKg: 70, reps: 3 }),
  ];
  const marks = bestAndWorstE1rm(sets);
  assert.ok(marks);
  assert.equal(marks.best.set.setIndex, 1);
});

function restSet(setIndex: number, reps: number, restBeforeSeconds: number | null): LoggedSet {
  return {
    sessionId: 's1',
    date: '2026-09-15',
    exerciseId: 'peck-deck',
    setIndex,
    weightKg: 40,
    reps,
    restBeforeSeconds,
  };
}

test('the rest average leaves out the gaps that were not rest', () => {
  assert.equal(
    averageRestSeconds([
      restSet(1, 12, null),
      restSet(2, 11, 90),
      restSet(3, 10, 150),
      // Half an hour between sets is a queue for the machine, not a rest interval.
      restSet(4, 10, 1800),
    ]),
    120,
  );
  assert.equal(averageRestSeconds([restSet(1, 12, null)]), null);
});

test('a drop in reps only counts against the rest when the rest was short', () => {
  const drops = repDropOffs(
    [
      restSet(1, 12, null),
      restSet(2, 10, 60),
      // Above 90% of the first set, so nothing to say.
      restSet(3, 11, 60),
      // Below 90%, but he rested the full two minutes: that is fatigue, not rest.
      restSet(4, 8, 180),
    ],
    120,
  );

  assert.deepEqual(drops, [{ setIndex: 2, reps: 10, firstSetReps: 12, restSeconds: 60 }]);
});

test('the rest estimate takes the set out of the gap between two sets', () => {
  // Once he logged eleven reps, the two minutes on the clock were never two
  // minutes of rest: thirty three seconds of them were the set.
  assert.equal(estimatedRestSeconds(120, 11), 87);
  assert.equal(estimatedRestSeconds(150, 0), 150);
});

test('a gap shorter than the set it contains is zero rest, not negative', () => {
  assert.equal(estimatedRestSeconds(10, 12), 0);
});
