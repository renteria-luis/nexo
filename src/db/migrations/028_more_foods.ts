// La barra de proteina es su etiqueta: 60 g con 240 kcal, 21 g de proteina, 22 g de
// carbohidrato, 9 g de grasa y 135 mg de sodio. La marca no entra, porque lo que
// registra es lo que come, no quien se lo vendio.
//
// El hot dog del food court de Costco no es suyo de leer, asi que sale de la ficha
// que Costco publica para ese producto: 580 kcal, 23 g de proteina, 42 g de
// carbohidrato (7 de azucar), 34.5 g de grasa y 1620 mg de sodio, el pan incluido.
// El precio es el del combo de 1.50, que trae la gaseosa aparte y no esta contada
// aqui: si se la toma, esa bebida se registra por su cuenta.
export const sql = `
INSERT INTO nutrition_food
  (id, name, brand, store, base_unit, unit_kind, base_unit_g, kcal, protein_g, carbs_g,
   sugar_g, fat_g, fibre_g, sodium_mg, source, price_cad_cents, package_size,
   glycemic_index, is_dairy)
VALUES
  ('protein-bar-60g', 'Barra de proteina', NULL, NULL, 'unidad', 'count', 60,
   240, 21, 22, NULL, 9, NULL, 135,
   'label', NULL, NULL, NULL, 0),

  ('costco-hot-dog', 'Hot dog de Costco con pan', NULL, 'Costco', 'unidad', 'count', NULL,
   580, 23, 42, 7, 34.5, 1, 1620,
   'label', 150, 1, NULL, 0);
`;
