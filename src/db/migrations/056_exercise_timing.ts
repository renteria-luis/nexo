export const sql = `
ALTER TABLE training_set_entry ADD COLUMN timing_eligible INTEGER NOT NULL DEFAULT 1
  CHECK (timing_eligible IN (0, 1));
ALTER TABLE training_set_entry ADD COLUMN timing_review TEXT NOT NULL DEFAULT 'auto'
  CHECK (timing_review IN ('auto', 'keep', 'exclude'));
ALTER TABLE training_set_entry ADD COLUMN timing_seconds REAL
  CHECK (timing_seconds > 0 AND timing_seconds <= 21600);

CREATE TABLE training_exercise_time (
  session_id TEXT NOT NULL REFERENCES training_session(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES training_exercise(id),
  implement TEXT NOT NULL,
  set_count INTEGER NOT NULL CHECK (set_count > 0),
  sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
  flagged_count INTEGER NOT NULL CHECK (flagged_count >= 0),
  minutes REAL CHECK (minutes > 0),
  PRIMARY KEY (session_id, exercise_id, implement)
) STRICT;

CREATE INDEX training_exercise_time_by_exercise ON training_exercise_time(exercise_id);

-- A changed record must never leave an old duration available for learning.
CREATE TRIGGER training_time_after_set_insert AFTER INSERT ON training_set_entry BEGIN
  DELETE FROM training_exercise_time WHERE session_id = NEW.session_id;
END;
CREATE TRIGGER training_time_after_set_delete AFTER DELETE ON training_set_entry BEGIN
  DELETE FROM training_exercise_time WHERE session_id = OLD.session_id;
END;
CREATE TRIGGER training_time_after_set_update AFTER UPDATE ON training_set_entry BEGIN
  DELETE FROM training_exercise_time WHERE session_id IN (OLD.session_id, NEW.session_id);
END;
CREATE TRIGGER training_time_after_session_update
AFTER UPDATE OF start_time, end_time, is_retroactive ON training_session BEGIN
  DELETE FROM training_exercise_time WHERE session_id = NEW.id;
END;
`;
