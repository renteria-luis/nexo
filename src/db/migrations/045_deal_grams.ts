// Lo que pesa una oferta, para poder decir cuanta proteina compra un dolar.
//
// Flipp casi nunca pone el peso en la unidad del precio: de 224 ofertas de un dia
// normal, 113 no traian unidad ninguna y solo dos traian una que el codigo entendia,
// asi que la proteina por dolar salia vacia justo en las ofertas que importan. El peso
// si suele estar escrito en el titulo ("SEASONED CHICKEN BREAST, 4 KG") o en la letra
// chica del articulo ("11.00/kg"), y el recolector ya lo lee; esta columna es donde lo
// guarda.
//
// Y Flipp deja de tener esquema propio: sus enlaces de /action son universales, asi
// que el mismo https abre la app si esta instalada y la web si no, sin preguntarle al
// sistema si la tiene.
export const sql = `
ALTER TABLE deals_deal ADD COLUMN grams INTEGER CHECK (grams IS NULL OR grams > 0);

UPDATE deals_source SET deep_link_scheme = NULL WHERE id = 'flipp';
`;
