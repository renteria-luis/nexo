// Las elevaciones laterales en la maquina de Fit4Less, y la forma de elegir entre
// variantes del mismo ejercicio segun el gimnasio.
//
// El equipo ya estaba (la Nautilus IPDR3), pero no habia ejercicio, asi que en
// Fit4Less el plan salia con la polea aunque las recomendaciones digan que la maquina
// es la primera opcion: el respaldo fija el hombro y quita el impulso del tronco, y la
// polea queda segunda porque mantiene tension abajo, cosa que la mancuerna no hace.
//
// La tabla de variantes es lo que deja que eso se decida solo. Rango 1 es la mejor
// opcion; el plan se queda con la mejor que exista en el gimnasio de esa sesion.
const LB = 0.45359237;

export const sql = `
INSERT INTO training_exercise
  (id, name_es, name_en, primary_muscle, equipment_type, load_increment,
   default_rest_seconds, unilateral, technique_text)
VALUES
  ('lateral-raise-machine', 'Elevaciones laterales en maquina',
   'Machine lateral raise', 'lateral_delts', 'machine', 5*${LB}, 120, 0,
   'Sientate con la espalda pegada al respaldo y los codos contra las almohadillas.
Sube hasta la altura del hombro, no mas: por encima entra el trapecio.
Baja en 2 segundos, sin dejar que el peso golpee la torre.
La maquina te quita el impulso del tronco, que es su ventaja sobre la mancuerna.
Error comun: empujar con las manos en vez de con los codos.');

INSERT INTO training_exercise_muscle (exercise_id, muscle, contribution) VALUES
  ('lateral-raise-machine', 'lateral_delts', 1.0);

INSERT INTO training_exercise_gym (exercise_id, gym_id) VALUES
  ('lateral-raise-machine', 'fit4less-proudfoot');

INSERT INTO training_exercise_equipment (exercise_id, equipment_id) VALUES
  ('lateral-raise-machine', 'f4l-nau-deltoid-raise');

-- Variantes del mismo hueco de la rutina, de mejor a peor.
CREATE TABLE training_exercise_variant (
  base_exercise_id TEXT    NOT NULL REFERENCES training_exercise (id) ON DELETE CASCADE,
  exercise_id      TEXT    NOT NULL REFERENCES training_exercise (id) ON DELETE CASCADE,
  rank             INTEGER NOT NULL CHECK (rank > 0),
  PRIMARY KEY (base_exercise_id, exercise_id)
) STRICT;

INSERT INTO training_exercise_variant (base_exercise_id, exercise_id, rank) VALUES
  ('lateral-raise', 'lateral-raise-machine', 1),
  ('lateral-raise', 'lateral-raise-cable', 2);
`;
