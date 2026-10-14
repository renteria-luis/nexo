// A trip he starts is followed from a frozen copy of the chosen option, kept here so a restart or
// a locked screen does not lose it; at most one is active. The walks it measures wait for his
// review before they teach anything, his crossing notes are points on the map, and a walk can
// carry the path he takes.
export const sql = `
CREATE TABLE transit_trip (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'canceled', 'expired')),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  content TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX transit_trip_one_active ON transit_trip(status) WHERE status = 'active';

CREATE TABLE transit_walk_observation (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('access', 'transfer', 'egress')),
  place_id TEXT REFERENCES transit_place(id) ON DELETE CASCADE,
  from_stop TEXT,
  to_stop TEXT,
  started_at INTEGER NOT NULL,
  left_at INTEGER,
  ended_at INTEGER NOT NULL CHECK(ended_at > started_at),
  start_source TEXT NOT NULL CHECK(start_source IN ('tap', 'gps')),
  end_source TEXT NOT NULL CHECK(end_source IN ('tap', 'gps')),
  accuracy_m REAL,
  path_m REAL NOT NULL,
  straight_m REAL NOT NULL,
  planned_minutes REAL NOT NULL,
  trace TEXT NOT NULL,
  flag TEXT CHECK(flag IN ('imprecise', 'fast', 'slow')),
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'accepted', 'excluded')),
  created_at INTEGER NOT NULL,
  CHECK(
    (kind = 'access' AND place_id IS NOT NULL AND to_stop IS NOT NULL AND from_stop IS NULL) OR
    (kind = 'transfer' AND place_id IS NULL AND from_stop IS NOT NULL AND to_stop IS NOT NULL) OR
    (kind = 'egress' AND place_id IS NOT NULL AND from_stop IS NOT NULL AND to_stop IS NULL)
  )
) STRICT;
CREATE INDEX transit_walk_observation_link
  ON transit_walk_observation(kind, place_id, from_stop, to_stop, ended_at);

CREATE TABLE transit_map_note (
  id TEXT PRIMARY KEY,
  lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180),
  kind TEXT NOT NULL CHECK(kind IN ('button', 'slow', 'note')),
  note TEXT NOT NULL DEFAULT '',
  wait_min INTEGER CHECK(wait_min BETWEEN 0 AND 600),
  wait_max INTEGER CHECK(wait_max BETWEEN 0 AND 600),
  updated_at INTEGER NOT NULL,
  CHECK(wait_min IS NULL OR wait_max IS NULL OR wait_min <= wait_max)
) STRICT;

ALTER TABLE transit_walk_link ADD COLUMN path TEXT NOT NULL DEFAULT '';
ALTER TABLE transit_stop_walk ADD COLUMN path TEXT NOT NULL DEFAULT '';
`;
