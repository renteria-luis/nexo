import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';
import { loadRoutinePlan, loadSessionPlan, type PlannedSet } from './routines.ts';
import {
  applySessionPlanEdit,
  loadSessionPlanEdit,
  startPlannedSession,
  replaceSessionVariant,
} from './session-plan.ts';
import { archiveExercise } from './catalog.ts';
import { remainingEstimate } from './timing.ts';
import { readSessionTiming } from './timing-store.ts';
import { listExercises } from './queries.ts';
import { addSet, finishSession } from './sessions.ts';

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

test('variant replacement keeps completed sets, reduces the correct pending work and changes ETA', async () => {
  const { db, raw } = fixture();
  const routine = await loadRoutinePlan(db, 'push', 'completo', 'fanshawe');
  const lateral = routine.exercises.find((item) => item.exerciseId === 'lateral-raise-cable')!;
  const id = await startPlannedSession(db, session, [{ ...lateral, sets: 4 }]);
  await addSet(db, { sessionId: id, exerciseId: lateral.exerciseId, weightKg: 10, reps: 12 });
  const before = raw.prepare('SELECT * FROM training_set_entry;').all();
  await assert.rejects(archiveExercise(db, lateral.exerciseId, true), /pendientes/);
  const catalog = await listExercises(db);
  const timing = await readSessionTiming(db, id);
  const oldEta = remainingEstimate(timing, await loadSessionPlan(db, id), catalog, Date.now());
  const updated = await replaceSessionVariant(db, id, lateral.exerciseId, 'lateral-raise');
  assert.deepEqual(
    updated.map((item) => [item.exerciseId, item.sets]),
    [
      ['lateral-raise-cable', 1],
      ['lateral-raise', 3],
    ],
  );
  assert.deepEqual(raw.prepare('SELECT * FROM training_set_entry;').all(), before);
  const newEta = remainingEstimate(timing, updated, catalog, Date.now());
  assert.equal(newEta.sets, 3);
  assert.ok(newEta.seconds < oldEta.seconds);
  assert.deepEqual(
    await replaceSessionVariant(db, id, lateral.exerciseId, 'lateral-raise'),
    updated,
  );
  const back = await replaceSessionVariant(db, id, 'lateral-raise', lateral.exerciseId);
  assert.deepEqual(
    back.map((item) => [item.exerciseId, item.sets]),
    [['lateral-raise-cable', 4]],
  );
});

test('variant failures preserve the whole plan and a fresh retry works without duplicating pending work', async () => {
  const { db, raw } = fixture();
  const routine = await loadRoutinePlan(db, 'push', 'completo', 'fanshawe');
  const id = await startPlannedSession(db, session, routine.exercises);
  const before = await loadSessionPlan(db, id);
  await assert.rejects(
    replaceSessionVariant(db, id, 'lateral-raise-cable', 'peck-deck'),
    /variante/,
  );
  raw.exec(`CREATE TRIGGER fail_variant BEFORE INSERT ON training_session_plan
    WHEN NEW.exercise_id = 'lateral-raise' BEGIN SELECT RAISE(ABORT, 'storage failure'); END;`);
  await assert.rejects(
    replaceSessionVariant(db, id, 'lateral-raise-cable', 'lateral-raise'),
    /storage failure/,
  );
  assert.deepEqual(await loadSessionPlan(db, id), before);
  raw.exec('DROP TRIGGER fail_variant;');
  await replaceSessionVariant(db, id, 'lateral-raise-cable', 'lateral-raise');
  assert.equal(
    (await loadSessionPlan(db, id)).some((item) => item.exerciseId === 'lateral-raise-cable'),
    false,
  );
  await finishSession(db, id);
  await assert.rejects(
    replaceSessionVariant(db, id, 'lateral-raise', 'lateral-raise-cable'),
    /Reabre/,
  );
});

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
  const edit = await loadSessionPlanEdit(db, id, 'pull');
  await assert.rejects(applySessionPlanEdit(db, edit), /storage failure/);
  assert.equal(
    raw.prepare('SELECT routine_id FROM training_session WHERE id = ?;').get(id)!.routine_id,
    'push',
  );
  assert.deepEqual(await loadSessionPlan(db, id), before);
  raw.exec('DROP TRIGGER fail_plan;');
  await applySessionPlanEdit(db, edit);
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
  await assert.rejects(loadSessionPlanEdit(db, id, 'missing-routine'));
  assert.deepEqual(await loadSessionPlan(db, id), before);
});

test('routine review retains shared adjustments and completed work without writing', async () => {
  const { db, raw } = fixture();
  const original = [
    { exerciseId: 'pull-up', sets: 7, position: 1, restSeconds: 90 },
    { exerciseId: 'peck-deck', sets: 4, position: 2, restSeconds: 120 },
  ];
  const id = await startSessionForPlan(db, original);
  const catalogBefore = raw.prepare('SELECT * FROM training_routine_exercise').all();
  await addSet(db, { sessionId: id, exerciseId: 'peck-deck', weightKg: 20, reps: 10 });
  await addSet(db, { sessionId: id, exerciseId: 'incline-db-press', weightKg: 20, reps: 10 });
  await addSet(db, {
    sessionId: id,
    exerciseId: 'peck-deck',
    weightKg: 10,
    reps: 10,
    isWarmup: true,
  });
  // A synthetic routine makes shared and departed membership explicit.
  raw.exec(`INSERT INTO training_routine (id, name) VALUES ('next', 'Next');
    INSERT INTO training_routine_exercise
      (id, routine_id, exercise_id, position, tier, sets_full, sets_minus_25, sets_minus_50, sets_express, target_rep_mode)
      VALUES ('next-1', 'next', 'pull-up', 1, 2, 3, 3, 2, 1, 'amrap');`);
  const edit = await loadSessionPlanEdit(db, id, 'next');
  assert.deepEqual(await loadSessionPlan(db, id), original);
  assert.equal(edit.exercises[0].exerciseId, 'pull-up');
  assert.equal(edit.exercises[0].sets, 7);
  assert.equal(edit.exercises[0].restSeconds, 90);
  assert.equal(edit.exercises.find((row) => row.exerciseId === 'peck-deck')!.sets, 1);
  assert.equal(edit.exercises.find((row) => row.exerciseId === 'incline-db-press')!.sets, 1);
  assert.equal(edit.removedPending, 3);
  await applySessionPlanEdit(db, edit);
  assert.equal(raw.prepare('SELECT count(*) AS n FROM training_set_entry').get()!.n, 3);
  assert.deepEqual(
    raw.prepare("SELECT * FROM training_routine_exercise WHERE routine_id <> 'next'").all(),
    catalogBefore,
  );
});

async function startSessionForPlan(db: SQLiteDatabase, plan: readonly PlannedSet[]) {
  const standard = await loadRoutinePlan(db, 'push', 'completo', 'fanshawe');
  const id = await startPlannedSession(db, session, standard.exercises);
  const edit = await loadSessionPlanEdit(db, id);
  await applySessionPlanEdit(db, { ...edit, exercises: [...plan] });
  return id;
}

test('plan edits reject stale series, duplicate exercises and loss of completed work', async () => {
  const { db } = fixture();
  const id = await startSessionForPlan(db, [
    { exerciseId: 'peck-deck', position: 1, sets: 3, restSeconds: 120 },
  ]);
  const stale = await loadSessionPlanEdit(db, id);
  await addSet(db, { sessionId: id, exerciseId: 'peck-deck', weightKg: 20, reps: 10 });
  await assert.rejects(applySessionPlanEdit(db, stale), /entreno cambió/);
  const edit = await loadSessionPlanEdit(db, id);
  await assert.rejects(applySessionPlanEdit(db, { ...edit, exercises: [] }), /ya hechas/);
  await assert.rejects(
    applySessionPlanEdit(db, { ...edit, exercises: [...edit.exercises, ...edit.exercises] }),
    /cantidades/,
  );
  await assert.rejects(
    applySessionPlanEdit(db, { ...edit, exercises: [{ ...edit.exercises[0], sets: 1.5 }] }),
    /cantidades/,
  );
  assert.equal((await loadSessionPlan(db, id))[0].sets, 3);
  await applySessionPlanEdit(db, { ...edit, exercises: [{ ...edit.exercises[0], sets: 1 }] });
  assert.equal((await loadSessionPlan(db, id))[0].sets, 1);
  await finishSession(db, id);
  await assert.rejects(loadSessionPlanEdit(db, id), /Reabre/);
  await assert.rejects(applySessionPlanEdit(db, edit), /Reabre/);
});

test('reordering, omitting and adding remain session-only and invalidate an older preview', async () => {
  const { db, raw } = fixture();
  const original = await loadRoutinePlan(db, 'push', 'completo', 'fanshawe');
  const id = await startPlannedSession(db, session, original.exercises);
  const first = await loadSessionPlanEdit(db, id);
  const second = await loadSessionPlanEdit(db, id);
  const exercises = first.exercises.slice(1).reverse();
  exercises.push({ exerciseId: 'pull-up', sets: 2, position: 900, restSeconds: 180 });
  await applySessionPlanEdit(db, { ...first, exercises });
  const saved = await loadSessionPlan(db, id);
  assert.deepEqual(
    saved.map((entry) => entry.exerciseId),
    exercises.map((entry) => entry.exerciseId),
  );
  assert.deepEqual(
    saved.map((entry) => entry.position),
    saved.map((_, index) => index + 1),
  );
  await assert.rejects(applySessionPlanEdit(db, second), /entreno cambió/);
  assert.deepEqual(
    (await loadRoutinePlan(db, 'push', 'completo', 'fanshawe')).exercises,
    original.exercises,
  );
  assert.equal(raw.prepare('SELECT count(*) AS n FROM training_set_entry').get()!.n, 0);
  await applySessionPlanEdit(db, { ...(await loadSessionPlanEdit(db, id)), exercises: [] });
  assert.deepEqual(await loadSessionPlan(db, id), []);
});
