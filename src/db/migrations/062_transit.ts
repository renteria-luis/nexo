export const sql = `
CREATE TABLE transit_place (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  address TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180),
  gym_id TEXT REFERENCES training_gym(id),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE transit_walk_link (
  place_id TEXT NOT NULL REFERENCES transit_place(id) ON DELETE CASCADE,
  stop_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('to_stop', 'from_stop')),
  minutes REAL NOT NULL CHECK(minutes > 0 AND minutes <= 240),
  entrance TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(place_id, stop_id, direction)
) STRICT;

CREATE TABLE transit_schedule_cache (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  sha256 TEXT NOT NULL,
  content TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  checked_at INTEGER,
  last_error TEXT
) STRICT;

INSERT INTO transit_place (id, name, address, lat, lng, gym_id, updated_at) VALUES
  ('fit4less', 'Fit4Less', '710 Proudfoot Ln', 42.98670962272733, -81.28821439880518, 'fit4less-proudfoot', 1791676800000),
  ('fanshawe-gym', 'Fanshawe Gym', '1001 Fanshawe College Blvd; gym activity point', 43.01296426492525, -81.20110499946226, 'fanshawe', 1791676800000),
  ('costco', 'Costco', 'Wonderland entrance', 42.987403880318695, -81.29312292090583, NULL, 1791676800000),
  ('food-basics', 'Food Basics', 'Oxford location', 43.007083459801024, -81.20999778335016, NULL, 1791676800000),
  ('masonville-cinema', 'Cine / Silver Cinema Masonville', 'Cinema door', 43.026710418406886, -81.27776375611536, NULL, 1791676800000),
  ('masonville-door', 'Masonville puerta', 'Preferred mall entrance', 43.02530711640906, -81.27953905422177, NULL, 1791676800000);
`;
