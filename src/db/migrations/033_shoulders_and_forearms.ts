// La rutina reordenada alrededor de lo que el pidio: brazos y hombros primero.
//
// Con su reparto real (push dos veces, pull dos veces, pierna una) el programa daba
// 9 series semanales al deltoide lateral y 6 al posterior, las dos en el suelo de la
// banda o por debajo, siendo lo que mas le importa. El pecho, que es su segunda
// prioridad, se llevaba 20. Asi que el pecho cede dos series y con eso se paga el
// hombro, sin alargar la sesion.
//
// El posterior ademas estaba en tier 4, o sea que era lo primero que desaparecia al
// recortar tiempo: sube a tier 2 en pull y entra en push en la misma maquina del
// contractor, que es un cambio de pin y no de estacion.
//
// Y entra el antebrazo directo, que no existia: solo recibia lo que caia de las
// dominadas y el martillo, que mantiene pero no construye.
//
// Queda: lateral 17 por semana, posterior 12, antebrazo 6 directas, pecho 16,
// espalda 14 pero corrida hacia el remo, que es lo que marca en vez de ensanchar.
const LB = 0.45359237;

export const sql = `
INSERT INTO training_exercise
  (id, name_es, name_en, primary_muscle, equipment_type, load_increment,
   default_rest_seconds, unilateral, technique_text)
VALUES
  ('reverse-curl', 'Curl inverso con barra Z', 'EZ bar reverse curl', 'forearms', 'ez_bar',
   2.5*${LB}, 90, 0,
   'Agarre prono, manos a la anchura de los hombros, codos pegados al costado.
Sube sin mover el codo de sitio: lo unico que gira es el antebrazo.
Bajada de dos segundos, y abajo estira del todo sin soltar la muneca.
Repeticiones altas, de 12 a 15: el antebrazo aguanta y responde a eso.
Error comun: subir el peso y terminar haciendo un curl con las munecas dobladas.');

INSERT INTO training_exercise_muscle (exercise_id, muscle, contribution) VALUES
  ('reverse-curl', 'forearms', 1.0),
  ('reverse-curl', 'biceps', 0.5);

INSERT INTO training_exercise_gym (exercise_id, gym_id) VALUES
  ('reverse-curl', 'fanshawe'),
  ('reverse-curl', 'fit4less-proudfoot');

INSERT INTO training_exercise_equipment (exercise_id, equipment_id) VALUES
  ('reverse-curl', 'fan-ez-bars'),
  ('reverse-curl', 'f4l-barbells');

-- Pull: menos vertical y mas horizontal, el posterior protegido, y entran hombro
-- lateral y antebrazo.
UPDATE training_routine_exercise
   SET sets_full = 3, sets_minus_25 = 3, sets_minus_50 = 3, sets_express = 3
 WHERE routine_id = 'pull' AND exercise_id = 'pull-up';

UPDATE training_routine_exercise
   SET sets_full = 4, sets_minus_25 = 4, sets_minus_50 = 4, sets_express = 4
 WHERE routine_id = 'pull' AND exercise_id = 'cable-row-narrow';

UPDATE training_routine_exercise
   SET position = 5, tier = 2, sets_full = 3, sets_minus_25 = 3, sets_minus_50 = 2
 WHERE routine_id = 'pull' AND exercise_id = 'reverse-pec-deck';

INSERT INTO training_routine_exercise
  (id, routine_id, exercise_id, position, tier,
   sets_full, sets_minus_25, sets_minus_50, sets_express,
   target_rep_mode, target_rep_min, target_rep_max)
VALUES
  ('pull-7', 'pull', 'lateral-raise', 6, 3, 3, 2, NULL, NULL, 'range', 12, 15),
  ('pull-8', 'pull', 'reverse-curl',  7, 3, 3, 2, NULL, NULL, 'range', 12, 15);

-- Push: el pecho paga las series del hombro, y el posterior entra en la misma
-- maquina donde ya esta haciendo el contractor.
UPDATE training_routine_exercise
   SET sets_full = 3, sets_minus_25 = 3, sets_minus_50 = 2
 WHERE routine_id = 'push' AND exercise_id = 'peck-deck';

UPDATE training_routine_exercise
   SET sets_full = 2, sets_minus_25 = 2, sets_minus_50 = 2
 WHERE routine_id = 'push' AND exercise_id = 'seated-chest-press';

UPDATE training_routine_exercise
   SET tier = 2, sets_full = 4, sets_minus_25 = 3, sets_minus_50 = 2
 WHERE routine_id = 'push' AND exercise_id = 'lateral-raise';

INSERT INTO training_routine_exercise
  (id, routine_id, exercise_id, position, tier,
   sets_full, sets_minus_25, sets_minus_50, sets_express,
   target_rep_mode, target_rep_min, target_rep_max)
VALUES
  ('push-7', 'push', 'reverse-pec-deck', 7, 3, 3, 2, NULL, NULL, 'range', 15, 15);
`;
