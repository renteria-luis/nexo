// El material que tiene cualquier gimnasio comercial y que el no detallo porque no
// varia entre gimnasios. Va aparte de la 019 porque son cosas distintas: aquella es
// el inventario de maquinas que si varia, esta es el piso basico.
//
// Sin esto el press inclinado con mancuernas no sabria de cuanto son los saltos en
// este gimnasio y las flechas se moverian con el valor generico del ejercicio.

const LB = 0.45359237;

export const sql = `
INSERT INTO training_equipment
  (id, gym_id, model_code, brand, name_es, name_en, kind, load_increment,
   stack_min_kg, stack_max_kg, primary_use, level, notes_es, increment_confirmed)
VALUES
  -- Lo basico que tiene cualquier gimnasio comercial. El no lo detallo porque no
  -- varia entre gimnasios, pero la app necesita saber que esta aqui: sin esto el
  -- press inclinado con mancuernas no sabria de cuanto son los saltos en este gym.
  ('f4l-dumbbells', 'fit4less-proudfoot', NULL, NULL, 'Mancuernas', 'Dumbbells',
   'free_weight', 5*${LB}, NULL, NULL, 'hypertrophy', 'beginner',
   'Rango y salto sin confirmar: falta que los lea en el rack. 5 lb es lo habitual en un gimnasio comercial, no una medida suya.', 0),

  ('f4l-benches', 'fit4less-proudfoot', NULL, NULL, 'Bancos', 'Benches',
   'bench', NULL, NULL, NULL, NULL, NULL,
   'Plano, inclinado y ajustables. Varios.', 1),

  ('f4l-smith', 'fit4less-proudfoot', NULL, NULL, 'Maquina Smith', 'Smith machine',
   'rack', 5*${LB}, NULL, NULL, 'strength', 'intermediate',
   'Barra guiada. El salto depende de los discos: 5 lb cargando los dos lados, sin confirmar.', 0),

  ('f4l-barbells', 'fit4less-proudfoot', NULL, NULL, 'Barras y discos', 'Barbells and plates',
   'free_weight', 5*${LB}, NULL, NULL, 'strength', 'intermediate',
   'Press plano con barra y discos sueltos. Salto sin confirmar.', 0);

INSERT INTO training_exercise_equipment (exercise_id, equipment_id) VALUES
  ('incline-db-press', 'f4l-dumbbells'),
  ('incline-curl',     'f4l-dumbbells');
`;
