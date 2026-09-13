export const sql = `
CREATE TABLE training_gym (
  id                TEXT    PRIMARY KEY,
  name              TEXT    NOT NULL,
  lat               REAL    CHECK (lat BETWEEN -90 AND 90),
  lng               REAL    CHECK (lng BETWEEN -180 AND 180),
  geofence_radius_m INTEGER NOT NULL CHECK (geofence_radius_m > 0),
  -- Half a coordinate cannot drive arrival detection.
  CHECK ((lat IS NULL) = (lng IS NULL))
) STRICT;

CREATE TABLE training_exercise (
  id                   TEXT    PRIMARY KEY,
  name_es              TEXT    NOT NULL,
  name_en              TEXT    NOT NULL,
  primary_muscle       TEXT    NOT NULL,
  equipment_type       TEXT    NOT NULL
                               CHECK (equipment_type IN
                                 ('machine', 'barbell', 'ez_bar', 'dumbbell', 'cable', 'bodyweight')),
  -- The real smallest step for this equipment. Drives the arrow buttons (spec 5.1).
  load_increment       REAL    NOT NULL CHECK (load_increment > 0),
  default_rest_seconds INTEGER NOT NULL CHECK (default_rest_seconds > 0),
  unilateral           INTEGER NOT NULL DEFAULT 0 CHECK (unilateral IN (0, 1)),
  technique_text       TEXT,
  technique_clip_ref   TEXT
) STRICT;

-- Weekly set volume per muscle counts a primary muscle fully and a secondary at
-- half. Without the weight the counts in spec 13.2 are wrong, and the case for
-- direct forearm work in 13.3 rests on those counts.
CREATE TABLE training_exercise_muscle (
  exercise_id  TEXT NOT NULL REFERENCES training_exercise (id) ON DELETE CASCADE,
  muscle       TEXT NOT NULL,
  contribution REAL NOT NULL CHECK (contribution IN (1.0, 0.5)),
  PRIMARY KEY (exercise_id, muscle)
) STRICT;

-- contribution 1.0 belongs to the primary muscle and to nothing else, in both
-- directions, so the column and the relation cannot drift apart.
CREATE TRIGGER training_exercise_muscle_contribution_insert
BEFORE INSERT ON training_exercise_muscle
BEGIN
  SELECT RAISE(ABORT, 'contribution 1.0 must be the exercise primary_muscle, and only it')
  WHERE (NEW.contribution = 1.0) <>
        (NEW.muscle = (SELECT primary_muscle FROM training_exercise WHERE id = NEW.exercise_id));
END;

CREATE TRIGGER training_exercise_muscle_contribution_update
BEFORE UPDATE ON training_exercise_muscle
BEGIN
  SELECT RAISE(ABORT, 'contribution 1.0 must be the exercise primary_muscle, and only it')
  WHERE (NEW.contribution = 1.0) <>
        (NEW.muscle = (SELECT primary_muscle FROM training_exercise WHERE id = NEW.exercise_id));
END;

-- One relation behind both Exercise.gym_ids and Gym.machines, so the two cannot
-- contradict each other.
CREATE TABLE training_exercise_gym (
  exercise_id TEXT NOT NULL REFERENCES training_exercise (id) ON DELETE CASCADE,
  gym_id      TEXT NOT NULL REFERENCES training_gym (id) ON DELETE CASCADE,
  PRIMARY KEY (exercise_id, gym_id)
) STRICT;

CREATE INDEX training_exercise_gym_by_gym ON training_exercise_gym (gym_id);
CREATE INDEX training_exercise_muscle_by_muscle ON training_exercise_muscle (muscle);
`;
