// Exercises the migration SQL against node:sqlite, which is the same engine the
// app runs on device through expo-sqlite. What it does not cover is the
// expo-sqlite wrapper in migrate.ts, which needs the Expo runtime.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { migrations } from './migrations/index.ts';

function freshDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) db.exec(migration.sql);
  return db;
}

function tableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

function rejects(db: DatabaseSync, sql: string): string {
  try {
    db.exec(sql);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`expected this to be rejected: ${sql}`);
}

function seedExercise(db: DatabaseSync, id = 'ex-1', primary = 'triceps'): void {
  db.exec(`INSERT INTO training_exercise
    (id, name_es, name_en, primary_muscle, equipment_type, load_increment, default_rest_seconds)
    VALUES ('${id}', 'Fondos', 'Dips', '${primary}', 'bodyweight', 2.5, 180);`);
}

test('every migration has a unique id and they apply in order', () => {
  const ids = migrations.map((migration) => migration.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [...ids].sort());
});

test('the schema contains every table in spec section 5', () => {
  const names = tableNames(freshDatabase());
  for (const expected of [
    'core_daily_log',
    'core_target_snapshot',
    'training_gym',
    'training_exercise',
    'training_exercise_muscle',
    'training_exercise_gym',
    'training_routine',
    'training_routine_exercise',
    'training_session',
    'training_set_entry',
    'nutrition_food',
    'nutrition_container',
    'nutrition_batch',
    'nutrition_food_entry',
  ]) {
    assert.ok(names.includes(expected), `missing table ${expected}`);
  }
});

test('the 710 ml bottle is seeded', () => {
  const row = freshDatabase().prepare('SELECT name, volume_ml FROM nutrition_container;').get() as {
    name: string;
    volume_ml: number;
  };
  assert.equal(row.volume_ml, 710);
});

test('tables are STRICT, so a text value cannot land in an integer column', () => {
  const db = freshDatabase();
  const message = rejects(
    db,
    "INSERT INTO core_daily_log (date, steps, has_data) VALUES ('2026-09-13', 'muchos', 1);",
  );
  assert.match(message, /cannot store .* value in INTEGER column/i);
});

test('a day-scoped date must be YYYY-MM-DD', () => {
  const db = freshDatabase();
  rejects(db, "INSERT INTO core_daily_log (date, has_data) VALUES ('13-09-2026', 1);");
  rejects(db, "INSERT INTO core_daily_log (date, has_data) VALUES ('2026-9-13', 1);");
  db.exec("INSERT INTO core_daily_log (date, has_data) VALUES ('2026-09-13', 1);");
});

test('sleep minutes and sleep source travel together', () => {
  const db = freshDatabase();
  rejects(
    db,
    "INSERT INTO core_daily_log (date, sleep_minutes, has_data) VALUES ('2026-09-13', 430, 1);",
  );
  db.exec(
    "INSERT INTO core_daily_log (date, sleep_minutes, sleep_source, has_data) VALUES ('2026-09-13', 430, 'autosleep', 1);",
  );
});

test('contribution 1.0 must be the exercise primary muscle', () => {
  const db = freshDatabase();
  seedExercise(db);

  const message = rejects(
    db,
    "INSERT INTO training_exercise_muscle VALUES ('ex-1', 'chest', 1.0);",
  );
  assert.match(message, /primary_muscle/);

  db.exec("INSERT INTO training_exercise_muscle VALUES ('ex-1', 'triceps', 1.0);");
  db.exec("INSERT INTO training_exercise_muscle VALUES ('ex-1', 'chest', 0.5);");
});

test('the primary muscle cannot also be recorded as a secondary', () => {
  const db = freshDatabase();
  seedExercise(db);
  rejects(db, "INSERT INTO training_exercise_muscle VALUES ('ex-1', 'triceps', 0.5);");
});

test('weekly set volume per muscle weights secondaries at half', () => {
  const db = freshDatabase();
  seedExercise(db, 'ex-1', 'triceps');
  db.exec("INSERT INTO training_exercise_muscle VALUES ('ex-1', 'triceps', 1.0);");
  db.exec("INSERT INTO training_exercise_muscle VALUES ('ex-1', 'chest', 0.5);");
  db.exec(
    "INSERT INTO training_session (id, date, time_budget) VALUES ('s-1', '2026-09-13', 'completo');",
  );
  for (let index = 1; index <= 4; index += 1) {
    db.exec(
      `INSERT INTO training_set_entry (id, session_id, exercise_id, set_index, weight_kg, reps, timestamp)
       VALUES ('set-${index}', 's-1', 'ex-1', ${index}, 0, 10, 1789000000000);`,
    );
  }

  const rows = db
    .prepare(
      `SELECT m.muscle, SUM(m.contribution) AS sets
         FROM training_set_entry s
         JOIN training_exercise_muscle m ON m.exercise_id = s.exercise_id
        WHERE s.is_warmup = 0
     GROUP BY m.muscle
     ORDER BY m.muscle;`,
    )
    .all() as { muscle: string; sets: number }[];

  assert.deepEqual(
    rows.map((row) => ({ muscle: row.muscle, sets: row.sets })),
    [
      { muscle: 'chest', sets: 2 },
      { muscle: 'triceps', sets: 4 },
    ],
  );
});

test('tier 1 keeps its set count at every budget', () => {
  const db = freshDatabase();
  seedExercise(db);
  db.exec("INSERT INTO training_routine (id, name) VALUES ('r-1', 'Push');");

  rejects(
    db,
    `INSERT INTO training_routine_exercise
       (id, routine_id, exercise_id, position, tier, sets_full, sets_minus_25, sets_minus_50, sets_express, target_rep_mode, target_rep_min, target_rep_max)
     VALUES ('re-1', 'r-1', 'ex-1', 1, 1, 4, 3, 3, 3, 'range', 12, 15);`,
  );

  db.exec(
    `INSERT INTO training_routine_exercise
       (id, routine_id, exercise_id, position, tier, sets_full, sets_minus_25, sets_minus_50, sets_express, target_rep_mode, target_rep_min, target_rep_max)
     VALUES ('re-1', 'r-1', 'ex-1', 1, 1, 4, 4, 4, 4, 'range', 12, 15);`,
  );
});

test('a rep range needs both bounds and AMRAP needs neither', () => {
  const db = freshDatabase();
  seedExercise(db);
  db.exec("INSERT INTO training_routine (id, name) VALUES ('r-1', 'Pull');");

  rejects(
    db,
    `INSERT INTO training_routine_exercise
       (id, routine_id, exercise_id, position, tier, sets_full, target_rep_mode, target_rep_min)
     VALUES ('re-1', 'r-1', 'ex-1', 1, 3, 3, 'range', 8);`,
  );
  rejects(
    db,
    `INSERT INTO training_routine_exercise
       (id, routine_id, exercise_id, position, tier, sets_full, target_rep_mode, target_rep_min, target_rep_max)
     VALUES ('re-2', 'r-1', 'ex-1', 2, 3, 3, 'amrap', 8, 10);`,
  );
  db.exec(
    `INSERT INTO training_routine_exercise
       (id, routine_id, exercise_id, position, tier, sets_full, sets_minus_25, sets_minus_50, sets_express, target_rep_mode)
     VALUES ('re-3', 'r-1', 'ex-1', 3, 1, 4, 4, 4, 4, 'amrap');`,
  );
});

test('tier 1 cannot be dropped at a budget by leaving the column null', () => {
  const db = freshDatabase();
  seedExercise(db);
  db.exec("INSERT INTO training_routine (id, name) VALUES ('r-1', 'Legs');");
  rejects(
    db,
    `INSERT INTO training_routine_exercise
       (id, routine_id, exercise_id, position, tier, sets_full, target_rep_mode)
     VALUES ('re-1', 'r-1', 'ex-1', 1, 1, 3, 'failure');`,
  );
});

test('a retroactive session cannot carry crowding', () => {
  const db = freshDatabase();
  rejects(
    db,
    `INSERT INTO training_session (id, date, time_budget, crowding, is_retroactive)
     VALUES ('s-1', '2026-09-13', 'completo', 'full', 1);`,
  );
  db.exec(
    `INSERT INTO training_session (id, date, time_budget, crowding, is_retroactive)
     VALUES ('s-2', '2026-09-13', 'completo', 'full', 0);`,
  );
});

test('a set entry cannot reference a session that does not exist', () => {
  const db = freshDatabase();
  seedExercise(db);
  const message = rejects(
    db,
    `INSERT INTO training_set_entry (id, session_id, exercise_id, set_index, weight_kg, reps, timestamp)
     VALUES ('set-1', 'nope', 'ex-1', 1, 40, 8, 1789000000000);`,
  );
  assert.match(message, /FOREIGN KEY/i);
});

test('deleting a session takes its sets with it', () => {
  const db = freshDatabase();
  seedExercise(db);
  db.exec(
    "INSERT INTO training_session (id, date, time_budget) VALUES ('s-1', '2026-09-13', 'completo');",
  );
  db.exec(
    `INSERT INTO training_set_entry (id, session_id, exercise_id, set_index, weight_kg, reps, timestamp)
     VALUES ('set-1', 's-1', 'ex-1', 1, 40, 8, 1789000000000);`,
  );
  db.exec("DELETE FROM training_session WHERE id = 's-1';");

  const remaining = db.prepare('SELECT COUNT(*) AS n FROM training_set_entry;').get() as {
    n: number;
  };
  assert.equal(remaining.n, 0);
});

test('a batch cannot have more portions left than it was divided into', () => {
  const db = freshDatabase();
  db.exec(
    `INSERT INTO nutrition_food (id, name, base_unit, kcal, protein_g, carbs_g, fat_g, source)
     VALUES ('f-1', 'Pechuga de pollo', '100g', 165, 31, 0, 3.6, 'user_measured');`,
  );
  rejects(
    db,
    `INSERT INTO nutrition_batch (id, food_id, raw_weight_g, portions_count, cooked_date, portions_remaining)
     VALUES ('b-1', 'f-1', 1600, 6, '2026-09-13', 7);`,
  );
  db.exec(
    `INSERT INTO nutrition_batch (id, food_id, raw_weight_g, portions_count, cooked_date, portions_remaining)
     VALUES ('b-2', 'f-1', 1600, 6, '2026-09-13', 6);`,
  );
});

test('sugar cannot exceed total carbohydrate', () => {
  const db = freshDatabase();
  rejects(
    db,
    `INSERT INTO nutrition_food (id, name, base_unit, kcal, protein_g, carbs_g, sugar_g, fat_g, source)
     VALUES ('f-1', 'Leche 1%', '250ml', 100, 9, 12, 14, 2.5, 'user_measured');`,
  );
});

test('price is stored in whole cents', () => {
  const db = freshDatabase();
  const message = rejects(
    db,
    `INSERT INTO nutrition_food (id, name, base_unit, kcal, protein_g, carbs_g, fat_g, source, price_cad_cents)
     VALUES ('f-1', 'Avena', '40g', 150, 5, 27, 3, 'user_measured', 7.19);`,
  );
  assert.match(message, /cannot store .* value in INTEGER column/i);
});
