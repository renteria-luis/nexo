// The Fanshawe gym, which is where he trains about 80% of the time. Mostly Atlantis
// Strength, with a Hammer Strength V-Squat and Matrix cable and bench equipment.
//
// Weights are written as `lb * 0.45359237` so every figure traces back to what the
// machine actually says. The gym is imperial: plates run to 45 lb and the V-Squat
// carriage is stamped 54 lb.
//
// On the model codes: P### is the Precision Series and those are selectorized, with
// a pin and a stack. PW### is the plate-loaded line. Getting that backwards is what
// made the first version of this file call the P140 plate-loaded when it is not; the
// owner corrected it from the machine itself.
//
// `increment_confirmed` is 0 wherever the step is the manufacturer's usual rather
// than something read off this gym's machine. Stack totals are Atlantis figures. The
// free weights are confirmed: he counted the rack himself.

const LB = 0.45359237;

export const sql = `
INSERT INTO training_gym (id, name, lat, lng, geofence_radius_m)
VALUES ('fanshawe', 'Fanshawe', NULL, NULL, 120);

INSERT INTO training_equipment
  (id, gym_id, model_code, brand, name_es, name_en, kind, load_increment,
   stack_min_kg, stack_max_kg, primary_use, level, notes_es, increment_confirmed)
VALUES
  -- Piernas
  ('fan-c105', 'fanshawe', 'C105', 'Atlantis', 'Extensión de piernas', 'Leg extension',
   'selectorized', 10*${LB}, NULL, 310*${LB}, 'hypertrophy', 'beginner',
   'Aislamiento puro de cuádriceps. Torre de 310 lb, de sobra para llevarlo al fallo.', 0),

  ('fan-c108', 'fanshawe', 'C108', 'Atlantis', 'Curl femoral sentado', 'Seated leg curl',
   'selectorized', 10*${LB}, 130*${LB}, 205*${LB}, 'hypertrophy', 'beginner',
   'Isquiotibiales sentado. Siete puntos de ajuste de recorrido.', 0),

  ('fan-c230', 'fanshawe', 'C230', 'Atlantis', 'Combo extensión y curl femoral',
   'Leg extension / leg curl combo', 'selectorized', 10*${LB}, NULL, 205*${LB},
   'hypertrophy', 'beginner',
   'Dos ejercicios en una estación. El respaldo baja para hacer el curl acostado.', 0),

  ('fan-c113', 'fanshawe', 'C113', 'Atlantis', 'Cadera total', 'Total hip',
   'selectorized', 10*${LB}, NULL, 320*${LB}, 'hypertrophy', 'beginner',
   'Aducción, abducción, flexión y extensión de cadera en una sola estación.', 0),

  ('fan-c329', 'fanshawe', 'C329', 'Atlantis', 'Combo abductores y aductores',
   'Abductor / adductor combo', 'selectorized', 10*${LB}, NULL, NULL,
   'hypertrophy', 'beginner',
   'Las dos direcciones en una estación. Junto con la C113, C114 y C115 tienes cuatro máquinas de cadera.', 0),

  ('fan-c114', 'fanshawe', 'C114', 'Atlantis', 'Aductores', 'Adductor',
   'selectorized', 10*${LB}, NULL, NULL, 'hypertrophy', 'beginner',
   'Aductores dedicada. Es la que corresponde a tu máquina de aductores.', 0),

  ('fan-c115', 'fanshawe', 'C115', 'Atlantis', 'Abductores', 'Abductor',
   'selectorized', 10*${LB}, NULL, NULL, 'hypertrophy', 'beginner',
   'Abductores dedicada.', 0),

  ('fan-c403', 'fanshawe', 'C403', 'Atlantis', 'Prensa horizontal', 'Horizontal leg press',
   'selectorized', 10*${LB}, NULL, NULL, 'strength', 'intermediate',
   'Ángulo de plataforma pensado para bajar el cizallamiento en la rodilla. Respaldo ajustable y tope de recorrido.', 0),

  ('fan-vsquat', 'fanshawe', NULL, 'Hammer Strength', 'Sentadilla en V', 'V-Squat',
   'plate_loaded', 5*${LB}, 54*${LB}, NULL, 'strength', 'intermediate',
   'De discos, el carro arranca en 54 lb vacío. Patrón de sentadilla con la espalda apoyada.', 1),

  -- Pecho
  ('fan-nm300', 'fanshawe', 'NM300', 'Atlantis', 'Press de pecho Natural Motion',
   'Natural Motion chest press', 'selectorized', 10*${LB}, NULL, NULL,
   'hypertrophy', 'beginner',
   'Press de pecho con torre. Rápido de cargar, bueno para series finales sin ayudante.', 0),

  ('fan-p140', 'fanshawe', 'P140', 'Atlantis', 'Press de pecho convergente sentado',
   'Seated converging chest press', 'selectorized', 10*${LB}, NULL, NULL,
   'hypertrophy', 'intermediate',
   'Torre de ladrillos, Precision Series. Los brazos convergen al empujar, que se parece más a una mancuerna que a una máquina. Brazos independientes: un lado no ayuda al otro. Pedal de pre-estiramiento asistido por resorte para entrar en posición. Es tu press de pecho principal.', 0),

  ('fan-p156', 'fanshawe', 'P156', 'Atlantis', 'Combo contractor y deltoide posterior',
   'Pec / rear delt fly combo', 'selectorized', 10*${LB}, NULL, NULL,
   'hypertrophy', 'beginner',
   'Contractor de pecho y deltoide posterior en la misma estación. Agarre neutro para pecho, prono para deltoide posterior. Brazos autoalineantes sobre rodamientos y ajuste de recorrido en las levas. Atlantis la ofrece en torre y en discos; la del catálogo Precision es de torre.', 0),

  ('fan-p250', 'fanshawe', 'P250', 'Atlantis', 'Multi press', 'Multi-press',
   'selectorized', 10*${LB}, NULL, NULL, 'hypertrophy', 'intermediate',
   'Tres prensas en una: plano, inclinado y militar. Brazo sobre rodamientos sellados y varios agarres.', 0),

  -- Espalda
  ('fan-d123', 'fanshawe', 'D123', 'Atlantis', 'Jalón al pecho', 'Lat pulldown',
   'selectorized', 10*${LB}, NULL, NULL, 'hypertrophy', 'beginner',
   'Jalón clásico. Muslera y asiento ajustables.', 0),

  ('fan-d124', 'fanshawe', 'D124', 'Atlantis', 'Remo bajo', 'Low row',
   'selectorized', 10*${LB}, NULL, NULL, 'hypertrophy', 'beginner',
   'Remo sentado desde abajo. Es el que corresponde a tu remo en polea con agarre cerrado.', 0),

  ('fan-nm500', 'fanshawe', 'NM500', 'Atlantis', 'Jalón unilateral', 'Unilateral lat pulldown',
   'selectorized', 10*${LB}, NULL, NULL, 'hypertrophy', 'intermediate',
   'Poleas pivotantes: cada brazo define su propia trayectoria. Con el clip se vuelve bilateral.', 0),

  -- Hombros y brazos
  ('fan-nm400', 'fanshawe', 'NM400', 'Atlantis', 'Press de hombros Natural Motion',
   'Natural Motion shoulder press', 'selectorized', 10*${LB}, NULL, NULL,
   'hypertrophy', 'beginner', 'Press de hombros con torre.', 0),

  ('fan-nm537', 'fanshawe', 'NM537', 'Atlantis', 'Remo divergente y deltoide posterior',
   'Diverging row and rear delt', 'selectorized', 10*${LB}, NULL, NULL,
   'hypertrophy', 'intermediate',
   'Remo y deltoide posterior en una estación, con brazos divergentes independientes. Es la alternativa directa a tu remo en polea y tu contractor invertido.', 0),

  ('fan-b157', 'fanshawe', 'B157', 'Atlantis', 'Curl horizontal', 'Horizontal curl',
   'selectorized', 10*${LB}, NULL, NULL, 'hypertrophy', 'beginner',
   'Curl de bíceps con el brazo en horizontal.', 0),

  ('fan-b158', 'fanshawe', 'B158', 'Atlantis', 'Curl aislado', 'Biceps isolator',
   'selectorized', 10*${LB}, NULL, NULL, 'hypertrophy', 'beginner',
   'Equivale a tu curl predicador, con torre en vez de barra Z.', 0),

  ('fan-t164', 'fanshawe', 'T164', 'Atlantis', 'Extensión de tríceps inclinada',
   'Incline triceps pushdown', 'selectorized', 10*${LB}, NULL, NULL,
   'hypertrophy', 'beginner',
   'Tríceps con el torso inclinado, lo que deja el hombro más estable que una polea de pie.', 0),

  ('fan-a301', 'fanshawe', 'A301', 'Atlantis', 'Abdominales en máquina', 'Ab crunch',
   'selectorized', 10*${LB}, NULL, NULL, 'hypertrophy', 'beginner',
   'Flexión de tronco con carga. Spec 2.1: no quema grasa abdominal, entrena el músculo.', 0),

  -- Poleas, bancos y libre
  ('fan-matrix-cable', 'fanshawe', NULL, 'Matrix', 'Torre de poleas dobles',
   'Dual adjustable pulley', 'cable', 5*${LB}, NULL, NULL, 'hypertrophy', 'intermediate',
   'Dos poleas de altura ajustable con barra y cuerda. Es donde haces el tríceps por encima de la cabeza y el martillo.', 0),

  ('fan-bench-matrix', 'fanshawe', 'MG A85 03', 'Matrix', 'Banco ajustable',
   'Adjustable bench', 'bench', NULL, NULL, NULL, NULL, NULL,
   'Banco para press inclinado con mancuernas y curl en banco inclinado.', 0),

  ('fan-dumbbells', 'fanshawe', NULL, NULL, 'Mancuernas', 'Dumbbells',
   'free_weight', 2.5*${LB}, 5*${LB}, 100*${LB}, 'hypertrophy', 'beginner',
   'De 5 a 100 lb. Salta de 2.5 en 2.5 hasta 30 lb y de 5 en 5 de ahí en adelante.', 1),

  ('fan-ez-bars', 'fanshawe', NULL, NULL, 'Barras Z y rectas', 'EZ and straight bars',
   'free_weight', 5*${LB}, 20*${LB}, 110*${LB}, 'hypertrophy', 'intermediate',
   'Barras fijas de 20 a 110 lb.', 1),

  ('fan-plates', 'fanshawe', NULL, 'InTek', 'Discos', 'Weight plates',
   'free_weight', 5*${LB}, 2.5*${LB}, 45*${LB}, 'strength', 'intermediate',
   'De 2.5 a 45 lb. El salto más chico cargando los dos lados es 5 lb.', 1);

-- Every seeded exercise exists at this gym.
INSERT INTO training_exercise_gym (exercise_id, gym_id)
SELECT id, 'fanshawe' FROM training_exercise;

-- The ones whose machine is known.
INSERT INTO training_exercise_equipment (exercise_id, equipment_id) VALUES
  ('peck-deck',          'fan-p156'),
  ('reverse-pec-deck',   'fan-p156'),
  ('seated-chest-press', 'fan-p140'),
  ('cable-row-narrow',   'fan-d124'),
  ('triceps-pulldown',   'fan-t164'),
  ('overhead-triceps',   'fan-matrix-cable'),
  ('hammer-curl',        'fan-matrix-cable'),
  ('preacher-curl',      'fan-b158'),
  ('leg-extension',      'fan-c105'),
  ('leg-curl',           'fan-c108'),
  ('hip-adductor',       'fan-c114'),
  ('hack-squat',         'fan-vsquat'),
  ('incline-db-press',   'fan-dumbbells'),
  ('incline-curl',       'fan-dumbbells'),
  ('lateral-raise',      'fan-dumbbells');
`;
