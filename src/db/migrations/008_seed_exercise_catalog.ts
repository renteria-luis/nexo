// The routine the owner trains today, from spec 13.1. Not the routine in spec
// 8.4: that one includes the 13.3 proposals, and 13.4 says none of them land
// until re-entry mode ends around 2026-10-03.
//
// default_rest_seconds comes from the table in spec 9. load_increment uses the
// typical step per equipment type from spec 5.1; the real per-gym values wait on
// the gym inventories the owner still has to supply (spec 14.3).
//
// Secondary muscles are standard anatomy, not something spec 13.1 states. They
// are the one part of this seed the owner should look over.

export const sql = `
INSERT INTO training_exercise
  (id, name_es, name_en, primary_muscle, equipment_type, load_increment, default_rest_seconds, unilateral)
VALUES
  ('incline-db-press',   'Press inclinado con mancuernas',        'Incline dumbbell press',           'chest',         'dumbbell',   2.5, 180, 0),
  ('peck-deck',          'Contractor de pecho',                   'Peck deck',                        'chest',         'machine',    5,   120, 0),
  ('seated-chest-press', 'Press de pecho sentado en maquina',     'Seated chest press machine',       'chest',         'machine',    5,   120, 0),
  ('overhead-triceps',   'Extension de triceps sobre la cabeza',  'Overhead cable triceps extension', 'triceps',       'cable',      2.5, 120, 0),
  ('triceps-pulldown',   'Extension de triceps en polea alta',    'Triceps cable pulldown',           'triceps',       'cable',      2.5, 120, 0),
  ('lateral-raise',      'Elevaciones laterales',                 'Lateral raise',                    'lateral_delts', 'dumbbell',   2.5, 120, 0),
  ('pull-up',            'Dominadas',                             'Pull-up',                          'back',          'bodyweight', 2.5, 180, 0),
  ('cable-row-narrow',   'Remo en polea con agarre cerrado',      'Narrow grip cable row',            'back',          'cable',      2.5, 120, 0),
  ('incline-curl',       'Curl en banco inclinado',               'Incline bench curl',               'biceps',        'dumbbell',   2.5, 120, 0),
  ('hammer-curl',        'Curl martillo',                         'Hammer curl',                      'biceps',        'cable',      2.5, 120, 0),
  ('preacher-curl',      'Curl predicador con barra Z',           'EZ bar preacher curl',             'biceps',        'ez_bar',     2.5, 120, 0),
  ('reverse-pec-deck',   'Contractor invertido',                  'Reverse pec deck',                 'rear_delts',    'machine',    5,   120, 0),
  ('hip-adductor',       'Maquina de aductores',                  'Hip adductor machine',             'adductors',     'machine',    5,   120, 0),
  ('hack-squat',         'Sentadilla hack',                       'Hack squat',                       'quads',         'machine',    5,   180, 0),
  ('leg-extension',      'Extension de piernas',                  'Leg extension',                    'quads',         'machine',    5,   120, 0),
  ('leg-curl',           'Curl femoral',                          'Leg curl',                         'hamstrings',    'machine',    5,   120, 0);

INSERT INTO training_exercise_muscle (exercise_id, muscle, contribution)
VALUES
  ('incline-db-press',   'chest',         1.0),
  ('incline-db-press',   'front_delts',   0.5),
  ('incline-db-press',   'triceps',       0.5),

  ('peck-deck',          'chest',         1.0),

  ('seated-chest-press', 'chest',         1.0),
  ('seated-chest-press', 'front_delts',   0.5),
  ('seated-chest-press', 'triceps',       0.5),

  ('overhead-triceps',   'triceps',       1.0),

  ('triceps-pulldown',   'triceps',       1.0),

  ('lateral-raise',      'lateral_delts', 1.0),

  ('pull-up',            'back',          1.0),
  ('pull-up',            'biceps',        0.5),
  ('pull-up',            'forearms',      0.5),

  ('cable-row-narrow',   'back',          1.0),
  ('cable-row-narrow',   'biceps',        0.5),
  ('cable-row-narrow',   'rear_delts',    0.5),

  ('incline-curl',       'biceps',        1.0),

  ('hammer-curl',        'biceps',        1.0),
  ('hammer-curl',        'forearms',      0.5),

  ('preacher-curl',      'biceps',        1.0),

  ('reverse-pec-deck',   'rear_delts',    1.0),

  ('hip-adductor',       'adductors',     1.0),

  ('hack-squat',         'quads',         1.0),
  ('hack-squat',         'glutes',        0.5),

  ('leg-extension',      'quads',         1.0),

  ('leg-curl',           'hamstrings',    1.0);
`;
