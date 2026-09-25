import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MEAL_SLOTS } from '../nutrition/units.ts';

import {
  DEFAULT_HOURS,
  DEFAULT_NUDGE_RULES,
  learnHours,
  nudgesFor,
  silencedKinds,
  type NudgeDay,
  type NudgeKind,
} from './nudges.ts';

const FULL_DAY: NudgeDay = {
  date: '2026-09-24',
  filledSlots: MEAL_SLOTS,
  trained: true,
  restDay: false,
  trainingDebt: 0,
  waterMl: 3000,
  waterTargetMl: 2800,
  sleepMinutes: 450,
  weightKg: 73,
  criteriaWithData: 8,
};

const kinds = (day: Partial<NudgeDay>, rules = DEFAULT_NUDGE_RULES): NudgeKind[] =>
  nudgesFor({ ...FULL_DAY, ...day }, DEFAULT_HOURS, rules).map((nudge) => nudge.kind);

test('un dia entero anotado no genera ni un aviso', () => {
  assert.deepEqual(kinds({}), []);
});

test('solo avisa de la comida que falta, a su hora mas el margen', () => {
  const nudges = nudgesFor(
    { ...FULL_DAY, filledSlots: [MEAL_SLOTS[0], MEAL_SLOTS[1], MEAL_SLOTS[3], MEAL_SLOTS[4]] },
    DEFAULT_HOURS,
    DEFAULT_NUDGE_RULES,
  );

  assert.deepEqual(
    nudges.map((nudge) => nudge.kind),
    ['comida'],
  );
  // Mediodia son las 11:50 en spec 1.4, y el aviso llega 40 minutos despues.
  assert.equal(nudges[0].atMinute, 11 * 60 + 50 + 40);
  assert.ok(nudges[0].body.includes('11:50'));
});

test('el aviso de entreno trae el boton de descanso y desaparece al marcarlo', () => {
  const owing = nudgesFor(
    { ...FULL_DAY, trained: false, trainingDebt: 2 },
    DEFAULT_HOURS,
    DEFAULT_NUDGE_RULES,
  );
  assert.deepEqual(
    owing.map((nudge) => nudge.kind),
    ['entreno'],
  );
  assert.deepEqual(
    owing[0].actions.map((action) => action.id),
    ['entreno', 'descanso'],
  );

  // Marcado el descanso, ya no hay nada que preguntar.
  assert.deepEqual(kinds({ trained: false, trainingDebt: 2, restDay: true }), []);
  // Y sin deuda tampoco: la semana ya esta cumplida.
  assert.deepEqual(kinds({ trained: false, trainingDebt: 0 }), []);
});

test('el agua solo avisa por debajo de la mitad del dia', () => {
  assert.deepEqual(kinds({ waterMl: 1399, waterTargetMl: 2800 }), ['agua']);
  assert.deepEqual(kinds({ waterMl: 1400, waterTargetMl: 2800 }), []);
  assert.deepEqual(kinds({ waterMl: null }), ['agua']);
});

test('lo de la mañana se calla en cuanto estan el sueño y el peso', () => {
  assert.deepEqual(kinds({ sleepMinutes: null }), ['manana']);
  assert.deepEqual(kinds({ weightKg: null }), ['manana']);
  assert.deepEqual(kinds({ sleepMinutes: null, weightKg: null }), ['manana']);
});

test('el cierre del dia solo sale si el dia va a quedar gris', () => {
  assert.deepEqual(kinds({ criteriaWithData: 2 }), ['cierre']);
  assert.deepEqual(kinds({ criteriaWithData: 3 }), []);
});

test('el domingo por la noche avisa del resumen', () => {
  assert.deepEqual(kinds({ date: '2026-09-27' }), ['semana']);
  assert.deepEqual(kinds({ date: '2026-09-26' }), []);
});

test('nunca pasa del tope, y se quedan los que mas pesan', () => {
  const crowded: Partial<NudgeDay> = {
    filledSlots: [],
    trained: false,
    trainingDebt: 3,
    waterMl: 0,
    sleepMinutes: null,
    weightKg: null,
    criteriaWithData: 0,
  };

  const three = nudgesFor({ ...FULL_DAY, ...crowded }, DEFAULT_HOURS, DEFAULT_NUDGE_RULES);
  assert.equal(three.length, 3);
  // El cierre y el entreno son los que mas puntos ponen en juego.
  assert.ok(three.some((nudge) => nudge.kind === 'cierre'));
  assert.ok(three.some((nudge) => nudge.kind === 'entreno'));
  // Y salen en orden de reloj, no de peso.
  assert.deepEqual(
    three.map((nudge) => nudge.atMinute),
    [...three.map((nudge) => nudge.atMinute)].sort((a, b) => a - b),
  );

  const two = nudgesFor({ ...FULL_DAY, ...crowded }, DEFAULT_HOURS, {
    ...DEFAULT_NUDGE_RULES,
    maxPerDay: 2,
  });
  assert.equal(two.length, 2);
});

test('un tipo apagado no suena, y fuera de horario tampoco', () => {
  assert.deepEqual(kinds({ criteriaWithData: 0, filledSlots: MEAL_SLOTS }), ['cierre']);
  assert.deepEqual(
    kinds(
      { criteriaWithData: 0, filledSlots: MEAL_SLOTS },
      { ...DEFAULT_NUDGE_RULES, silenced: ['cierre'] },
    ),
    [],
  );

  // Con la ventana de silencio adelantada, el cierre de las nueve ya no cabe.
  assert.deepEqual(
    kinds(
      { criteriaWithData: 0, filledSlots: MEAL_SLOTS },
      { ...DEFAULT_NUDGE_RULES, quietFrom: 20 * 60 },
    ),
    [],
  );
});

test('cada aviso lleva un identificador propio por dia', () => {
  const nudges = nudgesFor(
    { ...FULL_DAY, waterMl: 0, sleepMinutes: null },
    DEFAULT_HOURS,
    DEFAULT_NUDGE_RULES,
  );
  assert.deepEqual(
    nudges.map((nudge) => nudge.id),
    ['manana-2026-09-24', 'agua-2026-09-24'],
  );
});

test('las horas salen de la mediana de lo que anota, no del promedio', () => {
  const lunch = [700, 710, 715, 720, 1200].map((minute, index) => ({
    kind: 'comida' as const,
    slot: MEAL_SLOTS[2],
    date: `2026-09-1${index}`,
    minute,
  }));

  const hours = learnHours(lunch);
  // El dia que se le paso a las 20:00 no arrastra a los demas.
  assert.equal(hours.meals.get(MEAL_SLOTS[2]), 715);
  // Los espacios sin rastro suficiente se quedan con la hora del spec.
  assert.equal(hours.meals.get(MEAL_SLOTS[0]), DEFAULT_HOURS.meals.get(MEAL_SLOTS[0]));
});

test('por debajo de cinco veces manda el horario del spec', () => {
  const few = [700, 710, 715, 720].map((minute, index) => ({
    kind: 'comida' as const,
    slot: MEAL_SLOTS[2],
    date: `2026-09-1${index}`,
    minute,
  }));

  assert.equal(learnHours(few).meals.get(MEAL_SLOTS[2]), DEFAULT_HOURS.meals.get(MEAL_SLOTS[2]));
});

test('la hora de entrenar y la de levantarse tambien se aprenden', () => {
  const samples = [];
  for (let day = 1; day <= 6; day += 1) {
    samples.push({ kind: 'entreno' as const, date: `2026-09-0${day}`, minute: 17 * 60 + day });
    samples.push({
      kind: 'comida' as const,
      slot: MEAL_SLOTS[0],
      date: `2026-09-0${day}`,
      minute: 9 * 60,
    });
  }

  const hours = learnHours(samples);
  assert.equal(hours.training, 17 * 60 + 4);
  // El primer rastro de cada dia es el desayuno de las nueve.
  assert.equal(hours.wake, 9 * 60);
});

test('un aviso ignorado tres veces seguidas se calla una semana', () => {
  const ignored = (date: string) => ({ kind: 'agua' as const, date, actedAt: null });

  // Dos seguidos todavia no bastan.
  assert.deepEqual(silencedKinds([ignored('2026-09-20'), ignored('2026-09-21')], '2026-09-22'), []);

  const three = [ignored('2026-09-20'), ignored('2026-09-21'), ignored('2026-09-22')];
  assert.deepEqual(silencedKinds(three, '2026-09-23'), ['agua']);

  // Pasada la semana vuelve a intentarlo.
  assert.deepEqual(silencedKinds(three, '2026-09-30'), []);

  // Y si toco el boton en alguno de los tres, no se calla nada.
  const acted = [...three.slice(0, 2), { kind: 'agua' as const, date: '2026-09-22', actedAt: 1 }];
  assert.deepEqual(silencedKinds(acted, '2026-09-23'), []);
});

test('lo de hoy no cuenta para callar nada, que todavia puede tocarlo', () => {
  const rows = [
    { kind: 'cierre' as const, date: '2026-09-21', actedAt: null },
    { kind: 'cierre' as const, date: '2026-09-22', actedAt: null },
    { kind: 'cierre' as const, date: '2026-09-23', actedAt: null },
  ];
  assert.deepEqual(silencedKinds(rows, '2026-09-23'), []);
});
