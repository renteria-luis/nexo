// Fit4Less on Proudfoot, the other gym (spec 14.3). The gym row itself was created
// with its coordinates in migration 018, so this only adds the machines.
//
// Two families: one Star Trac cable station and a floor of Nautilus Inspiration
// selectorized units. The Nautilus ones carry no model code stencilled on them, only
// a name, which is why `model_code` is null for all of them. Their weight is chosen
// with the Lock N Load switch rather than a pin: no pin to lose, same stack.
//
// Where a stack total is written it comes from the manufacturer's published figure
// for that exact model. Everywhere else it is NULL, because inventing a number is
// what went wrong the first time Fanshawe was seeded.
//
// `increment_confirmed` is 1 where he read the steps off the machine himself.

const LB = 0.45359237;

export const sql = `
INSERT INTO training_equipment
  (id, gym_id, model_code, brand, name_es, name_en, kind, load_increment,
   stack_min_kg, stack_max_kg, primary_use, level, notes_es, increment_confirmed)
VALUES
  -- Estación de poleas Star Trac
  ('f4l-st-pulleys', 'fit4less-proudfoot', NULL, 'Star Trac',
   'Poleas ajustables y altas', 'Adjustable and high pulleys', 'cable', 2.5,
   11, 28.5, 'hypertrophy', 'beginner',
   'Dos poleas ajustables y dos fijas altas. Torre en kilos, de 2.5 en 2.5. Los numeros que leyo (11, 15.5, 22, 28.5) no caen en una escalera de 2.5 exacta, asi que falta confirmarlo en la maquina.', 0),

  ('f4l-st-row', 'fit4less-proudfoot', NULL, 'Star Trac',
   'Remo sentado', 'Seated row', 'selectorized', 5,
   10, 75, 'hypertrophy', 'beginner',
   'Dos puestos de remo sentado. La torre esta marcada en libras (22 a 165) y cada placa es de 5 kg exactos. Entre 121 y 143 lb falta el 132, por confirmar.', 1),

  ('f4l-st-pulldown', 'fit4less-proudfoot', NULL, 'Star Trac',
   'Jalon al pecho', 'Lat pulldown', 'selectorized', 5,
   10, 75, 'hypertrophy', 'beginner',
   'Dos puestos de jalon, misma torre que los remos: marcada en libras, placas de 5 kg.', 1),

  ('f4l-st-pullup', 'fit4less-proudfoot', NULL, 'Star Trac',
   'Barra de dominadas', 'Pull-up bar', 'rack', NULL,
   NULL, NULL, 'strength', 'intermediate',
   'Al centro de la estacion de poleas. Peso corporal.', 1),

  -- Nautilus Inspiration, seleccion por switch Lock n Load, escalones de 10 lb
  ('f4l-nau-deltoid-raise', 'fit4less-proudfoot', 'IPDR3', 'Nautilus',
   'Elevaciones laterales en maquina', 'Deltoid raise', 'selectorized', 10*${LB},
   NULL, 200*${LB}, 'hypertrophy', 'beginner',
   'Lo que Fanshawe no tiene. Aisla el deltoide lateral con tension pareja en todo el recorrido y sin que el hombro se vaya adelante. Meta 3 de spec 2.', 1),

  ('f4l-nau-shoulder-press', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Press de hombro en maquina', 'Shoulder press', 'selectorized', 10*${LB},
   NULL, NULL, 'hypertrophy', 'beginner',
   'Deltoide frontal y triceps. El frontal ya recibe mucho del press de pecho.', 1),

  ('f4l-nau-chest-press', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Press de pecho en maquina', 'Chest press', 'selectorized', 10*${LB},
   NULL, NULL, 'hypertrophy', 'beginner',
   'Equivalente de la P140 de Fanshawe. Patron horizontal.', 1),

  ('f4l-nau-pec-fly', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Contractor de pecho y deltoide posterior', 'Pec fly / rear delt', 'selectorized', 10*${LB},
   NULL, NULL, 'hypertrophy', 'beginner',
   'Las dos direcciones en una estacion, igual que la P156 de Fanshawe. El deltoide posterior es la meta mas descuidada segun spec 13.2.', 1),

  ('f4l-nau-row', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Remo en maquina', 'Row', 'selectorized', 10*${LB},
   NULL, NULL, 'hypertrophy', 'beginner',
   'Remo con respaldo, mas estable que el de polea.', 1),

  ('f4l-nau-lat-pulldown', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Jalon al pecho en maquina', 'Lat pulldown', 'selectorized', 10*${LB},
   NULL, 240*${LB}, 'hypertrophy', 'beginner',
   'Alternativa a las dominadas cuando ya no salen limpias.', 1),

  ('f4l-nau-arm-curl', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Curl de biceps en maquina', 'Bilateral arm curl', 'selectorized', 10*${LB},
   NULL, NULL, 'hypertrophy', 'beginner',
   'Biceps con los codos fijos. spec 13.2 dice que el biceps ya esta en el tope de la banda.', 1),

  ('f4l-nau-triceps-extension', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Extension de triceps en maquina', 'Triceps extension', 'selectorized', 10*${LB},
   NULL, NULL, 'hypertrophy', 'beginner',
   'Triceps sentado, sin que el hombro compense.', 1),

  ('f4l-nau-abdominal', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Abdominales en maquina', 'Abdominal', 'selectorized', 10*${LB},
   NULL, NULL, 'hypertrophy', 'beginner',
   'Flexion de tronco con carga.', 1),

  ('f4l-nau-glute-press', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Patada de gluteo en maquina', 'Glute press', 'selectorized', 10*${LB},
   NULL, NULL, 'hypertrophy', 'beginner',
   'Extension de cadera a una pierna.', 1),

  ('f4l-nau-abductor', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Abductores', 'Hip abductor', 'selectorized', 10*${LB},
   NULL, NULL, 'hypertrophy', 'beginner',
   'Abre las piernas contra carga. Gluteo medio.', 1),

  ('f4l-nau-adductor', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Aductores', 'Hip adductor', 'selectorized', 10*${LB},
   NULL, NULL, 'hypertrophy', 'beginner',
   'spec 13.3 propone quitarlo: no sirve a ninguna de sus metas.', 1),

  ('f4l-nau-leg-press', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Prensa de piernas sentado', 'Seated leg press', 'selectorized', 10*${LB},
   NULL, 400*${LB}, 'hypertrophy', 'beginner',
   'Prensa de torre, se carga con el switch.', 1),

  ('f4l-nau-leg-extension', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Extension de piernas', 'Leg extension', 'selectorized', 10*${LB},
   NULL, NULL, 'hypertrophy', 'beginner',
   'Cuadriceps aislado.', 1),

  ('f4l-nau-leg-curl', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Curl femoral', 'Leg curl', 'selectorized', 10*${LB},
   NULL, NULL, 'hypertrophy', 'beginner',
   'Isquiotibiales.', 1),

  ('f4l-nau-back-extension', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Extension lumbar', 'Back extension', 'selectorized', 10*${LB},
   NULL, NULL, 'strength', 'beginner',
   'Extensores de la espalda baja.', 1),

  ('f4l-nau-dual-pulley', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Polea doble ajustable', 'Dual adjustable pulley', 'cable', 10*${LB},
   NULL, NULL, 'hypertrophy', 'intermediate',
   'Dos poleas de altura libre. Es la estacion mas versatil del gym: laterales, triceps, martillo, posterior.', 1),

  -- De discos
  ('f4l-nau-angled-leg-press', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Prensa inclinada de discos', 'Angled leg press', 'plate_loaded', 20*${LB},
   NULL, NULL, 'strength', 'intermediate',
   'Se carga con discos, no con torre. El salto depende de los discos que le pongas.', 0),

  ('f4l-nau-hack', 'fit4less-proudfoot', NULL, 'Nautilus',
   'Sentadilla hack', 'Hack squat', 'plate_loaded', 20*${LB},
   NULL, NULL, 'strength', 'intermediate',
   'Equivalente de la V-Squat de Fanshawe. De discos.', 0);

-- Un solo enlace por ejercicio y gimnasio. La tabla admite varios, pero el catalogo
-- muestra una maquina y de ella sale el salto de peso de las flechas (spec 5.1), asi
-- que aqui va la que de verdad usaria. Las demas siguen en la lista de equipos
-- aunque ningun ejercicio apunte a ellas: el remo Nautilus, el jalon Star Trac y las
-- poleas altas existen, solo que todavia no hay un ejercicio suyo que las use.
-- Todos los ejercicios sembrados se pueden hacer aqui, igual que en Fanshawe.
INSERT INTO training_exercise_gym (exercise_id, gym_id)
SELECT id, 'fit4less-proudfoot' FROM training_exercise;

INSERT INTO training_exercise_equipment (exercise_id, equipment_id) VALUES
  ('seated-chest-press', 'f4l-nau-chest-press'),
  ('peck-deck',          'f4l-nau-pec-fly'),
  ('reverse-pec-deck',   'f4l-nau-pec-fly'),
  ('cable-row-narrow',   'f4l-st-row'),
  ('hip-adductor',       'f4l-nau-adductor'),
  ('leg-extension',      'f4l-nau-leg-extension'),
  ('leg-curl',           'f4l-nau-leg-curl'),
  ('hack-squat',         'f4l-nau-hack'),
  ('pull-up',            'f4l-st-pullup'),
  ('lateral-raise',      'f4l-nau-deltoid-raise'),
  ('hammer-curl',        'f4l-nau-dual-pulley'),
  ('triceps-pulldown',   'f4l-nau-dual-pulley'),
  ('overhead-triceps',   'f4l-nau-dual-pulley');
`;
