// Day-scoped dates are TEXT 'YYYY-MM-DD' in the owner's local timezone; points in
// time are integer milliseconds since the Unix epoch in UTC. See DECISIONS.md.
export const sql = `
CREATE TABLE core_target_snapshot (
  id                TEXT    PRIMARY KEY,
  effective_from    TEXT    NOT NULL UNIQUE
                            CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  weight_basis_kg   REAL    NOT NULL CHECK (weight_basis_kg > 0),
  kcal              INTEGER NOT NULL CHECK (kcal > 0),
  protein_g         INTEGER NOT NULL CHECK (protein_g > 0),
  fat_g             INTEGER NOT NULL CHECK (fat_g > 0),
  carbs_g           INTEGER NOT NULL CHECK (carbs_g >= 0),
  water_ml_rest     INTEGER NOT NULL CHECK (water_ml_rest > 0),
  water_ml_training INTEGER NOT NULL CHECK (water_ml_training > 0),
  sleep_minutes     INTEGER NOT NULL CHECK (sleep_minutes > 0),
  steps             INTEGER NOT NULL CHECK (steps > 0)
) STRICT;

CREATE TABLE core_daily_log (
  date               TEXT    PRIMARY KEY
                             CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  water_ml           INTEGER CHECK (water_ml >= 0),
  creatine_taken     INTEGER CHECK (creatine_taken IN (0, 1)),
  alcohol_drinks     REAL    CHECK (alcohol_drinks >= 0),
  cannabis           INTEGER CHECK (cannabis IN (0, 1)),
  sleep_minutes      INTEGER CHECK (sleep_minutes >= 0),
  sleep_source       TEXT    CHECK (sleep_source IN ('apple_health', 'autosleep', 'manual', 'none')),
  resting_hr         INTEGER CHECK (resting_hr > 0),
  hrv_ms             INTEGER CHECK (hrv_ms > 0),
  steps              INTEGER CHECK (steps >= 0),
  weight_kg          REAL    CHECK (weight_kg > 0),
  -- Null when fewer than three criteria have data (spec 6.6); the cell renders grey.
  score              INTEGER CHECK (score BETWEEN 0 AND 100),
  has_data           INTEGER NOT NULL DEFAULT 0 CHECK (has_data IN (0, 1)),
  -- A day with sleep minutes but no source is a logging bug, not a valid state.
  CHECK ((sleep_minutes IS NULL) = (sleep_source IS NULL))
) STRICT;
`;
