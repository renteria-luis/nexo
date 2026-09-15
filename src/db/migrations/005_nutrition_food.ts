export const sql = `
CREATE TABLE nutrition_food (
  id              TEXT    PRIMARY KEY,
  name            TEXT    NOT NULL,
  brand           TEXT,
  store           TEXT,
  -- The unit every macro below is expressed per, and it is the unit he logs in:
  -- 'g', 'ml', 'huevo', 'unidad'. Label servings are not used here. A food stored
  -- per two eggs makes logging five of them impossible, and one stored per 250 ml
  -- makes a 300 ml glass a mental division.
  base_unit       TEXT    NOT NULL,
  -- What kind of amount base_unit measures, so the screen knows whether to ask for
  -- a weight, a volume or a count.
  unit_kind       TEXT    NOT NULL CHECK (unit_kind IN ('mass', 'volume', 'count')),
  -- How many grams one base_unit weighs, when the label says. Needed for the
  -- batch maths in spec 7.3, which works from protein per gram. NULL where the
  -- source gives no weight, because spec 16.3 rule 5 forbids inventing one.
  base_unit_g     REAL    CHECK (base_unit_g > 0),
  kcal            REAL    NOT NULL CHECK (kcal >= 0),
  protein_g       REAL    NOT NULL CHECK (protein_g >= 0),
  -- Nullable: the owner-verified catalog in spec 7.1 leaves it blank for oats and
  -- the Jr. Bacon Cheeseburger, and spec 16.3 rule 5 forbids inferring a missing value.
  carbs_g         REAL    CHECK (carbs_g >= 0),
  sugar_g         REAL    CHECK (sugar_g >= 0),
  fat_g           REAL    NOT NULL CHECK (fat_g >= 0),
  fibre_g         REAL    CHECK (fibre_g >= 0),
  sodium_mg       REAL    CHECK (sodium_mg >= 0),
  barcode         TEXT,
  -- user_measured always wins over a fetched value and is never overwritten
  -- (spec 7.1). The column records which kind of value this row holds.
  source          TEXT    NOT NULL CHECK (source IN ('user_measured', 'off', 'usda', 'label')),
  -- Price of one purchased package, as an integer count of cents. REAL accumulates
  -- rounding error and the protein per dollar comparison in spec 16.6 depends on it
  -- not doing that.
  price_cad_cents INTEGER CHECK (price_cad_cents >= 0),
  -- How many base_units one package holds, so price per base_unit is derivable.
  package_size    REAL    CHECK (package_size > 0),
  glycemic_index  INTEGER CHECK (glycemic_index BETWEEN 0 AND 110),
  is_dairy        INTEGER NOT NULL DEFAULT 0 CHECK (is_dairy IN (0, 1)),
  CHECK (sugar_g IS NULL OR sugar_g <= carbs_g)
) STRICT;

CREATE INDEX nutrition_food_by_barcode ON nutrition_food (barcode) WHERE barcode IS NOT NULL;

CREATE TABLE nutrition_container (
  id        TEXT    PRIMARY KEY,
  name      TEXT    NOT NULL,
  volume_ml INTEGER NOT NULL CHECK (volume_ml > 0)
) STRICT;

-- Spec 5.8: seeded with the 710 ml bottle, used about 90% of the time.
INSERT INTO nutrition_container (id, name, volume_ml) VALUES ('bottle-710', 'Botella 710 ml', 710);
`;
