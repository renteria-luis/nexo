// Spec 13.1, his routine as it is today, plus the table that remembers what a
// session was actually planned to be.
//
// NOT spec 8.4. That table is written for the routine after the spec 13.3 proposals
// and spec 13.4 forbids applying any of them until re-entry ends. What is seeded
// here is what he already does, so the trimming in spec 8.3 has something real to
// work on now; the 8.4 numbers land in their own migration the day the deload ends.
//
// The per budget columns follow spec 8.3 mechanically rather than inventing numbers:
//   tier 1  never changes, at any budget
//   tier 2  keeps its sets at -25%, loses one at -50% (never below 2), dropped at Express
//   tier 3  loses one at -25% (never below 2), dropped at -50% and Express
//   tier 4  dropped at every reduced budget
export const sql = `
INSERT INTO training_routine (id, name) VALUES
  ('push', 'Push'),
  ('pull', 'Pull'),
  ('legs', 'Pierna');

INSERT INTO training_routine_exercise
  (id, routine_id, exercise_id, position, tier,
   sets_full, sets_minus_25, sets_minus_50, sets_express,
   target_rep_mode, target_rep_min, target_rep_max)
VALUES
  ('push-1', 'push', 'incline-db-press',   1, 1, 3, 3, 3, 3, 'range', 8, 8),
  ('push-2', 'push', 'peck-deck',          2, 2, 4, 4, 3, NULL, 'range', 12, 15),
  ('push-3', 'push', 'seated-chest-press', 3, 2, 3, 3, 2, NULL, 'range', 10, 12),
  ('push-4', 'push', 'overhead-triceps',   4, 2, 3, 3, 2, NULL, 'range', 10, 12),
  ('push-5', 'push', 'triceps-pulldown',   5, 3, 3, 2, NULL, NULL, 'range', 12, 12),
  ('push-6', 'push', 'lateral-raise',      6, 3, 3, 2, NULL, NULL, 'range', 12, 15),

  ('pull-1', 'pull', 'pull-up',           1, 1, 4, 4, 4, 4, 'amrap', NULL, NULL),
  ('pull-2', 'pull', 'cable-row-narrow',  2, 1, 3, 3, 3, 3, 'range', 10, 10),
  ('pull-3', 'pull', 'incline-curl',      3, 2, 3, 3, 2, NULL, 'range', 10, 10),
  ('pull-4', 'pull', 'hammer-curl',       4, 2, 3, 3, 2, NULL, 'range', 10, 12),
  ('pull-5', 'pull', 'preacher-curl',     5, 3, 3, 2, NULL, NULL, 'range', 10, 10),
  ('pull-6', 'pull', 'reverse-pec-deck',  6, 4, 3, NULL, NULL, NULL, 'range', 15, 15),

  ('legs-1', 'legs', 'hack-squat',    1, 1, 3, 3, 3, 3, 'range', 8, 10),
  ('legs-2', 'legs', 'leg-curl',      2, 2, 3, 3, 2, NULL, 'range', 12, 12),
  ('legs-3', 'legs', 'leg-extension', 3, 2, 3, 3, 2, NULL, 'failure', NULL, NULL),
  ('legs-4', 'legs', 'hip-adductor',  4, 3, 3, 2, NULL, NULL, 'range', 12, 12),
  ('legs-5', 'legs', 'lateral-raise', 5, 3, 3, 2, NULL, NULL, 'range', 12, 15);

-- Spec 8.3 rule 8: a set count changed on the approval screen holds for that session
-- and never touches the routine. Without this table an override would be gone the
-- moment the screen closes.
CREATE TABLE training_session_plan (
  session_id   TEXT    NOT NULL REFERENCES training_session (id) ON DELETE CASCADE,
  exercise_id  TEXT    NOT NULL REFERENCES training_exercise (id),
  position     INTEGER NOT NULL CHECK (position > 0),
  sets_planned INTEGER NOT NULL CHECK (sets_planned > 0),
  rest_seconds INTEGER NOT NULL CHECK (rest_seconds > 0),
  PRIMARY KEY (session_id, exercise_id)
) STRICT;
`;
