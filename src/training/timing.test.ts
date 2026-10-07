import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { TrainingSessionRow } from '../db/types.ts';
import { migrations } from '../db/migrations/index.ts';
import { addSet, deleteSet, finishSession, reopenSession, startSession } from './sessions.ts';
import {
  analyzeTiming,
  historicalPace,
  remainingEstimate,
  unusualInterval,
  type SessionTiming,
  type TimingSample,
  type TimingSet,
} from './timing.ts';
import {
  prepareTimingHistory,
  readSessionTiming,
  rebuildExerciseTimes,
  reviewSetTiming,
} from './timing-store.ts';

const START = new Date(2026, 9, 7, 13, 20).getTime();
const session: TrainingSessionRow = {
  id: 's',
  date: '2026-10-07',
  start_time: START,
  end_time: null,
  gym_id: 'fanshawe',
  routine_id: 'push',
  alone_or_partner: 'alone',
  time_budget: 'completo',
  crowding: null,
  is_retroactive: 0,
  notes: null,
  duration_trusted: 0,
};
const set = (minute: number, index: number, extra: Partial<TimingSet> = {}): TimingSet => ({
  id: `set-${index}`,
  exerciseId: 'incline-db-press',
  implement: 'dumbbell',
  setIndex: index,
  timestamp: START + minute * 60000,
  warmup: false,
  eligible: true,
  review: 'auto',
  correctedSeconds: null,
  ...extra,
});
const sample = (minutes: number, extra: Partial<TimingSample> = {}): TimingSample => ({
  sessionId: 'past',
  date: '2026-10-06',
  exerciseId: 'incline-db-press',
  implement: 'dumbbell',
  sets: 3,
  samples: 2,
  flagged: 0,
  minutes,
  ...extra,
});
const data = (sets: TimingSet[], history: TimingSample[] = []): SessionTiming => ({
  session,
  sets,
  history,
  exercises: analyzeTiming(session, sets, history),
});
const plan = [
  { exerciseId: 'incline-db-press', position: 0, sets: 3, restSeconds: 180 },
  { exerciseId: 'peck-deck', position: 1, sets: 4, restSeconds: 120 },
];
const catalog = [
  { id: 'incline-db-press', equipment_type: 'dumbbell', unilateral: 0 },
  { id: 'peck-deck', equipment_type: 'machine', unilateral: 0 },
];

test('three taps at 13:30, 13:35 and 13:40 estimate 15 minutes from two observations', () => {
  const [exercise] = analyzeTiming(session, [set(10, 1), set(15, 2), set(20, 3)], []);
  assert.equal(exercise.minutes, 15);
  assert.equal(exercise.samples, 2);
  assert.equal(exercise.intervals[0].seconds, null);
  assert.equal(analyzeTiming(session, [set(10, 1)], [sample(15)])[0].minutes, null);
});

test('switches, alternating machines, implements and warmups never become measured cycles', () => {
  const sets = [
    set(1, 1),
    set(4, 1, { exerciseId: 'peck-deck', implement: 'machine' }),
    set(7, 2),
    set(10, 3, { implement: 'cable' }),
    set(13, 4, { warmup: true }),
    set(16, 5),
  ];
  for (const group of analyzeTiming(session, sets, [])) assert.equal(group.samples, 0);
});

test('a deleted intermediate set or backwards clock cannot turn two cycles into one', () => {
  const gap = analyzeTiming(session, [set(1, 1), set(7, 3)], [])[0];
  assert.equal(gap.samples, 0);
  assert.equal(gap.intervals[1].reason, 'gap');
  const backwards = analyzeTiming(session, [set(7, 1), set(1, 2)], [])[0];
  assert.equal(backwards.samples, 0);
  assert.equal(backwards.flagged, 1);
});

test('outlier detection has conservative small-sample and zero-MAD handling', () => {
  assert.equal(unusualInterval(1, []), 'short');
  assert.equal(unusualInterval(1800, []), 'long');
  assert.equal(unusualInterval(400, [180, 180]), null);
  assert.equal(unusualInterval(400, [180, 180, 180, 180, 180]), 'unusual');
  assert.equal(unusualInterval(220, [180, 180, 180, 180, 180]), null);
  const history = [8, 9, 9, 9, 9].map((n) => sample(n));
  assert.equal(analyzeTiming(session, [set(1, 1), set(12, 2)], history)[0].samples, 0);
});

test('excluding a late timestamp invalidates both adjacent intervals, while a correction rescues one', () => {
  const sets = [set(1, 1), set(10, 2, { review: 'exclude' }), set(11, 3), set(14, 4)];
  const group = analyzeTiming(session, sets, [])[0];
  assert.deepEqual(
    group.intervals.map((item) => item.reason),
    ['first', 'excluded', 'adjacent', null],
  );
  assert.equal(group.minutes, 12);
  const corrected = analyzeTiming(
    session,
    sets.map((item) => (item.setIndex === 3 ? { ...item, correctedSeconds: 240 } : item)),
    [],
  )[0];
  assert.equal(corrected.samples, 2);
  assert.equal(corrected.minutes, 14);
});

test('a confirmed long interval is kept, originals are not changed, and retroactive clocks do not teach', () => {
  const sets = [set(1, 1), set(31, 2, { review: 'keep' })];
  assert.equal(analyzeTiming(session, sets, [])[0].minutes, 60);
  assert.equal(analyzeTiming({ ...session, is_retroactive: 1 }, sets, [])[0].minutes, null);
  assert.equal(analyzeTiming({ ...session, end_time: START + 60000 }, sets, [])[0].minutes, null);
  assert.equal(
    analyzeTiming(session, [set(1, 1), set(2, 2, { eligible: false })], [])[0].minutes,
    null,
  );
  assert.equal(sets[1].timestamp, START + 31 * 60000);
});

test('ETA counts remaining series per exercise, decreases for faster work and never counts a tap twice', () => {
  const history = [
    sample(15),
    sample(12, { exerciseId: 'peck-deck', implement: 'machine', sets: 4 }),
  ];
  const slow = remainingEstimate(
    data([set(5, 1), set(10, 2)], history),
    plan,
    catalog,
    START + 10 * 60000,
  );
  const fast = remainingEstimate(
    data([set(5, 1), set(7, 2)], history),
    plan,
    catalog,
    START + 7 * 60000,
  );
  assert.equal(fast.sets, 5);
  assert.ok(fast.seconds < slow.seconds);
  const done = remainingEstimate(
    data([set(5, 1), set(7, 2), set(9, 3)], history),
    plan,
    catalog,
    START + 9 * 60000,
  );
  assert.equal(done.sets, 4);
  assert.equal(done.seconds, 4 * 180 + 60);
  const later = remainingEstimate(
    data([set(5, 1), set(7, 2), set(9, 3)], history),
    plan,
    catalog,
    START + 100 * 60000,
  );
  assert.equal(later.sets, 4);
  assert.ok(later.seconds >= 3 * 180 + 30);
  assert.equal(later.overdue, true);
  assert.equal(
    remainingEstimate(
      data([set(1, 1), set(4, 2), set(7, 3)]),
      plan.slice(0, 1),
      catalog,
      START + 7 * 60000,
    ).seconds,
    0,
  );
});

test('default ETA includes unilateral work, warmup once, and reacts to plan changes', () => {
  const empty = data([]);
  const unilateral = [{ ...catalog[0], unilateral: 1 }];
  assert.equal(
    remainingEstimate(empty, plan.slice(0, 1), unilateral, START).seconds,
    300 + 60 + 3 * (180 + 90),
  );
  assert.equal(
    remainingEstimate(empty, plan.slice(0, 1), unilateral, START + 60000).seconds,
    240 + 60 + 3 * (180 + 90),
  );
  assert.equal(
    remainingEstimate(data([set(1, 1, { warmup: true })]), plan.slice(0, 1), catalog, START + 60000)
      .sets,
    3,
  );
  assert.equal(
    remainingEstimate(data([set(1, 1)]), [{ ...plan[0], sets: 1 }], catalog, START + 60000).sets,
    0,
  );
  assert.equal(historicalPace([sample(8), sample(10)], 'incline-db-press', 'dumbbell'), 180);
});

function fixture() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  let statements = 0;
  const db = {
    getAllAsync: async (sql: string, params: any[] = []) => {
      statements++;
      return raw.prepare(sql).all(...params);
    },
    getFirstAsync: async (sql: string, params: any[] = []) => {
      statements++;
      return raw.prepare(sql).get(...params) ?? null;
    },
    runAsync: async (sql: string, params: any[] = []) => {
      statements++;
      return raw.prepare(sql).run(...params);
    },
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
  return { db, raw, count: () => statements };
}

async function recorded(
  db: SQLiteDatabase,
  id: string,
  date: string,
  start: number,
  extra: { gym?: string; budget?: string } = {},
) {
  await db.runAsync(
    `INSERT INTO training_session (id, date, start_time, gym_id, time_budget) VALUES (?, ?, ?, ?, ?);`,
    [id, date, start, extra.gym ?? 'fanshawe', extra.budget ?? 'completo'],
  );
  for (let i = 1; i <= 3; i++)
    await addSet(db, {
      sessionId: id,
      exerciseId: 'incline-db-press',
      weightKg: 30,
      reps: 10,
      timestamp: start + i * 300000,
    });
  await db.runAsync('UPDATE training_session SET end_time = ? WHERE id = ?;', [
    start + 1200000,
    id,
  ]);
}

test('historical backfill is bounded, idempotent, context-specific and excludes the current session', async () => {
  const { db, raw, count } = fixture();
  await recorded(db, 'past', '2026-10-06', START - 86400000);
  await recorded(db, 'other-budget', '2026-10-06', START - 86400000, { budget: 'express' });
  await recorded(db, 'other-gym', '2026-10-06', START - 86400000, { gym: 'fit4less-proudfoot' });
  await recorded(db, 'old', '2026-01-01', START - 280 * 86400000);
  await recorded(db, 'current', '2026-10-07', START);
  await prepareTimingHistory(db, 'current');
  const timing = await readSessionTiming(db, 'current');
  assert.deepEqual(
    timing.history.map((sample) => sample.sessionId),
    ['past'],
  );
  assert.equal(timing.history[0].minutes, 15);
  assert.equal(
    (raw.prepare('SELECT count(*) AS n FROM training_exercise_time;').get() as { n: number }).n,
    2,
  );
  const before = count();
  await prepareTimingHistory(db, 'current');
  assert.equal(count() - before, 2);
  const readBefore = count();
  await readSessionTiming(db, 'current');
  assert.equal(count() - readBefore, 3);
});

test('closing, reopening, deleting, correcting and reloading preserve originals and rebuild summaries', async () => {
  const { db, raw } = fixture();
  const start = Date.now() - 30 * 60000;
  const id = await startSession(db, { date: '2026-10-07', timeBudget: 'completo' });
  await db.runAsync('UPDATE training_session SET start_time = ? WHERE id = ?;', [start, id]);
  const ids: string[] = [];
  for (let i = 1; i <= 3; i++)
    ids.push(
      await addSet(db, {
        sessionId: id,
        exerciseId: 'incline-db-press',
        weightKg: 30,
        reps: 10,
        timestamp: start + i * 300000,
      }),
    );
  await finishSession(db, id);
  const summary = () =>
    raw.prepare('SELECT minutes FROM training_exercise_time WHERE session_id = ?').get(id) as
      { minutes: number } | undefined;
  assert.equal(summary()?.minutes, 15);
  const original = raw.prepare('SELECT timestamp FROM training_set_entry WHERE id = ?').get(ids[1]);
  await reviewSetTiming(db, ids[1], { review: 'keep', seconds: 180 });
  assert.equal(summary()?.minutes, 12);
  assert.deepEqual(
    raw.prepare('SELECT timestamp FROM training_set_entry WHERE id = ?').get(ids[1]),
    original,
  );
  await reviewSetTiming(db, ids[1], { review: 'exclude', seconds: null });
  assert.equal(summary()?.minutes, null);
  await reviewSetTiming(db, ids[1], { review: 'auto', seconds: null });
  assert.equal(summary()?.minutes, 15);
  await reopenSession(db, id);
  assert.equal(summary(), undefined);
  await finishSession(db, id);
  assert.equal(summary()?.minutes, 15);
  await deleteSet(db, ids[2]);
  assert.equal(summary(), undefined);
  await prepareTimingHistory(db, id);
  assert.equal(summary()?.minutes, 10);
  await assert.rejects(reviewSetTiming(db, ids[0], { review: 'keep', seconds: -1 }));
  assert.equal(summary()?.minutes, 10);
});

test('a failure to store summaries rolls back the session close', async () => {
  const { db, raw } = fixture();
  const id = await startSession(db, { date: '2026-10-07', timeBudget: 'completo' });
  await addSet(db, { sessionId: id, exerciseId: 'peck-deck', weightKg: 30, reps: 10 });
  raw.exec(
    "CREATE TRIGGER reject_time BEFORE INSERT ON training_exercise_time BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
  );
  await assert.rejects(finishSession(db, id), /test failure/);
  assert.equal((await readSessionTiming(db, id)).session.end_time, null);
});

test('after-the-fact additions and session finish delays cannot become timing observations', async () => {
  const { db } = fixture();
  await recorded(db, 'closed', '2026-10-07', Date.now() - 3 * 3600000);
  await addSet(db, { sessionId: 'closed', exerciseId: 'incline-db-press', weightKg: 30, reps: 10 });
  const timing = await readSessionTiming(db, 'closed');
  assert.equal(timing.sets.at(-1)?.eligible, false);
  assert.equal(timing.exercises[0].samples, 2);
  await reopenSession(db, 'closed');
  await addSet(db, {
    sessionId: 'closed',
    exerciseId: 'incline-db-press',
    weightKg: 30,
    reps: 10,
    timingEligible: false,
  });
  await finishSession(db, 'closed');
  assert.equal((await readSessionTiming(db, 'closed')).session.duration_trusted, 0);
  await rebuildExerciseTimes(db, 'closed');
  assert.equal((await readSessionTiming(db, 'closed')).exercises[0].samples, 2);
});

test('upgrading an existing database preserves tap timestamps and backfills derived minutes', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations.slice(0, -1)) raw.exec(migration.sql);
  raw.exec(`INSERT INTO training_session (id, date, start_time, end_time, time_budget)
    VALUES ('legacy', '2026-10-07', 1000000, 3000000, 'completo');
    INSERT INTO training_set_entry (id, session_id, exercise_id, set_index, weight_kg, reps, timestamp)
    VALUES ('a', 'legacy', 'peck-deck', 1, 30, 10, 1300000),
           ('b', 'legacy', 'peck-deck', 2, 30, 10, 1600000),
           ('c', 'legacy', 'peck-deck', 3, 30, 10, 1900000);`);
  const before = raw.prepare('SELECT id, timestamp FROM training_set_entry ORDER BY id;').all();
  raw.exec(migrations.at(-1)!.sql);
  assert.deepEqual(
    raw.prepare('SELECT id, timestamp FROM training_set_entry ORDER BY id;').all(),
    before,
  );
  assert.equal(
    raw.prepare('SELECT timing_review FROM training_set_entry LIMIT 1;').get()?.timing_review,
    'auto',
  );
});

test('a correction invalidates later learned summaries so old outlier decisions are not reused', async () => {
  const { db, raw } = fixture();
  await recorded(db, 'past', '2026-10-06', START - 86400000);
  await recorded(db, 'current', '2026-10-07', START);
  await prepareTimingHistory(db, 'current');
  const past = await readSessionTiming(db, 'past');
  await reviewSetTiming(db, past.sets[1].id, { review: 'keep', seconds: 180 });
  assert.equal(
    raw.prepare("SELECT * FROM training_exercise_time WHERE session_id = 'current';").get(),
    undefined,
  );
  await prepareTimingHistory(db, 'current');
  assert.equal((await readSessionTiming(db, 'current')).history[0].minutes, 12);
});

test('backfilling missing early sessions refreshes an already-stored later classification', async () => {
  const { db, raw } = fixture();
  for (let day = 1; day <= 5; day++) {
    await recorded(db, `past-${day}`, `2026-10-0${day}`, START - (7 - day) * 86400000);
  }
  await recorded(db, 'current', '2026-10-07', START);
  raw
    .prepare(
      "UPDATE training_set_entry SET timestamp = ? WHERE session_id = 'current' AND set_index = 2;",
    )
    .run(START + 16 * 60000);
  raw
    .prepare(
      "UPDATE training_set_entry SET timestamp = ? WHERE session_id = 'current' AND set_index = 3;",
    )
    .run(START + 19 * 60000);
  await rebuildExerciseTimes(db, 'current');
  assert.equal(
    raw
      .prepare("SELECT sample_count FROM training_exercise_time WHERE session_id = 'current';")
      .get()?.sample_count,
    2,
  );
  await prepareTimingHistory(db, 'current');
  assert.equal(
    raw
      .prepare("SELECT sample_count FROM training_exercise_time WHERE session_id = 'current';")
      .get()?.sample_count,
    1,
  );
});

test('an excluded or future last tap cannot provide elapsed-time credit to the ETA', () => {
  const excluded = data([set(1, 1, { review: 'exclude' })]);
  const now = START + 20 * 60000;
  assert.equal(remainingEstimate(excluded, plan.slice(0, 1), catalog, now).seconds, 2 * (180 + 45));
  const future = data([set(30, 1)]);
  assert.equal(remainingEstimate(future, plan.slice(0, 1), catalog, now).seconds, 2 * (180 + 45));
});
