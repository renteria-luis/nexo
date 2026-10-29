// An empty session or warmups alone do not count as training. Migration 071 kept
// their old zeros, even when no criterion had data (SPEC 6.6).
export const sql = `
UPDATE core_daily_log SET score = NULL
 WHERE score = 0
   AND water_ml IS NULL AND creatine_taken IS NULL
   AND alcohol_drinks IS NULL AND sleep_minutes IS NULL AND steps IS NULL
   AND rest_day = 0
   AND NOT EXISTS (
     SELECT 1 FROM training_session s
     JOIN training_set_entry e ON e.session_id = s.id AND e.is_warmup = 0
     WHERE s.date = core_daily_log.date
   )
   AND NOT EXISTS (SELECT 1 FROM nutrition_food_entry f WHERE f.date = core_daily_log.date);
`;
