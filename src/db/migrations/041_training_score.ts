// Las notas guardadas otra vez a cero.
//
// Los 22 puntos del entreno dejaron de ser un interruptor (spec 4.1): ahora salen de
// las series hechas contra las planeadas y de cuantos musculos del dia toco. Una nota
// vieja se calculo con una serie valiendo lo mismo que quince.
export const sql = `
UPDATE core_daily_log SET score = NULL;
`;
