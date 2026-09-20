// Spec 16.5, the Deals module's own tables. Namespaced deals_* per spec 17.3: no
// module shares a table with another, and deleting this module means dropping these
// and nothing else.
//
// Money is integer cents, like nutrition_food.price_cad_cents. A float dollar would
// accumulate error in exactly the comparison this module exists to make.
//
// raw_payload keeps the untouched source response (spec 16.5). When a parse looks
// wrong the original is there to check against, which is what makes the confidence
// rule auditable instead of aspirational.
export const sql = `
CREATE TABLE deals_source (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  auth_type         TEXT NOT NULL CHECK (auth_type IN ('none', 'oauth', 'email_pin', 'scrape')),
  poll_schedule     TEXT,
  last_success_at   INTEGER,
  last_error        TEXT,
  -- Spec 16.7: a failing source says so out loud instead of showing stale data as
  -- if it were fresh.
  health            TEXT NOT NULL DEFAULT 'ok' CHECK (health IN ('ok', 'degraded', 'down')),
  deep_link_scheme  TEXT,
  web_fallback_url  TEXT
) STRICT;

CREATE TABLE deals_retailer (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  chain    TEXT,
  address  TEXT,
  lat      REAL CHECK (lat BETWEEN -90 AND 90),
  lng      REAL CHECK (lng BETWEEN -180 AND 180),
  province TEXT,
  city     TEXT,
  CHECK ((lat IS NULL) = (lng IS NULL))
) STRICT;

CREATE TABLE deals_deal (
  id                   TEXT    PRIMARY KEY,
  source_id            TEXT    NOT NULL REFERENCES deals_source (id) ON DELETE CASCADE,
  retailer_id          TEXT    REFERENCES deals_retailer (id),
  title                TEXT    NOT NULL,
  description          TEXT,
  price_cents          INTEGER CHECK (price_cents >= 0),
  original_price_cents INTEGER CHECK (original_price_cents >= 0),
  savings_pct          REAL    CHECK (savings_pct BETWEEN 0 AND 100),
  -- What the price is per, as the source words it: 'lb', 'kg', 'ea'. NULL when the
  -- source did not say, and spec 16.3 rule 5 then forbids guessing it.
  unit                 TEXT,
  quantity_available   INTEGER CHECK (quantity_available >= 0),
  best_before          TEXT    CHECK (best_before GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  valid_from           TEXT    CHECK (valid_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  valid_to             TEXT    CHECK (valid_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  category             TEXT,
  image_url            TEXT,
  source_url           TEXT,
  deep_link            TEXT,
  fetched_at           INTEGER NOT NULL,
  expires_at           INTEGER,
  -- Spec 16.3 rule 6. exact came from a structured response, parsed was read out of
  -- flyer text or OCR and carries a visible marker on screen.
  confidence           TEXT    NOT NULL CHECK (confidence IN ('exact', 'parsed')),
  raw_payload          TEXT,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
) STRICT;

CREATE INDEX deals_deal_by_source ON deals_deal (source_id, valid_to);

-- Spec 17.4 rule 2: this holds a foreign key into nutrition, never a copy of it,
-- and this module never writes to nutrition tables.
CREATE TABLE deals_match (
  deal_id          TEXT    NOT NULL REFERENCES deals_deal (id) ON DELETE CASCADE,
  food_id          TEXT    NOT NULL REFERENCES nutrition_food (id) ON DELETE CASCADE,
  match_confidence REAL    CHECK (match_confidence BETWEEN 0 AND 1),
  matched_by       TEXT    NOT NULL CHECK (matched_by IN ('barcode', 'exact_name', 'fuzzy', 'manual')),
  -- A fuzzy match starts unconfirmed and one tap settles it (spec 16.5).
  user_confirmed   INTEGER CHECK (user_confirmed IN (0, 1)),
  PRIMARY KEY (deal_id, food_id)
) STRICT;

CREATE TABLE deals_discount (
  id          TEXT    PRIMARY KEY,
  retailer_id TEXT    REFERENCES deals_retailer (id),
  -- Chain name when the discount is the chain's and not one shop's.
  chain       TEXT,
  percent     REAL    NOT NULL CHECK (percent > 0 AND percent <= 100),
  -- ISO weekday numbers, 1 is Monday. Empty means every day. A list in one column
  -- rather than a child table: there are two rows in here and there will be two.
  days_of_week TEXT   NOT NULL DEFAULT '' CHECK (days_of_week GLOB '' OR days_of_week GLOB '[1-7]*'),
  conditions  TEXT,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  CHECK (retailer_id IS NOT NULL OR chain IS NOT NULL)
) STRICT;

INSERT INTO deals_source (id, name, auth_type, poll_schedule, health, web_fallback_url)
VALUES ('flipp', 'Flipp', 'none', 'diario, temprano', 'ok', 'https://flipp.com/');

-- Spec 16.5. Los dos descuentos que ya tiene.
INSERT INTO deals_discount (id, chain, percent, days_of_week, conditions, active) VALUES
  ('foodbasics-student', 'Food Basics', 10, '2', 'Descuento de estudiante, solo martes', 1),
  ('metro-student', 'Metro', 10, '', 'Descuento de estudiante, todos los dias', 1);
`;
