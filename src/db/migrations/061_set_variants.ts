// Cada serie vieja, en el ejercicio con el que de verdad se hizo.
//
// Hasta el 8 de octubre el martillo era un solo ejercicio, el de polea, con botones
// para decir "lo hice con mancuernas", y la serie guardaba esa respuesta (031). La 058
// convirtio los botones en ejercicios separados pero dejo las series donde estaban:
// el martillo en polea mostraba las marcas de mancuernas y el de mancuernas salia
// vacio. Ahora la serie que dice con que se hizo pasa al ejercicio de su familia hecho
// con eso, y si no hay ninguno se queda donde esta. No se borra nada.
//
// El plan de esa sesion se va con ellas solo cuando no quedo ninguna serie atras, para
// que el dia siga diciendo "3 de 3 series". Las series de los dos ejercicios tocados se
// numeran de nuevo por hora: la serie 1 que llega puede caer donde ya habia otra serie 1.
export const sql = `
CREATE TEMP TABLE set_move AS
SELECT s.id AS set_id, s.session_id, s.exercise_id AS from_id,
       (SELECT m.id
          FROM training_exercise m
          LEFT JOIN training_exercise_variant mv ON mv.exercise_id = m.id
         WHERE m.equipment_type = s.implement
           AND coalesce(mv.base_exercise_id, m.id) = coalesce(v.base_exercise_id, s.exercise_id)
         ORDER BY m.archived, coalesce(mv.rank, 0), m.id
         LIMIT 1) AS to_id
  FROM training_set_entry s
  JOIN training_exercise x ON x.id = s.exercise_id
  LEFT JOIN training_exercise_variant v ON v.exercise_id = s.exercise_id
 WHERE s.implement IS NOT NULL AND s.implement <> x.equipment_type;
DELETE FROM set_move WHERE to_id IS NULL;

CREATE TEMP TABLE plan_move AS
SELECT session_id, from_id, min(to_id) AS to_id
  FROM set_move
 GROUP BY session_id, from_id
HAVING count(DISTINCT to_id) = 1;

UPDATE training_session_plan
   SET exercise_id = (SELECT m.to_id FROM plan_move m
                       WHERE m.session_id = training_session_plan.session_id
                         AND m.from_id = training_session_plan.exercise_id)
 WHERE EXISTS (
   SELECT 1 FROM plan_move m
    WHERE m.session_id = training_session_plan.session_id
      AND m.from_id = training_session_plan.exercise_id
      AND NOT EXISTS (SELECT 1 FROM training_set_entry s
                       WHERE s.session_id = m.session_id AND s.exercise_id = m.from_id
                         AND s.id NOT IN (SELECT set_id FROM set_move))
      AND NOT EXISTS (SELECT 1 FROM training_session_plan p
                       WHERE p.session_id = m.session_id AND p.exercise_id = m.to_id)
      AND NOT EXISTS (SELECT 1 FROM plan_move o
                       WHERE o.session_id = m.session_id AND o.to_id = m.to_id
                         AND o.from_id <> m.from_id));

CREATE TEMP TABLE set_number AS
SELECT set_id, row_number() OVER (
         PARTITION BY session_id, final_id ORDER BY timestamp, old_index, set_id
       ) AS new_index
  FROM (SELECT s.id AS set_id, s.session_id, s.timestamp, s.set_index AS old_index,
               coalesce(m.to_id, s.exercise_id) AS final_id
          FROM training_set_entry s
          LEFT JOIN set_move m ON m.set_id = s.id
         WHERE EXISTS (SELECT 1 FROM set_move g
                        WHERE g.session_id = s.session_id
                          AND s.exercise_id IN (g.from_id, g.to_id)));

-- Primero fuera del camino y luego a su sitio, porque el indice unico se revisa fila
-- por fila y un cambio a medias chocaria con la serie que todavia no se movio.
UPDATE training_set_entry SET set_index = set_index + 1000000
 WHERE id IN (SELECT set_id FROM set_number);
UPDATE training_set_entry
   SET exercise_id = coalesce((SELECT m.to_id FROM set_move m WHERE m.set_id = training_set_entry.id),
                              exercise_id),
       set_index = (SELECT n.new_index FROM set_number n WHERE n.set_id = training_set_entry.id)
 WHERE id IN (SELECT set_id FROM set_number);

DROP TABLE set_number;
DROP TABLE plan_move;
DROP TABLE set_move;
`;
