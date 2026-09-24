// El predicador sale de la rutina de pull, no del catalogo.
//
// El curl inclinado y el predicador son el mismo musculo en dos posiciones, y la que
// mas paga por serie es la estirada del inclinado; el martillo ademas cubre braquial
// y antebrazo. Con los tres, el dia de pull pedia nueve series directas de biceps
// mas lo que suman dominadas y remo, muy por encima de donde el biceps sigue
// respondiendo. Quedan seis directas, que es la banda.
//
// El ejercicio sigue existiendo: se puede elegir cualquier dia desde "ver todos los
// ejercicios", y sirve para cambiarlo por el inclinado cuando quiera variar, que es
// distinto de sumarlo.
export const sql = `
DELETE FROM training_routine_exercise WHERE routine_id = 'pull' AND exercise_id = 'preacher-curl';
`;
