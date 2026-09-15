// Spec 5.11 and spec 7.5 point 3. A structured n=1 test: one thing changed, a start
// date, and a number logged on a schedule, so the answer comes from his own skin
// instead of from a literature that contradicts itself.
//
// The reading is a plain number and the scale lives in outcome_metric, because the
// next experiment may measure something that is not a 0 to 5 skin score.
export const sql = `
CREATE TABLE core_experiment (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  hypothesis       TEXT NOT NULL,
  -- The one thing being changed. More than one and the result says nothing.
  variable_changed TEXT NOT NULL,
  start_date       TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Null while it is still running.
  end_date         TEXT CHECK (end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  outcome_metric   TEXT NOT NULL,
  notes            TEXT,
  CHECK (end_date IS NULL OR end_date >= start_date)
) STRICT;

CREATE TABLE core_experiment_reading (
  experiment_id TEXT NOT NULL REFERENCES core_experiment (id) ON DELETE CASCADE,
  date          TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  value         REAL NOT NULL CHECK (value >= 0),
  note          TEXT,
  PRIMARY KEY (experiment_id, date)
) STRICT;
`;
