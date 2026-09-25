// Las notas guardadas se vuelven a vaciar.
//
// El sueno, la proteina y las calorias pasaron de umbrales a curvas (spec 4.1), asi
// que una nota vieja y una nueva ya no significan lo mismo. El repuntaje del arranque
// las rehace todas.
export const sql = `
UPDATE core_daily_log SET score = NULL;
`;
