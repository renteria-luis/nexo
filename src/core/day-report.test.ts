import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CoreDailyLogRow } from '../db/types.ts';

import { hoursAndMinutes, reportDay, thousands, type ReportInput } from './day-report.ts';
import { scoreDay, type DisciplineDay } from './discipline.ts';
import { computeTargets, type TargetProfile } from './targets.ts';

const profile: TargetProfile = {
  heightCm: 170,
  birthDate: '1996-08-30',
  activityFactor: 1.55,
  phase: 'recomp',
  sleepMinutes: 420,
  steps: 7000,
};

const targets = computeTargets(74, profile, '2026-09-20');

function log(fields: Partial<CoreDailyLogRow> = {}): CoreDailyLogRow {
  return {
    date: '2026-09-20',
    water_ml: null,
    creatine_taken: null,
    alcohol_drinks: null,
    alcohol_after_training: null,
    cannabis: null,
    sleep_minutes: null,
    sleep_source: null,
    resting_hr: null,
    hrv_ms: null,
    steps: null,
    weight_kg: null,
    score: null,
    has_data: 0,
    rest_day: 0,
    ...fields,
  };
}

function scored(day: Partial<DisciplineDay>) {
  return scoreDay(
    {
      trained: null,
      sleepMinutes: null,
      proteinG: null,
      kcal: null,
      alcoholDrinks: null,
      alcoholWithinSixHoursAfterTraining: false,
      waterMl: null,
      steps: null,
      creatineTaken: null,
      isTrainingDay: false,
      ...day,
    },
    targets,
    {
      sessionsLastSevenDays: 5,
      consecutiveMissed: 0,
      isScheduledRestDay: false,
      reEntryActive: false,
    },
  );
}

const base: ReportInput = {
  result: null,
  log: null,
  targets,
  nutrition: null,
  trained: null,
  isTrainingDay: false,
};

test('every criterion says what he did and what it wanted', () => {
  const report = reportDay({
    ...base,
    result: scored({ trained: true, sleepMinutes: 425, waterMl: 3000, isTrainingDay: true }),
    log: log({ sleep_minutes: 425, water_ml: 3000 }),
    trained: true,
    isTrainingDay: true,
  });

  const sleep = report.lines.find((line) => line.id === 'sleep');
  assert.equal(sleep?.value, '7 h 05');
  assert.equal(sleep?.target, '7 h 00');
  assert.equal(sleep?.earned, 20);

  const training = report.lines.find((line) => line.id === 'trained');
  assert.equal(training?.value, 'entrenó');
  assert.equal(training?.earned, 22);

  // Lo que no anoto queda sin puntos y sin inventar un cero.
  assert.equal(report.lines.find((line) => line.id === 'steps')?.earned, null);
  assert.equal(report.lines.find((line) => line.id === 'steps')?.value, '—');
});

test('a day without targets says it is the profile that is missing', () => {
  const report = reportDay({ ...base, targets: null });
  assert.equal(report.score, null);
  assert.equal(report.noScore, 'sin-metas');
});

test('un dia con metas y nada anotado dice que el vacio es el dia', () => {
  const report = reportDay({ ...base, result: scored({}) });
  assert.equal(report.score, null);
  assert.equal(report.noScore, 'pocos-datos');
  assert.equal(report.criteriaWithData, 0);
});

test('con un solo criterio ya hay nota, y son los puntos de ese criterio', () => {
  const report = reportDay({ ...base, result: scored({ creatineTaken: true }) });
  assert.equal(Math.round(report.score ?? 0), 6);
  assert.equal(report.noScore, null);
  assert.equal(Math.round(report.pointsWithoutData), 94);
});

test('the penalty travels with the report, so the low score can be explained', () => {
  const result = scoreDay(
    {
      trained: false,
      sleepMinutes: 400,
      proteinG: null,
      kcal: null,
      alcoholDrinks: 0,
      alcoholWithinSixHoursAfterTraining: false,
      waterMl: 3000,
      steps: 9000,
      creatineTaken: true,
      isTrainingDay: false,
    },
    targets,
    {
      sessionsLastSevenDays: 1,
      consecutiveMissed: 2,
      isScheduledRestDay: false,
      reEntryActive: false,
    },
  );

  const report = reportDay({ ...base, result, trained: false });
  assert.ok(report.penalty < 0);
  assert.equal(report.missedScheduledSession, true);
});

test('numbers read the way they are written on a phone', () => {
  assert.equal(hoursAndMinutes(450), '7 h 30');
  assert.equal(hoursAndMinutes(60), '1 h 00');
  assert.equal(thousands(8200), '8 200');
  assert.equal(thousands(950), '950');
});
