export const sql = `
CREATE TABLE training_routine (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE training_routine_exercise (
  id              TEXT    PRIMARY KEY,
  routine_id      TEXT    NOT NULL REFERENCES training_routine (id) ON DELETE CASCADE,
  exercise_id     TEXT    NOT NULL REFERENCES training_exercise (id),
  position        INTEGER NOT NULL CHECK (position > 0),
  tier            INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 4),
  -- One column per time budget (spec 8.2). NULL is the dash in the 8.4 tables:
  -- the exercise is dropped at that budget.
  sets_full       INTEGER NOT NULL CHECK (sets_full > 0),
  sets_minus_25   INTEGER CHECK (sets_minus_25 > 0),
  sets_minus_50   INTEGER CHECK (sets_minus_50 > 0),
  sets_express    INTEGER CHECK (sets_express > 0),
  target_rep_mode TEXT    NOT NULL CHECK (target_rep_mode IN ('range', 'amrap', 'failure')),
  target_rep_min  INTEGER CHECK (target_rep_min > 0),
  target_rep_max  INTEGER CHECK (target_rep_max >= target_rep_min),
  UNIQUE (routine_id, position),
  UNIQUE (routine_id, exercise_id),
  -- A rep range needs both bounds; AMRAP and failure carry neither.
  CHECK (
    (target_rep_mode = 'range'  AND target_rep_min IS NOT NULL AND target_rep_max IS NOT NULL) OR
    (target_rep_mode <> 'range' AND target_rep_min IS NULL     AND target_rep_max IS NULL)
  ),
  -- Spec 8.3 rule 4: tier 1 sets never change and tier 1 is never dropped, at any
  -- budget. IS rather than = so a NULL budget column fails instead of passing the
  -- check as unknown.
  CHECK (
    tier <> 1 OR
    (sets_minus_25 IS sets_full AND sets_minus_50 IS sets_full AND sets_express IS sets_full)
  )
) STRICT;

CREATE INDEX training_routine_exercise_by_routine
  ON training_routine_exercise (routine_id, position);
`;
