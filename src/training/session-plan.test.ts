import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';
import { loadRoutinePlan, loadSessionPlan } from './routines.ts';
import { changePlannedRoutine, startPlannedSession } from './session-plan.ts';

function fixture() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  migrations.forEach((migration) => raw.exec(migration.sql));
  const db = {
    getAllAsync: async (sql: string, params: any[] = []) => raw.prepare(sql).all(...params),
    getFirstAsync: async (sql: string, params: any[] = []) =>
      raw.prepare(sql).get(...params) ?? null,
    runAsync: async (sql: string, params: any[] = []) => raw.prepare(sql).run(...params),
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
  } as unknown as SQLiteDatabase;
  return { db, raw };
}

const session = {
  date: '2026-10-07',
  timeBudget: 'completo',
  routineId: 'push',
  gymId: 'fanshawe',
} as const;

test('a mid-plan failure rolls back the new session and every already-written plan row', async () => {
  const { db, raw } = fixture();
  const plan = await loadRoutinePlan(db, 'push', 'completo', 'fanshawe');
  raw.exec(`CREATE TRIGGER fail_plan BEFORE INSERT ON training_session_plan
    WHEN (SELECT count(*) FROM training_session_plan) = 1
    BEGIN SELECT RAISE(ABORT, 'storage failure'); END;`);
  await assert.rejects(startPlannedSession(db, session, plan.exercises), /storage failure/);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM training_session;').get()!.n, 0);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM training_session_plan;').get()!.n, 0);
  raw.exec('DROP TRIGGER fail_plan;');
  const id = await startPlannedSession(db, session, plan.exercises);
  assert.equal((await loadSessionPlan(db, id)).length, plan.exercises.length);
});

test('concurrent starts and a repeated start before repaint all reuse one complete session', async () => {
  const { db, raw } = fixture();
  const plan = await loadRoutinePlan(db, 'push', 'completo', 'fanshawe');
  const [first, second] = await Promise.all([
    startPlannedSession(db, session, plan.exercises),
    startPlannedSession(db, session, plan.exercises),
  ]);
  assert.equal(first, second);
  const repeat = await startPlannedSession(db, { ...session, routineId: 'pull' }, []);
  assert.equal(repeat, first);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM training_session;').get()!.n, 1);
  assert.equal(raw.prepare('SELECT routine_id FROM training_session;').get()!.routine_id, 'push');
  assert.equal((await loadSessionPlan(db, first)).length, plan.exercises.length);
});

test('a routine replacement failure restores its previous metadata and custom plan', async () => {
  const { db, raw } = fixture();
  const plan = await loadRoutinePlan(db, 'push', 'completo', 'fanshawe');
  const customized = plan.exercises
    .slice(0, 2)
    .reverse()
    .map((entry, index) => ({ ...entry, position: index + 1, sets: index + 1 }));
  const id = await startPlannedSession(db, session, customized);
  const before = await loadSessionPlan(db, id);
  raw.exec(`CREATE TRIGGER fail_plan BEFORE INSERT ON training_session_plan
    WHEN (SELECT count(*) FROM training_session_plan) = 1
    BEGIN SELECT RAISE(ABORT, 'storage failure'); END;`);
  await assert.rejects(changePlannedRoutine(db, id, 'pull'), /storage failure/);
  assert.equal(
    raw.prepare('SELECT routine_id FROM training_session WHERE id = ?;').get(id)!.routine_id,
    'push',
  );
  assert.deepEqual(await loadSessionPlan(db, id), before);
  raw.exec('DROP TRIGGER fail_plan;');
  await changePlannedRoutine(db, id, 'pull');
  assert.equal(
    raw.prepare('SELECT routine_id FROM training_session WHERE id = ?;').get(id)!.routine_id,
    'pull',
  );
  const expected = await loadRoutinePlan(db, 'pull', 'completo', 'fanshawe');
  assert.equal((await loadSessionPlan(db, id)).length, expected.exercises.length);
});

test('a missing routine cannot erase a previously-approved plan', async () => {
  const { db } = fixture();
  const plan = await loadRoutinePlan(db, 'push', 'completo', 'fanshawe');
  const id = await startPlannedSession(db, session, plan.exercises);
  const before = await loadSessionPlan(db, id);
  await assert.rejects(changePlannedRoutine(db, id, 'missing-routine'));
  assert.deepEqual(await loadSessionPlan(db, id), before);
});
