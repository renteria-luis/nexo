// A transfer walks from the stop he gets off at to the one he boards, and the way back can
// cross somewhere else, so each direction is its own row. Without a row the planner estimates
// the walk and says so.
export const sql = `
CREATE TABLE transit_stop_walk (
  from_stop TEXT NOT NULL,
  to_stop TEXT NOT NULL CHECK(to_stop <> from_stop),
  minutes REAL NOT NULL CHECK(minutes > 0 AND minutes <= 60),
  note TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(from_stop, to_stop)
) STRICT;
`;
