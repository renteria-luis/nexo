// Lo que hace falta para poder editar el catalogo desde la app en vez de pedir un
// cambio de codigo por cada ajuste.
//
// Dos cosas que hasta ahora estaban adivinadas o pegadas en una sola linea de texto:
//
// 1. **Con que se puede hacer un ejercicio.** La app mostraba los botones de mancuerna,
//    polea y maquina en todo lo que no fuera barra o peso corporal, y por eso salian en
//    el press inclinado con mancuernas, que nadie hace en polea. Ahora es un dato: la
//    lista de implementos validos de ese ejercicio, vacia cuando no hay nada que elegir.
//
// 2. **La nota de la (i).** Era una sola columna de texto por ejercicio, asi que no
//    podia decir una cosa con mancuerna y otra en polea. Ahora es una fila por ejercicio
//    y por implemento, con la fila de implemento vacio como la general.
export const sql = `
ALTER TABLE training_exercise ADD COLUMN implements TEXT NOT NULL DEFAULT '';

CREATE TABLE training_exercise_note (
  exercise_id TEXT NOT NULL REFERENCES training_exercise (id) ON DELETE CASCADE,
  -- Vacio es la nota general, la que vale mientras no haya elegido implemento.
  implement   TEXT NOT NULL DEFAULT ''
                   CHECK (implement IN ('', 'dumbbell', 'cable', 'machine')),
  note        TEXT NOT NULL,
  PRIMARY KEY (exercise_id, implement)
) STRICT;

INSERT INTO training_exercise_note (exercise_id, implement, note)
  SELECT id, '', technique_text
    FROM training_exercise
   WHERE technique_text IS NOT NULL AND technique_text <> '';

-- Los dos que si se hacen de varias formas, que son los que el codigo nombraba en sus
-- comentarios. El resto se queda sin botones hasta que el los ponga desde Ajustes.
UPDATE training_exercise SET implements = 'dumbbell,cable,machine' WHERE id = 'lateral-raise';
UPDATE training_exercise SET implements = 'dumbbell,cable' WHERE id = 'hammer-curl';

-- La columna vieja se va: con la tabla de notas al lado serian dos sitios diciendo lo
-- mismo, y el segundo se queda viejo el dia que edite una nota.
ALTER TABLE training_exercise DROP COLUMN technique_text;
`;
