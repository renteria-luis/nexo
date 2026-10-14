// The notification centre forgets dismissed warnings; the trip must remember them across restarts.
export const sql = `
CREATE TABLE transit_trip_notice (
  trip_id TEXT NOT NULL,
  event TEXT NOT NULL,
  fires_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL CHECK(consumed IN (0, 1)),
  PRIMARY KEY(trip_id, event)
) STRICT;
`;
