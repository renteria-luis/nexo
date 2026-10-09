// Spec 16.5: lo que el contesto sobre si una oferta es de verdad su alimento.
//
// deals_match se borra y se vuelve a llenar con cada recoleccion, asi que la respuesta no
// puede vivir ahi: se guarda aparte, por el texto de la oferta y el alimento, y la
// siguiente oferta con el mismo texto ya sale contestada.
export const sql = `
CREATE TABLE deals_match_verdict (
  title_key   TEXT    NOT NULL,
  food_id     TEXT    NOT NULL REFERENCES nutrition_food (id) ON DELETE CASCADE,
  confirmed   INTEGER NOT NULL CHECK (confirmed IN (0, 1)),
  answered_at INTEGER NOT NULL,
  PRIMARY KEY (title_key, food_id)
) STRICT;
`;
