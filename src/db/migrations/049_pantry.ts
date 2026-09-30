// La despensa y el recetario. Spec 21.
//
// Cuatro formas de tener algo, porque son las cuatro que hay de verdad en su nevera:
// contado (huevos), pesado (arroz, pollo), duradero (whey, aceite, mantequilla) y
// especia (sal, pimienta). Las dos ultimas no llevan cantidad a proposito: no va a pesar
// un cacito de proteina cada vez que usa uno, y pedirle gramos ahi garantiza que el
// numero este mal. Un numero grueso que es verdad vale mas que uno exacto que no lo es.
//
// La misma fila no puede tener las tres cosas a la vez, y eso lo dice la base y no el
// codigo: un CHECK por forma, porque una despensa a medio llenar con estados sueltos en
// filas que llevan cantidad es exactamente lo que hace que una receta diga que si cuando
// no hay nada.
//
// Un ingrediente apunta a lo que hay en la despensa, y lo que hay en la despensa apunta
// a su alimento del catalogo cuando se come, asi la receta calcula sus macros con las
// cifras que el mismo verifico (spec 7.1) y no con una segunda tabla que se le va a ir
// separando de aquella.
//
// `from_recipe` marca los alimentos que crea una olla al cocinarla: existen para que el
// lote (spec 7.3) tenga de que tirar, y no salen ni en el catalogo ni en el buscador,
// porque la forma de anotar una olla es su porcion y no volver a pesarla.
export const sql = `
CREATE TABLE pantry_item (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('counted', 'weighed', 'durable', 'spice')),
  -- Lo contado y lo pesado llevan cantidad y unidad.
  quantity   REAL    CHECK (quantity >= 0),
  unit       TEXT,
  -- Lo duradero lleva estado.
  state      TEXT    CHECK (state IN ('hay', 'poco', 'no hay')),
  -- Las especias, si o no.
  has_it     INTEGER CHECK (has_it IN (0, 1)),
  food_id    TEXT    REFERENCES nutrition_food (id),
  updated_at TEXT    NOT NULL,
  CHECK (
    (kind IN ('counted', 'weighed')
      AND quantity IS NOT NULL AND unit IS NOT NULL AND state IS NULL AND has_it IS NULL)
    OR (kind = 'durable'
      AND state IS NOT NULL AND quantity IS NULL AND unit IS NULL AND has_it IS NULL)
    OR (kind = 'spice'
      AND has_it IS NOT NULL AND quantity IS NULL AND unit IS NULL AND state IS NULL)
  )
) STRICT;

CREATE TABLE pantry_recipe (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  steps      TEXT    NOT NULL DEFAULT '',
  portions   INTEGER NOT NULL CHECK (portions > 0),
  created_at TEXT    NOT NULL
) STRICT;

CREATE TABLE pantry_recipe_ingredient (
  recipe_id TEXT    NOT NULL REFERENCES pantry_recipe (id) ON DELETE CASCADE,
  item_id   TEXT    NOT NULL REFERENCES pantry_item (id) ON DELETE CASCADE,
  -- Cuanto se gasta. Null en lo duradero y en las especias, que no se miden.
  amount    REAL    CHECK (amount > 0),
  position  INTEGER NOT NULL,
  PRIMARY KEY (recipe_id, item_id)
) STRICT;

ALTER TABLE nutrition_food ADD COLUMN from_recipe INTEGER NOT NULL DEFAULT 0
  CHECK (from_recipe IN (0, 1));
`;
