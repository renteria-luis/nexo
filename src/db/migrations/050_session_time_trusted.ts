// Si el tiempo de una sesion sirve para hacer cuentas con el.
//
// Unos dias marca bien la entrada y la salida y otros no: cierra el entreno en el
// vestuario, o se le olvida y lo cierra en casa. Un promedio hecho con esos dos
// mezclados no dice cuanto tarda, dice cualquier cosa, y es justo el numero que quiere
// ver antes de empezar.
//
// Asi que cada sesion dice si su duracion vale, y el lo corrige en el registro del dia.
// Solo las marcadas entran en el promedio y en la grafica de tiempo.
//
// Lo ya registrado no se puede preguntar, asi que entra marcado lo que dura entre veinte
// minutos y cuatro horas, que es lo que puede ser un entreno de verdad; lo de tres
// minutos o lo de nueve horas se queda fuera hasta que el diga lo contrario. Es un punto
// de partida, no una afirmacion: el interruptor esta a un toque en cada dia.
export const sql = `
ALTER TABLE training_session ADD COLUMN duration_trusted INTEGER NOT NULL DEFAULT 0
  CHECK (duration_trusted IN (0, 1));

UPDATE training_session
   SET duration_trusted = 1
 WHERE start_time IS NOT NULL
   AND end_time IS NOT NULL
   AND (end_time - start_time) BETWEEN 20 * 60000 AND 240 * 60000;
`;
