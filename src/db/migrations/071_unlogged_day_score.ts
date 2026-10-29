// Spec 6.6: un dia pasado sin nada anotado no tiene nota. La falta de entreno se
// contaba como dato y esos dias se guardaban con 0; el repaso de siete dias los arregla
// solo si son recientes, asi que aqui se limpian los mas viejos (2026-10-25). Solo
// cambia una nota de 0 sin ningun criterio anotado, sin entreno, sin comida y sin
// descanso marcado: con cualquiera de esos el 0 puede ser cierto.
export const sql = `
UPDATE core_daily_log SET score = NULL
 WHERE score = 0
   AND water_ml IS NULL
   AND creatine_taken IS NULL
   AND alcohol_drinks IS NULL
   AND sleep_minutes IS NULL
   AND steps IS NULL
   AND rest_day = 0
   AND NOT EXISTS (SELECT 1 FROM training_session s WHERE s.date = core_daily_log.date)
   AND NOT EXISTS (SELECT 1 FROM nutrition_food_entry f WHERE f.date = core_daily_log.date);
`;
