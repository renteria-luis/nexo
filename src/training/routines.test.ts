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
  trimRoutine,
} from './routines.ts';
import { startSession } from './sessions.ts';

type SqlValue = string | number | null;

function fresh(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  return {
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
  const pull = await loadRoutine(db, 'pull');
  const ids = (budget: 'completo' | 'minus_25' | 'minus_50' | 'express') =>
    trimRoutine(pull, budget).map((exercise) => exercise.exerciseId);

  // Tier 4 goes at the first cut, tier 3 at the second.
  assert.ok(ids('completo').includes('reverse-pec-deck'));
  assert.ok(!ids('minus_25').includes('reverse-pec-deck'));
  assert.ok(ids('minus_25').includes('preacher-curl'));
  assert.ok(!ids('minus_50').includes('preacher-curl'));
  assert.deepEqual(ids('express'), ['pull-up', 'cable-row-narrow']);
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

  assert.ok(full.estimatedSeconds > half.estimatedSeconds);
  assert.ok(half.estimatedSeconds > express.estimatedSeconds);
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
