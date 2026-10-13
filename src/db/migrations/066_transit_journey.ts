export const sql = `
CREATE TABLE transit_journey_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  content TEXT NOT NULL
) STRICT;
CREATE TABLE transit_reminder_event (
  journey_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('prepare', 'leave')),
  fires_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0, 1)),
  PRIMARY KEY(journey_id, kind)
) STRICT;
`;
