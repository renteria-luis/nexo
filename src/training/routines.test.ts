import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';

import {
  AVG_SET_SECONDS,
  TRANSITION_SECONDS,
  TRIMMED_REST_SECONDS,
  WARMUP_SECONDS,
  estimateSeconds,
  listRoutines,
  loadRoutine,
  loadRoutinePlan,
  loadSessionPlan,
  saveSessionPlan,
  nextPendingExercise,
  overrideSets,
  owedRoutine,
  listRoutinesDone,
  suggestedRest,
  toStart,
  trimRoutine,
} from './routines.ts';
import { setExerciseGym } from './catalog.ts';
import { addSet, startSession } from './sessions.ts';

type SqlValue = string | number | null;

function fresh(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  return {
    withTransactionAsync: async (work: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await work();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    getAllAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T[]> =>
      raw.prepare(source).all(...params) as T[],
    getFirstAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T | null> =>
      (raw.prepare(source).get(...params) as T) ?? null,
    runAsync: async (source: string, params: SqlValue[] = []) => {
      raw.prepare(source).run(...params);
      return { changes: 0, lastInsertRowId: 0 };
    },
  } as unknown as SQLiteDatabase;
}

test('his three routines are seeded in the order he trains them', async () => {
  const routines = await listRoutines(fresh());
  assert.deepEqual(
    routines.map((routine) => routine.id),
    ['push', 'pull', 'legs'],
  );
});

test('tier 1 keeps its sets and its rest at every budget', async () => {
  const db = fresh();
  const push = await loadRoutine(db, 'push');

  for (const budget of ['completo', 'minus_25', 'minus_50', 'express'] as const) {
    const press = trimRoutine(push, budget).find((e) => e.exerciseId === 'incline-db-press');
    assert.equal(press?.sets, 3, budget);
    assert.equal(press?.restSeconds, 180, budget);
  }
});

test('the lower tiers come off in order, and Express leaves only the core', async () => {
  const db = fresh();
  const pull = trimRoutine(await loadRoutine(db, 'pull'), 'completo');
  const push = await loadRoutine(db, 'push');
  const ids = (budget: 'completo' | 'minus_25' | 'minus_50' | 'express') =>
    trimRoutine(push, budget).map((exercise) => exercise.exerciseId);

  // Tier 4 goes at the first cut, tier 3 at the second.
  assert.ok(pull.some((exercise) => exercise.exerciseId === 'reverse-pec-deck'));
  assert.ok(ids('minus_25').includes('triceps-pulldown'));
  assert.ok(!ids('minus_50').includes('triceps-pulldown'));
  assert.deepEqual(
    trimRoutine(await loadRoutine(db, 'pull'), 'express').map((exercise) => exercise.exerciseId),
    ['pull-up', 'cable-row-narrow'],
  );
});

test('el predicador sale de la rutina pero se queda en el catalogo', async () => {
  const db = fresh();
  const pull = await loadRoutine(db, 'pull');

  assert.ok(!pull.some((exercise) => exercise.exerciseId === 'preacher-curl'));
  // Sigue estando para elegirlo a mano el dia que quiera cambiarlo por el inclinado.
  const rows = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM training_exercise WHERE id = 'preacher-curl';",
  );
  assert.equal(rows.length, 1);
});

test('rest on the lighter work drops to 90 seconds only when time is short', async () => {
  const db = fresh();
  const push = await loadRoutine(db, 'push');
  const peckDeck = (budget: 'completo' | 'minus_25' | 'minus_50') =>
    trimRoutine(push, budget).find((e) => e.exerciseId === 'peck-deck')?.restSeconds;

  assert.equal(peckDeck('completo'), 120);
  assert.equal(peckDeck('minus_25'), 120);
  assert.equal(peckDeck('minus_50'), TRIMMED_REST_SECONDS);
});

test('the estimate is the sets, their rest, a transition each and a warmup', () => {
  const planned = [
    {
      exerciseId: 'hack-squat',
      name: 'Sentadilla hack',
      unilateral: false,
      position: 1,
      tier: 1,
      sets: 3,
      repMode: 'range' as const,
      repMin: 8,
      repMax: 10,
      restSeconds: 180,
    },
  ];

  assert.equal(
    estimateSeconds(planned),
    WARMUP_SECONDS + 3 * (AVG_SET_SECONDS + 180) + TRANSITION_SECONDS,
  );
  assert.equal(estimateSeconds([]), 0);
});

test('a un brazo por vez la misma serie cuesta el doble de trabajo', () => {
  const oneArm = [
    {
      exerciseId: 'lateral-raise-cable',
      name: 'Elevaciones laterales en polea, un brazo',
      unilateral: true,
      position: 1,
      tier: 3,
      sets: 3,
      repMode: 'range' as const,
      repMin: 12,
      repMax: 15,
      restSeconds: 120,
    },
  ];

  assert.equal(
    estimateSeconds(oneArm),
    WARMUP_SECONDS + 3 * (AVG_SET_SECONDS * 2 + 120) + TRANSITION_SECONDS,
  );
});

test('con tiempo completo las laterales salen en polea, y al recortar vuelven las mancuernas', async () => {
  const db = fresh();

  const full = await loadRoutinePlan(db, 'push', 'completo');
  const short = await loadRoutinePlan(db, 'push', 'minus_25');

  const lateralFull = full.exercises.find((exercise) => exercise.position === 6);
  const lateralShort = short.exercises.find((exercise) => exercise.position === 6);

  assert.equal(lateralFull?.exerciseId, 'lateral-raise-cable');
  assert.equal(lateralFull?.unilateral, true);
  assert.equal(lateralShort?.exerciseId, 'lateral-raise');
  assert.equal(lateralShort?.unilateral, false);
});

test('a shorter budget is a shorter session', async () => {
  const db = fresh();
  const full = await loadRoutinePlan(db, 'push', 'completo');
  const half = await loadRoutinePlan(db, 'push', 'minus_50');
  const express = await loadRoutinePlan(db, 'push', 'express');

  assert.ok(estimateSeconds(full.exercises) > estimateSeconds(half.exercises));
  assert.ok(estimateSeconds(half.exercises) > estimateSeconds(express.exercises));
  assert.equal(express.exercises.length, 1);
});

test('the plan he approved is what the session remembers', async () => {
  const db = fresh();
  const plan = await loadRoutinePlan(db, 'legs', 'minus_25');
  const sessionId = await startSession(db, { date: '2026-09-15', timeBudget: 'minus_25' });

  // Spec 8.3 rule 8: an override belongs to this session and not to the routine.
  const approved = plan.exercises.map((exercise) =>
    exercise.exerciseId === 'hack-squat' ? { ...exercise, sets: 5 } : exercise,
  );
  await saveSessionPlan(db, sessionId, approved);

  const stored = await loadSessionPlan(db, sessionId);
  assert.equal(stored[0].exerciseId, 'hack-squat');
  assert.equal(stored[0].sets, 5);
  assert.equal((await loadRoutine(db, 'legs'))[0].setsFull, 3);
});

test('en el gimnasio que tiene la maquina, el plan sale con la maquina', async () => {
  const db = fresh();

  // Fit4Less tiene la Nautilus de laterales; Fanshawe no.
  const f4l = await loadRoutinePlan(db, 'push', 'completo', 'fit4less-proudfoot');
  const fanshawe = await loadRoutinePlan(db, 'push', 'completo', 'fanshawe');
  const anywhere = await loadRoutinePlan(db, 'push', 'completo');

  const lateral = (plan: Awaited<ReturnType<typeof loadRoutinePlan>>) =>
    plan.exercises.find((exercise) => exercise.exerciseId.startsWith('lateral-raise'))?.exerciseId;

  assert.equal(lateral(f4l), 'lateral-raise-machine');
  // En Fanshawe la maquina no existe, asi que se queda la polea de siempre.
  assert.equal(lateral(fanshawe), 'lateral-raise-cable');
  // Sin gimnasio elegido no hay nada que resolver.
  assert.equal(lateral(anywhere), 'lateral-raise-cable');
});

test('el selector pasa al siguiente que le falta y recoge el que se salto', () => {
  const order = ['press', 'pec-deck', 'triceps', 'laterales'];
  const planned = new Map([
    ['press', 3],
    ['pec-deck', 3],
    ['triceps', 2],
    ['laterales', 2],
  ]);

  // Lo normal: cerro el primero y sigue el segundo.
  assert.equal(nextPendingExercise('press', order, new Map([['press', 3]]), planned), 'pec-deck');

  // Con el segundo ya hecho, se lo salta.
  assert.equal(
    nextPendingExercise(
      'press',
      order,
      new Map([
        ['press', 3],
        ['pec-deck', 3],
      ]),
      planned,
    ),
    'triceps',
  );

  // Y si el que se salto fue uno de antes, al cerrar el ultimo da la vuelta y lo recoge.
  assert.equal(
    nextPendingExercise(
      'laterales',
      order,
      new Map([
        ['press', 3],
        ['triceps', 2],
        ['laterales', 2],
      ]),
      planned,
    ),
    'pec-deck',
  );

  // Con todo hecho no mueve nada.
  assert.equal(
    nextPendingExercise(
      'laterales',
      order,
      new Map([
        ['press', 3],
        ['pec-deck', 3],
        ['triceps', 2],
        ['laterales', 2],
      ]),
      planned,
    ),
    null,
  );

  // Un ejercicio que no estaba en el plan no lleva a ningun lado.
  assert.equal(nextPendingExercise('remo', order, new Map(), planned), null);
});

test('con la mitad del tiempo, la sesion sugiere el descanso recortado que aprobo', async () => {
  const db = fresh();
  const plan = await loadRoutinePlan(db, 'push', 'minus_50', 'fanshawe');
  const sessionId = await startSession(db, { date: '2026-10-03', timeBudget: 'minus_50' });
  await saveSessionPlan(db, sessionId, plan.exercises);
  const stored = await loadSessionPlan(db, sessionId);

  const peckDeck = plan.exercises.find((exercise) => exercise.exerciseId === 'peck-deck');
  assert.equal(peckDeck?.restSeconds, TRIMMED_REST_SECONDS);
  // El catalogo dice 120; lo aprobado, 90. Antes la pantalla seguia diciendo 2:00.
  assert.equal(suggestedRest(stored, 'peck-deck', 120), TRIMMED_REST_SECONDS);
  // Lo que no estaba en el plan sigue con lo suyo.
  assert.equal(suggestedRest(stored, 'not-in-the-plan', 150), 150);
});

test('con menos tiempo en Fit4Less la maquina de laterales se queda, porque es de dos brazos', async () => {
  const db = fresh();
  for (const budget of ['completo', 'minus_25', 'minus_50'] as const) {
    const plan = await loadRoutinePlan(db, 'push', budget, 'fit4less-proudfoot');
    const ids = plan.exercises.map((exercise) => exercise.exerciseId);
    assert.ok(ids.includes('lateral-raise-machine'), `${budget}: ${ids.join(', ')}`);
    assert.ok(!ids.includes('lateral-raise'), `${budget} fell back to the dumbbells`);
  }
});

test('lo que el gimnasio no tiene sale del plan de ese gimnasio', async () => {
  const db = fresh();
  const before = await loadRoutinePlan(db, 'legs', 'completo', 'fit4less-proudfoot');
  assert.ok(before.exercises.some((exercise) => exercise.exerciseId === 'hack-squat'));

  // "En Fit4Less no hay hack squat": el interruptor de la ficha.
  await setExerciseGym(db, 'hack-squat', 'fit4less-proudfoot', false);

  const there = await loadRoutinePlan(db, 'legs', 'completo', 'fit4less-proudfoot');
  assert.ok(!there.exercises.some((exercise) => exercise.exerciseId === 'hack-squat'));
  assert.equal(there.exercises.length, before.exercises.length - 1);
  // En Fanshawe sigue, y un gimnasio sin nada marcado se queda con la rutina entera.
  const fanshawe = await loadRoutinePlan(db, 'legs', 'completo', 'fanshawe');
  assert.ok(fanshawe.exercises.some((exercise) => exercise.exerciseId === 'hack-squat'));
  const other = await loadRoutinePlan(db, 'legs', 'completo', 'otro');
  assert.equal(other.exercises.length, before.exercises.length);
});

test('en el plan una maquina rota se baja a cero series y no entra en la sesion', async () => {
  const db = fresh();
  const plan = await loadRoutinePlan(db, 'legs', 'completo', 'fanshawe');
  let exercises = plan.exercises;
  for (let tap = 0; tap < 5; tap += 1) exercises = overrideSets(exercises, 'hack-squat', -1);

  assert.equal(exercises.find((exercise) => exercise.exerciseId === 'hack-squat')?.sets, 0);
  const started = toStart(exercises);
  assert.equal(started.length, plan.exercises.length - 1);
  assert.ok(!started.some((exercise) => exercise.exerciseId === 'hack-squat'));
});

test('el plan trae puesta la rutina que la semana todavia debe', async () => {
  const routines = await listRoutines(fresh());
  const TODAY = '2026-10-10';

  // Sin nada hecho deben empuje y tiron dos cada una: empata y va la primera.
  assert.equal(owedRoutine(routines, [], TODAY), 'push');

  // Empujo ayer: ahora el tiron debe dos y el empuje una.
  assert.equal(owedRoutine(routines, [{ routineId: 'push', date: '2026-10-09' }], TODAY), 'pull');

  // Dos de empuje y una de tiron en la semana: tiron y pierna deben una. La pierna fue el
  // 30, fuera de la semana y hace mas que el tiron del 6, asi que toca pierna.
  const week = [
    { routineId: 'legs', date: '2026-09-30' },
    { routineId: 'push', date: '2026-10-05' },
    { routineId: 'pull', date: '2026-10-06' },
    { routineId: 'push', date: '2026-10-07' },
  ];
  assert.equal(owedRoutine(routines, week, TODAY), 'legs');
});

test('una sesion abierta sin ninguna serie no cuenta como esa rutina hecha', async () => {
  const db = fresh();
  await startSession(db, { date: '2026-10-08', timeBudget: 'completo', routineId: 'pull' });
  const done = await startSession(db, {
    date: '2026-10-09',
    timeBudget: 'completo',
    routineId: 'push',
  });
  await addSet(db, { sessionId: done, exerciseId: 'peck-deck', weightKg: 40, reps: 12 });

  const listed = await listRoutinesDone(db, { from: '2026-10-01', to: '2026-10-10' });
  assert.deepEqual(
    listed.map((one) => ({ ...one })),
    [{ routineId: 'push', date: '2026-10-09' }],
  );
});
