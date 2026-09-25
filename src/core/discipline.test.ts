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
import { computeTargets, proteinBand, type TargetProfile } from './targets.ts';

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
  sleepMinutes: 480,
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
  bestWeekSessions: 5,
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

test('un criterio sin dato no gana sus puntos, y se ve cuantos fueron', () => {
  const day: DisciplineDay = {
    ...perfectDay,
    proteinG: null,
    kcal: null,
    steps: null,
    waterMl: null,
    creatineTaken: null,
  };
  const result = scoreDay(day, targets, onTrack);
  // Entreno, sueno y alcohol llenos: 22 + 20 + 10 de los cien del dia.
  close(result.score, 52);
  // Y los otros 48 no son un suspenso, son cuatro cosas sin anotar.
  close(result.pointsWithoutData, 48);
});

test('un solo criterio ya da nota, y vale lo que vale ese criterio', () => {
  const onlyCreatine: DisciplineDay = {
    trained: null,
    sleepMinutes: null,
    proteinG: null,
    kcal: null,
    alcoholDrinks: null,
    alcoholWithinSixHoursAfterTraining: false,
    waterMl: null,
    steps: null,
    creatineTaken: true,
    isTrainingDay: false,
  };
  const result = scoreDay(onlyCreatine, targets, onTrack);
  close(result.score, CRITERION_WEIGHTS.creatine);
  assert.equal(result.criteriaWithData, MINIMUM_CRITERIA_WITH_DATA);
});

test('un dia sin nada anotado no tiene nota', () => {
  const empty: DisciplineDay = {
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
  };
  const result = scoreDay(empty, targets, onTrack);
  assert.equal(result.score, null);
  assert.equal(result.criteriaWithData, 0);
  close(result.pointsWithoutData, 100);
});

test('un descanso marcado con la semana cumplida vale como entrenar', () => {
  const resting: DisciplineDay = { ...perfectDay, trained: null, isTrainingDay: false };
  const restDay: TrainingContext = { ...onTrack, isScheduledRestDay: true };

  // Cinco sesiones en la semana que lo rodea, asi que los 22 del entreno se ganan
  // descansando, aunque las cinco esten todas por delante del dia.
  close(scoreDay(resting, targets, restDay).score, 100);
  const allAhead: TrainingContext = { ...restDay, sessionsLastSevenDays: 0 };
  close(scoreDay(resting, targets, allAhead).score, 100);

  // Con sesiones pendientes no: si no, marcar descanso seria la forma facil de sacar
  // cien todos los dias.
  const behind: TrainingContext = { ...restDay, sessionsLastSevenDays: 2, bestWeekSessions: 2 };
  const result = scoreDay(resting, targets, behind);
  close(result.score, 78);
  close(result.pointsWithoutData, 22);
  // Y spec 4.3 sigue: un descanso marcado no arrastra la penalizacion.
  assert.equal(result.penalty, 0);
});

test('el sueno sigue la curva de spec 4.1 y no un umbral', () => {
  const points = (minutes: number) => {
    const day = scoreDay({ ...perfectDay, sleepMinutes: minutes }, targets, onTrack);
    return (day.criteria.find((criterion) => criterion.id === 'sleep')?.fraction ?? 0) * 20;
  };

  // Los puntos que fijo el dueno, tal cual.
  close(points(480), 20);
  close(points(450), 19);
  close(points(420), 17);
  close(points(390), 14);
  close(points(360), 11);
  close(points(330), 9);
  close(points(300), 7);
  close(points(240), 5);
  close(points(180), 3);
  close(points(90), 1);
  close(points(60), 0);
  close(points(0), 0);

  // Y entre dos puntos, la linea recta: cinco horas y cinco minutos no es cero.
  close(points(305), 7 + (5 / 30) * 2, 0.05);
  // Dormir de mas no suma: el maximo del dia sigue siendo cien.
  close(points(600), 20);
});

test('la proteina sigue la meseta de Morton y no una banda de todo o nada', () => {
  const points = (grams: number) => {
    const day = scoreDay({ ...perfectDay, proteinG: grams }, targets, onTrack);
    return (day.criteria.find((criterion) => criterion.id === 'protein')?.fraction ?? 0) * 16;
  };
  const band = proteinBand(targets);
  const perKilo = (gramsPerKilo: number) => targets.weightBasisKg * gramsPerKilo;

  // 73 kg: la banda de spec 3.6 va de 131 a 160 y vale los dieciseis enteros.
  assert.equal(band.from, 131);
  assert.equal(band.to, 160);
  // El piso de la banda esta redondeado hacia abajo, asi que se queda a un pelo.
  close(points(band.from), 16, 0.1);
  close(points(145), 16);
  close(points(band.to), 16);

  // 1.6 g/kg es la meseta de Morton: casi todo, no todo.
  close(points(perKilo(1.6)), 14);
  close(points(perKilo(1.2)), 8);
  close(points(perKilo(0.8)), 3.2);
  close(points(0), 0);

  // Ocho gramos cortos ya no cuestan los dieciseis puntos.
  assert.ok(points(123) > 12);

  // Pasarse no es un suspenso, solo deja de sumar.
  close(points(perKilo(3)), 14);
});

test('las calorias caen segun el tamano del deficit, no de golpe', () => {
  const points = (kcal: number) => {
    const day = scoreDay({ ...perfectDay, kcal }, targets, onTrack);
    return (day.criteria.find((criterion) => criterion.id === 'calories')?.fraction ?? 0) * 10;
  };
  const share = (of: number) => targets.kcal * of;

  close(points(targets.kcal), 10);
  close(points(share(0.94)), 10);
  close(points(share(1.06)), 10);

  // Diez dias al 80% bajan la sintesis de proteina un 16%, y eso cuesta dos puntos.
  close(points(share(0.8)), 8);
  close(points(share(0.7)), 6);
  // Medio dia de comida vale un tercio, no cero. Cero es no comer.
  close(points(share(0.5)), 3.5);
  close(points(0), 0);

  // Pasarse cuesta casi lo mismo que quedarse corto a la misma distancia, con el
  // deficit un pelo mejor tratado porque va hacia la meta de bajar grasa.
  close(points(share(1.5)), points(share(0.5)));
  assert.ok(points(share(1.15)) < points(share(0.85)));
  close(points(share(2)), 0);
});

test('el agua y los pasos tampoco tienen escalon', () => {
  const water = (ml: number) => {
    const day = scoreDay({ ...perfectDay, waterMl: ml }, targets, onTrack);
    return (day.criteria.find((criterion) => criterion.id === 'water')?.fraction ?? 0) * 8;
  };
  const steps = (count: number) => {
    const day = scoreDay({ ...perfectDay, steps: count }, targets, onTrack);
    return (day.criteria.find((criterion) => criterion.id === 'steps')?.fraction ?? 0) * 8;
  };

  // Dia de entreno: la meta es 3.5 L, y 2.23 L ya no son 1.5 de 8.
  close(water(targets.waterMlTraining), 8);
  assert.ok(water(2230) > 4.5 && water(2230) < 5.5);
  close(water(0), 0);
  // Beber de mas no suma.
  close(water(9000), 8);

  close(steps(targets.steps), 8);
  assert.ok(steps(targets.steps * 0.7) > 4);
  close(steps(0), 0);
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
    bestWeekSessions: 2,
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
    bestWeekSessions: 2,
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
    bestWeekSessions: 1,
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
    bestWeekSessions: 2,
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
