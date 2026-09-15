// Spec 5.2 lists a gym's machines. A machine is not an exercise: the C113 does four
// different hip movements and a cable tower does dozens, so it gets its own table
// and exercises point at it.
//
// `primary_use` has no "definition" value on purpose. Spec 2.1 is explicit that
// localised training does not touch localised fat and that definition is a total
// leanness outcome, so labelling a machine that way would encode a false idea into
// the data.
export const sql = `
CREATE TABLE training_equipment (
  id             TEXT    PRIMARY KEY,
  gym_id         TEXT    NOT NULL REFERENCES training_gym (id) ON DELETE CASCADE,
  /** The code stencilled on the frame, which is how he identifies it at the gym. */
  model_code     TEXT,
  brand          TEXT,
  name_es        TEXT    NOT NULL,
  name_en        TEXT    NOT NULL,
  kind           TEXT    NOT NULL
                         CHECK (kind IN ('selectorized', 'plate_loaded', 'cable',
                                         'free_weight', 'bench', 'rack', 'cardio')),
  /** Smallest real step, in kilograms like every other weight in this database. */
  load_increment REAL    CHECK (load_increment > 0),
  stack_min_kg   REAL    CHECK (stack_min_kg >= 0),
  stack_max_kg   REAL    CHECK (stack_max_kg > 0),
  primary_use    TEXT    CHECK (primary_use IN ('hypertrophy', 'strength', 'endurance', 'mobility')),
  level          TEXT    CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  /** What it is for and what to watch, in his language. */
  notes_es       TEXT,
  /** False until he has confirmed the step at the machine itself (spec 14.3). */
  increment_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (increment_confirmed IN (0, 1)),
  CHECK (stack_max_kg IS NULL OR stack_min_kg IS NULL OR stack_max_kg >= stack_min_kg)
) STRICT;

CREATE INDEX training_equipment_by_gym ON training_equipment (gym_id);

-- Which machine an exercise is performed on. Nullable everywhere else: a dumbbell
-- curl belongs to no machine.
CREATE TABLE training_exercise_equipment (
  exercise_id  TEXT NOT NULL REFERENCES training_exercise (id) ON DELETE CASCADE,
  equipment_id TEXT NOT NULL REFERENCES training_equipment (id) ON DELETE CASCADE,
  PRIMARY KEY (exercise_id, equipment_id)
) STRICT;
`;
