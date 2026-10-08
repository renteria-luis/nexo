// Only dates whose denominator could have come from the wrong session need rebuilding.
export const sql = `
UPDATE core_daily_log SET score = NULL
 WHERE date IN (SELECT date FROM training_session GROUP BY date HAVING count(*) > 1);
`;
