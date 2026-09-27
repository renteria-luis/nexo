// Las notas guardadas otra vez a cero.
//
// Comer bien dejo de restar (spec 4.1). La proteina por encima de la banda ya no baja
// la curva: 204 g en un dia valian 14.5 de 16 y ahora valen los dieciseis. Y pasarse de
// calorias solo cuesta a partir de mil por encima del piso de la banda, a un punto por
// cada doscientas, en vez de caer desde el borde mismo de la banda.
//
// Las notas viejas se calcularon con la forma anterior, asi que se rehacen en el
// siguiente arranque.
export const sql = `
UPDATE core_daily_log SET score = NULL;
`;
