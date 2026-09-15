// Spec 4.2 charges half again as much for alcohol inside the six hours after a
// session, because that is the window the Parr data speaks to. The daily log keeps
// a count of drinks with no times attached, so the timing cannot be derived from
// what is already stored and has to be recorded on its own.
export const sql = `
ALTER TABLE core_daily_log
  ADD COLUMN alcohol_after_training INTEGER CHECK (alcohol_after_training IN (0, 1));
`;
