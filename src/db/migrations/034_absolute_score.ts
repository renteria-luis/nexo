// Las notas guardadas se borran para que se vuelvan a calcular.
//
// Pasaron de ser relativas (lo ganado entre lo anotado) a absolutas (lo ganado sobre
// los cien puntos del dia), asi que un numero viejo y uno nuevo ya no significan lo
// mismo y no se pueden comparar en la misma cuadricula. Vaciarlas es lo que hace que
// el repuntaje del arranque las rehaga todas con el modelo nuevo.
export const sql = `
UPDATE core_daily_log SET score = NULL;
`;
