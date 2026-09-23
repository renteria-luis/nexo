import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { upsertDailyLog } from '../core/daily-log.ts';
import { formatWeight, fromKg, snapToIncrement, toKg } from '../core/units.ts';
import { migrations } from '../db/migrations/index.ts';

import { bestAndWorstE1rm, volumeLoad } from './calculations.ts';
import { listEquipment, listExercises, listWorkingSets } from './queries.ts';
import {
  addSet,
  setSessionDetails,
  deleteSet,
  finishSession,
  getSessionOn,
  lastSessionSets,
  marksWindow,
  startSession,
} from './sessions.ts';

type SqlValue = string | number | null;

function adapt(db: DatabaseSync): SQLiteDatabase {
  return {
    getAllAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T[]> =>
      db.prepare(source).all(...params) as T[],
    getFirstAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T | null> =>
      (db.prepare(source).get(...params) as T) ?? null,
    runAsync: async (source: string, params: SqlValue[] = []) => {
      db.prepare(source).run(...params);
      return { changes: 0, lastInsertRowId: 0 };
    },
  } as unknown as SQLiteDatabase;
}

function fresh(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  return adapt(raw);
}

/** Backdates a session so the tests can build a history without waiting. */
async function sessionOn(db: SQLiteDatabase, date: string): Promise<string> {
  const id = await startSession(db, { date, timeBudget: 'completo' });
  return id;
}

test('a session can be logged without a gym or a routine', async () => {
  const db = fresh();
  const id = await sessionOn(db, '2026-09-13');

  const session = await getSessionOn(db, '2026-09-13');
  assert.equal(session?.id, id);
  assert.equal(session?.gym_id, null);
  assert.equal(session?.routine_id, null);
  assert.equal(session?.end_time, null);

  await finishSession(db, id);
  assert.ok((await getSessionOn(db, '2026-09-13'))?.end_time);
});

test('set numbers run per exercise, not per session', async () => {
  const db = fresh();
  const id = await sessionOn(db, '2026-09-13');

  await addSet(db, { sessionId: id, exerciseId: 'incline-db-press', weightKg: 30, reps: 8 });
  await addSet(db, { sessionId: id, exerciseId: 'peck-deck', weightKg: 50, reps: 14 });
  await addSet(db, { sessionId: id, exerciseId: 'incline-db-press', weightKg: 30, reps: 7 });

  const sets = await listWorkingSets(db, { from: '2026-09-13', to: '2026-09-13' });
  const press = sets.filter((set) => set.exerciseId === 'incline-db-press');
  const deck = sets.filter((set) => set.exerciseId === 'peck-deck');

  assert.deepEqual(
    press.map((set) => set.setIndex),
    [1, 2],
  );
  assert.deepEqual(
    deck.map((set) => set.setIndex),
    [1],
  );
});

test('an impossible set is refused rather than stored', async () => {
  const db = fresh();
  const id = await sessionOn(db, '2026-09-13');

  await assert.rejects(
    () => addSet(db, { sessionId: id, exerciseId: 'peck-deck', weightKg: 50, reps: 0 }),
    /is not a set/,
  );
  await assert.rejects(
    () => addSet(db, { sessionId: id, exerciseId: 'peck-deck', weightKg: -5, reps: 10 }),
    /cannot weigh/,
  );
});

test('a session adds up to its volume load', async () => {
  const db = fresh();
  const id = await sessionOn(db, '2026-09-13');

  for (const reps of [8, 8, 7]) {
    await addSet(db, { sessionId: id, exerciseId: 'incline-db-press', weightKg: 30, reps });
  }
  await addSet(db, {
    sessionId: id,
    exerciseId: 'incline-db-press',
    weightKg: 20,
    reps: 12,
    isWarmup: true,
  });

  const sets = await listWorkingSets(db, { from: '2026-09-13', to: '2026-09-13' });
  // The warmup is left out, per spec 5.5.
  assert.equal(sets.length, 3);
  // Thirty kilos is what one dumbbell says and he lifts two of them, so the volume
  // is double the number he typed. The number he typed is what he still reads back.
  assert.equal(sets[0].weightKg, 30);
  assert.equal(sets[0].loadFactor, 2);
  assert.equal(volumeLoad(sets), 30 * 2 * 23);
});

test('removing a set takes it out of the volume', async () => {
  const db = fresh();
  const id = await sessionOn(db, '2026-09-13');
  const first = await addSet(db, {
    sessionId: id,
    exerciseId: 'peck-deck',
    weightKg: 50,
    reps: 14,
  });
  await addSet(db, { sessionId: id, exerciseId: 'peck-deck', weightKg: 50, reps: 13 });

  await deleteSet(db, first);
  const sets = await listWorkingSets(db, { from: '2026-09-13', to: '2026-09-13' });
  assert.equal(sets.length, 1);
  assert.equal(volumeLoad(sets), 650);
});

test('last time means the previous session, not the one in progress', async () => {
  const db = fresh();

  const older = await sessionOn(db, '2026-09-06');
  await addSet(db, { sessionId: older, exerciseId: 'incline-db-press', weightKg: 28, reps: 8 });
  await addSet(db, { sessionId: older, exerciseId: 'incline-db-press', weightKg: 28, reps: 8 });

  const today = await sessionOn(db, '2026-09-13');
  await addSet(db, { sessionId: today, exerciseId: 'incline-db-press', weightKg: 30, reps: 8 });

  const previous = await lastSessionSets(db, 'incline-db-press', today);
  assert.equal(previous.length, 2);
  assert.equal(previous[0].date, '2026-09-06');
  assert.equal(previous[0].weightKg, 28);
});

test('an exercise never done has no last time, which is not an error', async () => {
  const db = fresh();
  const id = await sessionOn(db, '2026-09-13');
  assert.deepEqual(await lastSessionSets(db, 'hack-squat', id), []);
});

test('the marks window is eight weeks, pulled forward while readapting', () => {
  assert.deepEqual(marksWindow('2026-09-13', null), { from: '2026-07-20', to: '2026-09-13' });
  // Spec 6.5: a deliberate 70% deload is never measured against pre-layoff marks.
  assert.deepEqual(marksWindow('2026-09-13', '2026-09-05'), {
    from: '2026-09-05',
    to: '2026-09-13',
  });
});

test('the marks come from the window and skip sets above 12 reps', async () => {
  const db = fresh();

  const old = await sessionOn(db, '2026-06-01');
  await addSet(db, { sessionId: old, exerciseId: 'incline-db-press', weightKg: 40, reps: 8 });

  const recent = await sessionOn(db, '2026-09-10');
  await addSet(db, { sessionId: recent, exerciseId: 'incline-db-press', weightKg: 30, reps: 8 });
  await addSet(db, { sessionId: recent, exerciseId: 'incline-db-press', weightKg: 32.5, reps: 6 });
  await addSet(db, { sessionId: recent, exerciseId: 'incline-db-press', weightKg: 35, reps: 20 });

  const window = marksWindow('2026-09-13', null);
  const sets = await listWorkingSets(db, window, 'incline-db-press');
  const marks = bestAndWorstE1rm(sets);

  // June is outside the eight weeks and the 20 rep set does not qualify.
  assert.ok(marks);
  assert.equal(marks.best.set.weightKg, 32.5);
  assert.equal(marks.worst.set.weightKg, 30);
});

test('the gym catalogue is seeded with what he recorded at Fanshawe', async () => {
  const db = fresh();
  const equipment = await listEquipment(db, 'fanshawe');

  assert.equal(equipment.length, 27);

  const byCode = new Map(equipment.filter((e) => e.model_code).map((e) => [e.model_code, e]));
  assert.equal(byCode.get('C105')?.name_es, 'Extensión de piernas');
  assert.equal(byCode.get('C114')?.name_es, 'Aductores');
  assert.equal(byCode.get('C115')?.name_es, 'Abductores');
  assert.equal(byCode.get('NM537')?.name_es, 'Remo divergente y deltoide posterior');
  assert.equal(byCode.get('P250')?.name_es, 'Multi press');

  // Spec 2.1: definition is a total leanness outcome, never a property of a
  // machine, so the only qualities on offer are these four.
  const uses = new Set(equipment.map((e) => e.primary_use).filter(Boolean));
  for (const use of uses) {
    assert.ok(['hypertrophy', 'strength', 'endurance', 'mobility'].includes(use as string));
  }
});

test('every machine he recorded is identified, none left as a bare code', async () => {
  const db = fresh();
  const equipment = await listEquipment(db, 'fanshawe');

  assert.equal(equipment.filter((e) => e.name_es.startsWith('Sin identificar')).length, 0);
  for (const code of ['C114', 'C115', 'P250', 'NM537']) {
    const found = equipment.find((e) => e.model_code === code);
    assert.ok(found, `falta ${code}`);
    assert.ok(found.load_increment !== null, `${code} sin paso de carga`);
  }
});

test('the P series is selectorized and only the V-Squat takes plates', async () => {
  const db = fresh();
  const equipment = await listEquipment(db, 'fanshawe');

  // P### is the Precision Series and runs on a stack; PW### is the plate-loaded
  // line and this gym has none of it. Reading that backwards is what made the
  // first version of this catalogue call the P140 plate-loaded.
  for (const code of ['P140', 'P156', 'P250']) {
    assert.equal(equipment.find((e) => e.model_code === code)?.kind, 'selectorized', code);
  }
  assert.deepEqual(
    equipment.filter((e) => e.kind === 'plate_loaded').map((e) => e.name_es),
    ['Sentadilla en V'],
  );
});

test('the weight step comes from the machine, not from the exercise', async () => {
  const db = fresh();
  const exercises = await listExercises(db, 'fanshawe');
  const byId = new Map(exercises.map((e) => [e.id, e]));

  // His main chest press is the P140, a stack that moves 10 lb at a time.
  const press = byId.get('seated-chest-press');
  assert.equal(press?.equipment?.model_code, 'P140');
  assert.ok(Math.abs(fromKg(press?.stepKg ?? 0, 'lb') - 10) < 1e-9);

  // The pec deck is the P156, also a stack.
  const peck = byId.get('peck-deck');
  assert.equal(peck?.equipment?.model_code, 'P156');
  assert.ok(Math.abs(fromKg(peck?.stepKg ?? 0, 'lb') - 10) < 1e-9);

  // Dumbbells go up 2.5 lb at a time at the bottom of the rack.
  const incline = byId.get('incline-db-press');
  assert.ok(Math.abs(fromKg(incline?.stepKg ?? 0, 'lb') - 2.5) < 1e-9);

  // The V-Squat takes a pair of the smallest plates he has.
  const hack = byId.get('hack-squat');
  assert.ok(Math.abs(fromKg(hack?.stepKg ?? 0, 'lb') - 5) < 1e-9);
});

test('pounds convert both ways without drifting', () => {
  const oneThirtyFive = toKg(135, 'lb');
  assert.ok(Math.abs(fromKg(oneThirtyFive, 'lb') - 135) < 1e-9);
  assert.equal(formatWeight(oneThirtyFive, 'lb'), '135');
  assert.equal(formatWeight(oneThirtyFive, 'kg'), '61.23');
  assert.equal(formatWeight(toKg(10, 'lb'), 'lb'), '10');
});

test('a weight snaps to the step the machine actually moves in', () => {
  const tenPounds = toKg(10, 'lb');
  assert.equal(formatWeight(snapToIncrement(toKg(133, 'lb'), tenPounds), 'lb'), '130');
  assert.equal(formatWeight(snapToIncrement(toKg(136, 'lb'), tenPounds), 'lb'), '140');
  assert.equal(snapToIncrement(toKg(-50, 'lb'), tenPounds), 0);
  assert.throws(() => snapToIncrement(10, 0), /is not a step/);
});

test('the rest before a set is measured from the previous set of that exercise', async () => {
  const db = fresh();
  const sessionId = await startSession(db, { date: '2026-09-15', timeBudget: 'completo' });

  const realNow = Date.now;
  try {
    Date.now = () => 1_700_000_000_000;
    await addSet(db, { sessionId, exerciseId: 'peck-deck', weightKg: 40, reps: 12 });
    Date.now = () => 1_700_000_095_000;
    await addSet(db, { sessionId, exerciseId: 'peck-deck', weightKg: 40, reps: 11 });
    // A different exercise starts its own count instead of borrowing this one.
    Date.now = () => 1_700_000_200_000;
    await addSet(db, { sessionId, exerciseId: 'lateral-raise', weightKg: 10, reps: 15 });
    // A set typed in after the fact says what the rest was.
    Date.now = () => 1_700_000_900_000;
    await addSet(db, {
      sessionId,
      exerciseId: 'peck-deck',
      weightKg: 40,
      reps: 10,
      restBeforeSeconds: 240,
    });
  } finally {
    Date.now = realNow;
  }

  const sets = await listWorkingSets(db, { from: '2026-09-15', to: '2026-09-15' });
  const peckDeck = sets.filter((set) => set.exerciseId === 'peck-deck');

  assert.equal(peckDeck[0].restBeforeSeconds, null);
  assert.equal(peckDeck[1].restBeforeSeconds, 95);
  assert.equal(peckDeck[2].restBeforeSeconds, 240);
  assert.equal(sets.find((set) => set.exerciseId === 'lateral-raise')?.restBeforeSeconds, null);
});

test('how busy the gym was belongs to a session he was actually at', async () => {
  const db = fresh();
  const live = await startSession(db, { date: '2026-09-15', timeBudget: 'completo' });
  await setSessionDetails(db, live, { aloneOrPartner: 'with_someone', crowding: 'full' });

  const stored = await getSessionOn(db, '2026-09-15');
  assert.equal(stored?.alone_or_partner, 'with_someone');
  assert.equal(stored?.crowding, 'full');

  const remembered = await startSession(db, {
    date: '2026-09-14',
    timeBudget: 'completo',
    isRetroactive: true,
  });
  await assert.rejects(
    () => setSessionDetails(db, remembered, { crowding: 'normal' }),
    /after the fact/,
  );
  // The company he had is still worth recording days later.
  await setSessionDetails(db, remembered, { aloneOrPartner: 'alone' });
  assert.equal((await getSessionOn(db, '2026-09-14'))?.alone_or_partner, 'alone');
});

test('the second gym is seeded with what he recorded at Fit4Less', async () => {
  const db = fresh();
  const equipment = await listEquipment(db, 'fit4less-proudfoot');

  assert.equal(equipment.length, 27);

  const byName = new Map(equipment.map((item) => [item.name_es, item]));

  // The machine Fanshawe does not have, and the reason the lateral raise can be
  // trained there without touching a dumbbell.
  const deltoid = byName.get('Elevaciones laterales en maquina');
  assert.equal(deltoid?.model_code, 'IPDR3');
  assert.equal(deltoid?.kind, 'selectorized');

  // Lock n Load picks the weight with a switch, but the stack still moves 10 lb.
  for (const name of ['Press de pecho en maquina', 'Remo en maquina', 'Aductores']) {
    assert.ok(Math.abs(fromKg(byName.get(name)?.load_increment ?? 0, 'lb') - 10) < 1e-9, name);
  }

  // The Star Trac rows are labelled in pounds, 22 to 165, and every plate is a
  // round 5 kg: 143 lb is the 65 kg he rowed on the 16th.
  const row = byName.get('Remo sentado');
  assert.equal(row?.load_increment, 5);
  assert.equal(row?.stack_min_kg, 10);
  assert.equal(row?.stack_max_kg, 75);

  assert.deepEqual(
    equipment
      .filter((item) => item.kind === 'plate_loaded')
      .map((item) => item.name_es)
      .sort(),
    ['Prensa inclinada de discos', 'Sentadilla hack'],
  );

  // El gimnasio basico esta, pero el salto de las mancuernas no lo ha leido todavia,
  // y la columna lo dice en vez de fingir una medida suya.
  const dumbbells = byName.get('Mancuernas');
  assert.equal(dumbbells?.kind, 'free_weight');
  assert.equal(dumbbells?.increment_confirmed, 0);
  assert.ok(byName.has('Bancos'));
  assert.ok(byName.has('Maquina Smith'));
});

test('the same exercise takes the step of the gym he is standing in', async () => {
  const db = fresh();

  // At Fit4Less the lateral raise is a machine, so the stack decides the step.
  const atFit4Less = (await listExercises(db, 'fit4less-proudfoot')).find(
    (item) => item.id === 'lateral-raise',
  );
  assert.ok(Math.abs(fromKg(atFit4Less?.stepKg ?? 0, 'lb') - 10) < 1e-9);

  // At Fanshawe there is no such machine and it is done with dumbbells, which move
  // in 2.5 lb steps: the same exercise, four times finer, because of where he stands.
  const atFanshawe = (await listExercises(db, 'fanshawe')).find(
    (item) => item.id === 'lateral-raise',
  );
  assert.equal(atFanshawe?.equipment?.name_es, 'Mancuernas');
  assert.ok(Math.abs(fromKg(atFanshawe?.stepKg ?? 0, 'lb') - 2.5) < 1e-9);
});

test('the Matrix pulley stack is the one he read at the machine', async () => {
  const db = fresh();
  const tower = (await listEquipment(db, 'fanshawe')).find(
    (item) => item.id === 'fan-matrix-cable',
  );

  // 2.5, 7.5, 12.5 ... 97.5 lb: the first brick weighs 2.5 and the other nineteen
  // weigh 5, which is why the stack climbs in fives from an odd starting point.
  assert.ok(Math.abs(fromKg(tower?.stack_min_kg ?? 0, 'lb') - 2.5) < 1e-9);
  assert.ok(Math.abs(fromKg(tower?.stack_max_kg ?? 0, 'lb') - 97.5) < 1e-9);
  assert.ok(Math.abs(fromKg(tower?.load_increment ?? 0, 'lb') - 5) < 1e-9);
  assert.equal(tower?.increment_confirmed, 1);
});

test('las dominadas pesan lo que pesa el, aunque no se ponga lastre', async () => {
  const db = fresh();
  await upsertDailyLog(db, { date: '2026-09-10', weightKg: 73 });

  const id = await sessionOn(db, '2026-09-13');
  await addSet(db, { sessionId: id, exerciseId: 'pull-up', weightKg: 0, reps: 10 });

  const [set] = await listWorkingSets(db, { from: '2026-09-13', to: '2026-09-13' });

  // No se peso ese dia: vale el ultimo peso conocido, que es el del 10.
  assert.equal(set.bodyWeightKg, 73);
  assert.equal(volumeLoad([set]), 730);
  // Y la marca deja de ser cero, que era lo que no decia nada.
  assert.ok((bestAndWorstE1rm([set])?.best.e1rm ?? 0) > 73);
});

test('sin ningun peso registrado una dominada no inventa uno', async () => {
  const db = fresh();
  const id = await sessionOn(db, '2026-09-13');
  await addSet(db, { sessionId: id, exerciseId: 'pull-up', weightKg: 0, reps: 10 });

  const [set] = await listWorkingSets(db, { from: '2026-09-13', to: '2026-09-13' });
  assert.equal(set.bodyWeightKg, null);
  assert.equal(volumeLoad([set]), 0);
});
