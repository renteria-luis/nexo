// La nota del dia se guarda con su decimal.
//
// Desde el 2026-09-25 la nota lleva un decimal, pero la columna se creo entera y una tabla
// STRICT no acepta 69.6, asi que se guardaba redondeada: la cuadricula, la racha, Registros
// y las graficas leian 70 y 100 donde el dia decia 69.6 y 99.6 (decision 2026-10-02). La
// columna no se puede cambiar en su sitio: la tabla se rehace igual salvo esa columna. No
// la referencia ninguna otra tabla ni tiene disparadores.
//
// Las notas viejas se borran para que la siguiente carga las rehaga con el decimal, como
// hicieron las migraciones 034, 035, 038, 041 y 044.
export const sql = `
CREATE TABLE core_daily_log_next (
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
  score              REAL    CHECK (score BETWEEN 0 AND 100),
  has_data           INTEGER NOT NULL DEFAULT 0 CHECK (has_data IN (0, 1)),
  alcohol_after_training INTEGER CHECK (alcohol_after_training IN (0, 1)),
  rest_day           INTEGER NOT NULL DEFAULT 0 CHECK (rest_day IN (0, 1)),
  -- A day with sleep minutes but no source is a logging bug, not a valid state.
  CHECK ((sleep_minutes IS NULL) = (sleep_source IS NULL))
) STRICT;

INSERT INTO core_daily_log_next
  (date, water_ml, creatine_taken, alcohol_drinks, cannabis, sleep_minutes, sleep_source,
   resting_hr, hrv_ms, steps, weight_kg, score, has_data, alcohol_after_training, rest_day)
SELECT date, water_ml, creatine_taken, alcohol_drinks, cannabis, sleep_minutes, sleep_source,
       resting_hr, hrv_ms, steps, weight_kg, NULL, has_data, alcohol_after_training, rest_day
  FROM core_daily_log;

DROP TABLE core_daily_log;
ALTER TABLE core_daily_log_next RENAME TO core_daily_log;
`;
