// Con que se hizo cada serie.
//
// El martillo se puede hacer con mancuernas o con la soga en la polea, y no pesan
// igual: con mancuernas el numero que escribe es el de una mano y se levantan dos,
// con la polea el numero de la torre ya es todo. Hasta ahora lo decidia el catalogo
// del ejercicio, que solo puede tener una respuesta, asi que la serie se lo guarda.
//
// Null es lo normal: se hizo con lo que dice el catalogo.
export const sql = `
ALTER TABLE training_set_entry ADD COLUMN implement TEXT
  CHECK (implement IN ('machine', 'barbell', 'ez_bar', 'dumbbell', 'cable', 'bodyweight'));
`;
