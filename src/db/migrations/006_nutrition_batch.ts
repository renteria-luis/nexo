export const sql = `
-- Spec 7.3: cook the whole pack, divide by eye, record the raw weight and the
-- number of portions. Per-portion protein is derived, never weighed.
CREATE TABLE nutrition_batch (
  id                 TEXT    PRIMARY KEY,
  food_id            TEXT    NOT NULL REFERENCES nutrition_food (id),
  raw_weight_g       REAL    NOT NULL CHECK (raw_weight_g > 0),
  cooked_weight_g    REAL    CHECK (cooked_weight_g > 0),
  portions_count     INTEGER NOT NULL CHECK (portions_count > 0),
  cooked_date        TEXT    NOT NULL
                             CHECK (cooked_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  portions_remaining INTEGER NOT NULL CHECK (portions_remaining >= 0),
  -- Draining removes fat but not protein, so calories become a range while
  -- protein stays reliable (spec 7.3).
  fat_drained        INTEGER NOT NULL DEFAULT 0 CHECK (fat_drained IN (0, 1)),
  CHECK (portions_remaining <= portions_count)
) STRICT;

CREATE INDEX nutrition_batch_open ON nutrition_batch (cooked_date) WHERE portions_remaining > 0;

CREATE TABLE nutrition_food_entry (
  id        TEXT    PRIMARY KEY,
  food_id   TEXT    NOT NULL REFERENCES nutrition_food (id),
  quantity  REAL    NOT NULL CHECK (quantity > 0),
  unit      TEXT    NOT NULL,
  timestamp INTEGER NOT NULL CHECK (timestamp > 0),
  -- The local calendar day the entry counts towards, kept alongside the instant
  -- so a day's totals never depend on converting a timestamp at read time.
  date      TEXT    NOT NULL
                    CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  meal_slot TEXT    NOT NULL,
  batch_id  TEXT    REFERENCES nutrition_batch (id)
) STRICT;

CREATE INDEX nutrition_food_entry_by_date ON nutrition_food_entry (date);
CREATE INDEX nutrition_food_entry_by_batch ON nutrition_food_entry (batch_id) WHERE batch_id IS NOT NULL;
`;
