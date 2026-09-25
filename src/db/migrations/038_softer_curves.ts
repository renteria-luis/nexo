// Otra vez a cero las notas guardadas.
//
// El agua, los pasos y las calorias dejaron de tener escalon (spec 4.1): 2.23 L ya no
// son 1.5 de 8 ni 1 180 kcal son cero de diez. Las notas viejas se calcularon con la
// forma anterior, asi que se rehacen en el siguiente arranque.
export const sql = `
UPDATE core_daily_log SET score = NULL;
`;
