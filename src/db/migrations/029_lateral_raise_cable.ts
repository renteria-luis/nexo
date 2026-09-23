// Las laterales en polea, que hasta ahora eran solo una propuesta escrita en la
// pantalla de recomendaciones.
//
// En Fanshawe la unica polea es la torre doble Matrix, la misma del triceps por
// encima de la cabeza y el martillo. Con las dos poleas a la vez ocupa la torre
// entera; con una sola es a un brazo por vez y cuesta el doble de reloj. En
// Fit4Less la estacion Star Trac tiene dos poleas ajustables y sirve igual.
//
// Por eso no reemplaza a las mancuernas, se turna con ellas: a tiempo completo la
// polea, que mantiene la tension todo el recorrido, y en cuanto recorta tiempo
// vuelven las mancuernas, que son dos brazos a la vez.
const LB = 0.45359237;

export const sql = `
INSERT INTO training_exercise
  (id, name_es, name_en, primary_muscle, equipment_type, load_increment,
   default_rest_seconds, unilateral, technique_text)
VALUES
  ('lateral-raise-cable', 'Elevaciones laterales en polea, un brazo',
   'Single arm cable lateral raise', 'lateral_delts', 'cable', 2.5*${LB}, 120, 1,
   'Polea en el punto mas bajo, de pie al costado, el cable cruza por delante del cuerpo.
Sujeta la torre con la otra mano y no acompanes con el tronco.
Codo con flexion ligera y fija, sube hasta la altura del hombro.
Baja en 2 segundos: la polea sigue tirando abajo, que es justo lo que la mancuerna no hace.
Error comun: girar el cuerpo para ayudarse en la ultima repeticion.');

INSERT INTO training_exercise_muscle (exercise_id, muscle, contribution) VALUES
  ('lateral-raise-cable', 'lateral_delts', 1.0);

INSERT INTO training_exercise_gym (exercise_id, gym_id) VALUES
  ('lateral-raise-cable', 'fanshawe'),
  ('lateral-raise-cable', 'fit4less-proudfoot');

INSERT INTO training_exercise_equipment (exercise_id, equipment_id) VALUES
  ('lateral-raise-cable', 'fan-matrix-cable'),
  ('lateral-raise-cable', 'f4l-st-pulleys');

-- Spec 8.2: el presupuesto de tiempo ya decide cuantas series, y aqui ademas decide
-- con que se hacen. NULL es lo normal: el ejercicio no cambia con el tiempo.
ALTER TABLE training_routine_exercise
  ADD COLUMN full_time_exercise_id TEXT REFERENCES training_exercise (id);

UPDATE training_routine_exercise
   SET full_time_exercise_id = 'lateral-raise-cable'
 WHERE exercise_id = 'lateral-raise';
`;
