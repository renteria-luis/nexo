import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CRITERION_WEIGHTS,
  advanceConsecutiveMissed,
  alcoholPointsLost,
  currentStreak,
  isScheduledToday,
  longestStreak,
  missedTrainingPenalty,
  scoreDay,
  trainingDebt,
  type DisciplineDay,
  type TrainingContext,
} from './discipline.ts';
import { MINIMUM_CRITERIA_WITH_DATA } from './scoring.ts';
import { computeTargets, type TargetProfile } from './targets.ts';

const profile: TargetProfile = {
  heightCm: 170,
  birthDate: '1996-08-30',
  activityFactor: 1.55,
  phase: 'recomp',
  sleepMinutes: 420,
  steps: 7000,
};

const targets = computeTargets(73, profile, '2026-09-13');

const perfectDay: DisciplineDay = {
  trained: true,
  sleepMinutes: 450,
  proteinG: 145,
  kcal: targets.kcal,
  alcoholDrinks: 0,
  alcoholWithinSixHoursAfterTraining: false,
  waterMl: 3500,
  steps: 8000,
  creatineTaken: true,
  isTrainingDay: true,
};

const onTrack: TrainingContext = {
  sessionsLastSevenDays: 5,
  consecutiveMissed: 0,
  isScheduledRestDay: false,
  reEntryActive: false,
};

function close(actual: number | null, expected: number, tolerance = 0.01): void {
  assert.ok(actual !== null, 'expected a score, got null');
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test('the weights in spec 4.1 add up to 100', () => {
  const total = Object.values(CRITERION_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  assert.equal(total, 100);
});

test('a day that hits everything scores 100', () => {
  close(scoreDay(perfectDay, targets, onTrack).score, 100);
});

test('missing the training day costs its 22 points', () => {
  const day = { ...perfectDay, trained: false };
  // Already at five sessions, so today is optional and carries no penalty.
  close(scoreDay(day, targets, onTrack).score, 78);
});

test('criteria without data leave both sides of the fraction', () => {
  const day: DisciplineDay = {
    ...perfectDay,
    proteinG: null,
    kcal: null,
    steps: null,
    waterMl: null,
    creatineTaken: null,
  };
  // Trained, sleep and alcohol logged, all full: 52 of a possible 52.
  close(scoreDay(day, targets, onTrack).score, 100);
});

test('a day with too little logged has no score at all', () => {
  const day: DisciplineDay = {
    ...perfectDay,
    proteinG: null,
    kcal: null,
    steps: null,
    waterMl: null,
    creatineTaken: null,
    alcoholDrinks: null,
  };
  const result = scoreDay(day, targets, onTrack);
  assert.equal(result.score, null);
  assert.ok(result.criteriaWithData < MINIMUM_CRITERIA_WITH_DATA);
});

test('sleep is scored linearly between six and seven hours', () => {
  const at = (minutes: number) =>
    scoreDay({ ...perfectDay, sleepMinutes: minutes }, targets, onTrack).score;

  close(at(420), 100);
  close(at(360), 80); // Zero of the twenty sleep points.
  close(at(330), 80); // Below six hours is the same zero, not worse.
  close(at(390), 90); // Halfway through the hour earns half the twenty.
});

test('under-eating misses the calorie band just as over-eating does', () => {
  const under = scoreDay({ ...perfectDay, kcal: targets.kcal - 400 }, targets, onTrack).score;
  const over = scoreDay({ ...perfectDay, kcal: targets.kcal + 400 }, targets, onTrack).score;
  assert.equal(under, over);
  close(under, 90);
});

test('the alcohol scale follows the doses in spec 4.2', () => {
  assert.equal(alcoholPointsLost(0, false), 0);
  assert.equal(alcoholPointsLost(2, false), 2);
  assert.equal(alcoholPointsLost(4, false), 5);
  assert.equal(alcoholPointsLost(7, false), 8);
  assert.equal(alcoholPointsLost(12, false), 10);
});

test('drinking after training costs half again, capped at the criterion', () => {
  assert.equal(alcoholPointsLost(2, true), 3);
  assert.equal(alcoholPointsLost(4, true), 7.5);
  assert.equal(alcoholPointsLost(7, true), 10);
  assert.equal(alcoholPointsLost(12, true), 10);
});

test('a twelve drink night costs about half a training day', () => {
  const binge = scoreDay({ ...perfectDay, alcoholDrinks: 12 }, targets, onTrack).score;
  const missedSession = scoreDay({ ...perfectDay, trained: false }, targets, onTrack).score;

  assert.ok(binge !== null && missedSession !== null);
  assert.equal(100 - binge, 10);
  assert.equal(100 - missedSession, 22);
});

test('falling behind creates debt, catching up clears it', () => {
  assert.equal(trainingDebt(3), 2);
  assert.equal(isScheduledToday(3), true);
  assert.equal(trainingDebt(5), 0);
  assert.equal(isScheduledToday(5), false);
  assert.equal(isScheduledToday(6), false);
});

test('the miss penalty escalates and then repeats', () => {
  assert.equal(missedTrainingPenalty(0), 0);
  assert.equal(missedTrainingPenalty(1), -8);
  assert.equal(missedTrainingPenalty(2), -18);
  assert.equal(missedTrainingPenalty(3), -30);
  assert.equal(missedTrainingPenalty(4), -45);
  assert.equal(missedTrainingPenalty(5), -60);
  assert.equal(missedTrainingPenalty(9), -60);
});

test('the penalty applies against the score and the day floors at zero', () => {
  const behind: TrainingContext = {
    sessionsLastSevenDays: 2,
    consecutiveMissed: 2,
    isScheduledRestDay: false,
    reEntryActive: false,
  };
  const day = { ...perfectDay, trained: false };
  const result = scoreDay(day, targets, behind);

  assert.equal(result.penalty, -30);
  close(result.base, 78);
  close(result.score, 48);

  const deepInTheHole = scoreDay(day, targets, { ...behind, consecutiveMissed: 5 });
  assert.equal(deepInTheHole.score, 18);
});

test('a scheduled rest day is scored on everything else and penalised on nothing', () => {
  const resting: TrainingContext = {
    sessionsLastSevenDays: 2,
    consecutiveMissed: 3,
    isScheduledRestDay: true,
    reEntryActive: false,
  };
  const result = scoreDay({ ...perfectDay, trained: false }, targets, resting);
  assert.equal(result.penalty, 0);
  assert.equal(result.missedScheduledSession, false);
  close(result.score, 78);
});

test('re-entry mode suppresses the penalty but not the scoring', () => {
  const readapting: TrainingContext = {
    sessionsLastSevenDays: 1,
    consecutiveMissed: 4,
    isScheduledRestDay: false,
    reEntryActive: true,
  };
  const result = scoreDay({ ...perfectDay, trained: false }, targets, readapting);
  assert.equal(result.penalty, 0);
  close(result.score, 78);
});

test('the run of misses resets on the first completed session', () => {
  const behind: TrainingContext = {
    sessionsLastSevenDays: 2,
    consecutiveMissed: 3,
    isScheduledRestDay: false,
    reEntryActive: false,
  };

  const missed = scoreDay({ ...perfectDay, trained: false }, targets, behind);
  assert.equal(advanceConsecutiveMissed(3, missed), 4);

  const trained = scoreDay({ ...perfectDay, trained: true }, targets, behind);
  assert.equal(advanceConsecutiveMissed(3, trained), 0);
});

test('water is judged against the training day target on a training day', () => {
  const rest = scoreDay(
    { ...perfectDay, isTrainingDay: false, waterMl: 2800 },
    targets,
    onTrack,
  ).score;
  const training = scoreDay(
    { ...perfectDay, isTrainingDay: true, waterMl: 2800 },
    targets,
    onTrack,
  ).score;

  close(rest, 100);
  assert.ok(training !== null && training < 100);
});

test('streaks count days at seventy or better and stop at a gap', () => {
  assert.equal(currentStreak([80, 90, 75]), 3);
  assert.equal(currentStreak([80, 60, 75]), 1);
  assert.equal(currentStreak([80, 90, null]), 0);
  assert.equal(currentStreak([]), 0);

  assert.equal(longestStreak([80, 90, 60, 75, 75, 75, 40]), 3);
  assert.equal(longestStreak([null, null]), 0);
});
