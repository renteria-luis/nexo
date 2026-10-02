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

// A made-up profile. The repository is public, so the owner's own figures stay in the
// spec, which is not.
const profile: TargetProfile = {
  heightCm: 180,
  birthDate: '1990-01-15',
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
  assert.equal(ageOn('1990-01-15', '2026-01-14'), 35);
  assert.equal(ageOn('1990-01-15', '2026-01-15'), 36);
  assert.equal(ageOn('1990-01-15', '2026-09-13'), 36);
  assert.equal(ageOn('1990-01-15', '2027-01-14'), 36);
});

test('age handles a birthday on the 29th of February', () => {
  assert.equal(ageOn('2000-02-29', '2026-02-28'), 25);
  assert.equal(ageOn('2000-02-29', '2026-03-01'), 26);
  assert.equal(ageOn('2000-02-29', '2028-02-29'), 28);
});

test('a date before the birth date is a mistake', () => {
  assert.throws(() => ageOn('1990-01-15', '1989-12-31'), /before the birth date/);
});

test('BMR follows the Mifflin-St Jeor formula of spec 3.1', () => {
  const targets = computeTargets(80, profile, '2026-09-13');
  // 800 + 1125 - 180 + 5
  close(targets.bmr, 1750, 0.01);
});

test('maintenance is BMR times the activity factor', () => {
  const low = computeTargets(80, { ...profile, activityFactor: 1.55 }, '2026-09-13');
  const high = computeTargets(80, { ...profile, activityFactor: 1.6 }, '2026-09-13');
  close(low.tdee, 2712.5, 0.01);
  close(high.tdee, 2800, 0.01);
});

test('the recomposition target is about 8 percent under maintenance', () => {
  const targets = computeTargets(80, profile, '2026-09-13');
  close(targets.kcal, 2496, 0.01);
  close(targets.kcal / targets.tdee, 0.92, 0.001);
});

test('each phase applies its own multiplier', () => {
  const at = (phase: TargetProfile['phase']) =>
    computeTargets(80, { ...profile, phase }, '2026-09-13').kcal;

  assert.ok(at('cut') < at('recomp'));
  assert.ok(at('recomp') < at('maintain'));
  assert.ok(at('maintain') < at('bulk'));
});

test('the macros add back up to the calorie target', () => {
  const targets = computeTargets(80, profile, '2026-09-13');
  const fromMacros = targets.proteinG * 4 + targets.fatG * 9 + targets.carbsG * 4;
  close(fromMacros, targets.kcal, 6);
});

test('the protein band runs from 1.8 to 2.2 g per kg, floored as in spec 3.6', () => {
  // 146.16 to 178.64: rounding would make the top 179.
  const targets = computeTargets(81.2, profile, '2026-09-13');
  assert.deepEqual(proteinBand(targets), { from: 146, to: 178 });
});

test('the calorie band follows the target instead of staying fixed', () => {
  const targets = computeTargets(80, profile, '2026-09-13');
  const band = kcalBand(targets);

  assert.equal(band.from, targets.kcal - 150);
  // Decision del dueno (2026-09-30): 400 mas por arriba. Lo que le pasa es quedarse
  // corto, asi que comer de mas no puede pintarse como un dia fuera de sitio.
  assert.equal(band.to, targets.kcal + 550);

  const heavier = computeTargets(85, profile, '2026-09-13');
  assert.ok(kcalBand(heavier).from > band.from);
});

test('la banda de calorias es la que el pidio ver: 150 por debajo y 550 por encima', () => {
  // 2 513 de meta: de 2 363 a 3 063, y no a 2 663.
  const targets = computeTargets(81.2, profile, '2026-09-13');
  assert.equal(kcalBand(targets).from, targets.kcal - 150);
  assert.equal(kcalBand(targets).to, targets.kcal + 550);
  assert.equal(kcalBand(targets).to - kcalBand(targets).from, 700);
});

test('the fat floor wins when energy alone would put it lower', () => {
  const targets = computeTargets(80, profile, '2026-09-13');
  const band = fatBand(targets);

  assert.equal(band.hardFloor, 64);
  assert.ok(band.from >= band.hardFloor);
  assert.ok(band.to > band.from);

  // On a deep cut, 25% of energy falls under 0.8 g per kg and the floor takes over.
  const cutting = computeTargets(
    80,
    { ...profile, phase: 'cut', activityFactor: 1.2 },
    '2026-09-13',
  );
  assert.equal(fatBand(cutting).from, fatBand(cutting).hardFloor);
});

test('water is 2.8 L on a rest day and 3.5 L on a training day', () => {
  const targets = computeTargets(80, profile, '2026-09-13');
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
