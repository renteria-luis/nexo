import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ageOn,
  computeTargets,
  fatBand,
  kcalBand,
  needsRecalculation,
  proteinBand,
  rollingWeightAverage,
  type TargetProfile,
} from './targets.ts';

// The figures spec 3.1 works through, kept here rather than in source because the
// repository is public.
const profile: TargetProfile = {
  heightCm: 170,
  birthDate: '1996-08-30',
  activityFactor: 1.55,
  phase: 'recomp',
  sleepMinutes: 420,
  steps: 7000,
};

function close(actual: number, expected: number, tolerance = 0.5): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test('age rolls over on the birthday and not before', () => {
  assert.equal(ageOn('1996-08-30', '2026-08-29'), 29);
  assert.equal(ageOn('1996-08-30', '2026-08-30'), 30);
  assert.equal(ageOn('1996-08-30', '2026-09-13'), 30);
  assert.equal(ageOn('1996-08-30', '2027-08-29'), 30);
});

test('age handles a birthday on the 29th of February', () => {
  assert.equal(ageOn('2000-02-29', '2026-02-28'), 25);
  assert.equal(ageOn('2000-02-29', '2026-03-01'), 26);
  assert.equal(ageOn('2000-02-29', '2028-02-29'), 28);
});

test('a date before the birth date is a mistake', () => {
  assert.throws(() => ageOn('1996-08-30', '1990-01-01'), /before the birth date/);
});

test('BMR matches the Mifflin-St Jeor figure in spec 3.1', () => {
  const targets = computeTargets(73, profile, '2026-09-13');
  // 730 + 1062.5 - 150 + 5
  close(targets.bmr, 1647.5, 0.01);
});

test('maintenance lands in the range spec 3.1 gives', () => {
  const low = computeTargets(73, { ...profile, activityFactor: 1.55 }, '2026-09-13');
  const high = computeTargets(73, { ...profile, activityFactor: 1.6 }, '2026-09-13');
  close(low.tdee, 2550, 30);
  close(high.tdee, 2640, 30);
});

test('the recomposition target is about 8 percent under maintenance', () => {
  const targets = computeTargets(73, profile, '2026-09-13');
  close(targets.kcal, 2400, 55);
  close(targets.kcal / targets.tdee, 0.92, 0.001);
});

test('each phase applies its own multiplier', () => {
  const at = (phase: TargetProfile['phase']) =>
    computeTargets(73, { ...profile, phase }, '2026-09-13').kcal;

  assert.ok(at('cut') < at('recomp'));
  assert.ok(at('recomp') < at('maintain'));
  assert.ok(at('maintain') < at('bulk'));
});

test('the macros add back up to the calorie target', () => {
  const targets = computeTargets(73, profile, '2026-09-13');
  const fromMacros = targets.proteinG * 4 + targets.fatG * 9 + targets.carbsG * 4;
  close(fromMacros, targets.kcal, 6);
});

test('the protein band reproduces the worked example in spec 3.6', () => {
  // "peso promedio 74.2 kg -> proteina 133-163 g"
  const targets = computeTargets(74.2, profile, '2026-09-13');
  assert.deepEqual(proteinBand(targets), { from: 133, to: 163 });
});

test('the calorie band follows the target instead of staying at 2400', () => {
  const targets = computeTargets(73, profile, '2026-09-13');
  const band = kcalBand(targets);

  assert.equal(band.fullTo - band.fullFrom, 300);
  assert.equal(band.partialTo - band.partialFrom, 600);
  assert.equal(band.fullFrom, targets.kcal - 150);

  const heavier = computeTargets(85, profile, '2026-09-13');
  assert.ok(kcalBand(heavier).fullFrom > band.fullFrom);
});

test('the fat floor wins when energy alone would put it lower', () => {
  const targets = computeTargets(73, profile, '2026-09-13');
  const band = fatBand(targets);

  assert.equal(band.hardFloor, 58);
  assert.ok(band.from >= band.hardFloor);
  assert.ok(band.to > band.from);

  // On a deep cut, 25% of energy falls under 0.8 g per kg and the floor takes over.
  const cutting = computeTargets(
    73,
    { ...profile, phase: 'cut', activityFactor: 1.2 },
    '2026-09-13',
  );
  assert.equal(fatBand(cutting).from, fatBand(cutting).hardFloor);
});

test('water is 2.8 L on a rest day and 3.5 L on a training day', () => {
  const targets = computeTargets(73, profile, '2026-09-13');
  assert.equal(targets.waterMlRest, 2800);
  assert.equal(targets.waterMlTraining, 3500);
});

test('the rolling weight average needs four weigh-ins in the window', () => {
  const threeDays = [
    { date: '2026-09-11', weightKg: 73 },
    { date: '2026-09-12', weightKg: 74 },
    { date: '2026-09-13', weightKg: 75 },
  ];
  assert.equal(rollingWeightAverage(threeDays, '2026-09-13'), null);

  const fourDays = [...threeDays, { date: '2026-09-10', weightKg: 74 }];
  assert.equal(rollingWeightAverage(fourDays, '2026-09-13'), 74);
});

test('the rolling average ignores days outside the window and days without a weight', () => {
  const weighIns = [
    { date: '2026-09-06', weightKg: 100 },
    { date: '2026-09-07', weightKg: 72 },
    { date: '2026-09-09', weightKg: 74 },
    { date: '2026-09-11', weightKg: null },
    { date: '2026-09-12', weightKg: 73 },
    { date: '2026-09-13', weightKg: 73 },
  ];
  assert.equal(rollingWeightAverage(weighIns, '2026-09-13'), 73);
});

test('recalculation triggers at a kilo of drift, not before', () => {
  assert.equal(needsRecalculation(73, 73.9), false);
  assert.equal(needsRecalculation(73, 74.0), true);
  assert.equal(needsRecalculation(73, 72.0), true);
  // Not enough weigh-ins to know: no trigger, rather than a trigger against zero.
  assert.equal(needsRecalculation(73, null), false);
});
