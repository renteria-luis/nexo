export const sql = `
CREATE TABLE training_session (
  id               TEXT    PRIMARY KEY,
  date             TEXT    NOT NULL
                           CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_time       INTEGER CHECK (start_time > 0),
  end_time         INTEGER CHECK (end_time > 0),
  gym_id           TEXT    REFERENCES training_gym (id),
  routine_id       TEXT    REFERENCES training_routine (id),
  alone_or_partner TEXT    CHECK (alone_or_partner IN ('alone', 'with_someone')),
  time_budget      TEXT    NOT NULL
                           CHECK (time_budget IN ('completo', 'minus_25', 'minus_50', 'express')),
  crowding         TEXT    CHECK (crowding IN ('empty', 'normal', 'full')),
  is_retroactive   INTEGER NOT NULL DEFAULT 0 CHECK (is_retroactive IN (0, 1)),
  notes            TEXT,
  CHECK (end_time IS NULL OR start_time IS NULL OR end_time >= start_time),
  -- Spec 5.4: crowding recalled days later is not evidence, so a retroactive
  -- session may not carry it at all.
  CHECK (is_retroactive = 0 OR crowding IS NULL)
) STRICT;

CREATE INDEX training_session_by_date ON training_session (date);

CREATE TABLE training_set_entry (
  id                  TEXT    PRIMARY KEY,
  session_id          TEXT    NOT NULL REFERENCES training_session (id) ON DELETE CASCADE,
  exercise_id         TEXT    NOT NULL REFERENCES training_exercise (id),
  set_index           INTEGER NOT NULL CHECK (set_index > 0),
  weight_kg           REAL    NOT NULL CHECK (weight_kg >= 0),
  reps                INTEGER NOT NULL CHECK (reps > 0),
  rest_before_seconds INTEGER CHECK (rest_before_seconds >= 0),
  timestamp           INTEGER NOT NULL CHECK (timestamp > 0),
  rpe                 REAL    CHECK (rpe BETWEEN 1 AND 10),
  -- Warmups are excluded from volume and PR calculations (spec 5.5).
  is_warmup           INTEGER NOT NULL DEFAULT 0 CHECK (is_warmup IN (0, 1)),
  UNIQUE (session_id, exercise_id, set_index)
) STRICT;

CREATE INDEX training_set_entry_by_session ON training_set_entry (session_id);
CREATE INDEX training_set_entry_by_exercise ON training_set_entry (exercise_id, timestamp);
`;
