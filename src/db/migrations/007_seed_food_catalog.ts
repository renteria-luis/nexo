// The owner-verified catalog from spec 7.1. The figures are his and are never
// overwritten, but they are stored per unit he actually logs in rather than per
// label serving: per gram, per millilitre, per egg. The divisions are written out
// so each number traces back to the row in spec 7.1 it came from.
//
// Blank cells stay NULL. Spec 16.3 rule 5 forbids inferring a missing number, so
// oats and the Jr. Bacon Cheeseburger carry no carbohydrate figure at all.
//
// price_cad_cents is one package and package_size is how many base_units it holds,
// so price per unit is derivable.

export const sql = `
INSERT INTO nutrition_food
  (id, name, brand, store, base_unit, unit_kind, base_unit_g, kcal, protein_g, carbs_g,
   sugar_g, fat_g, fibre_g, sodium_mg, source, price_cad_cents, package_size,
   glycemic_index, is_dairy)
VALUES
  -- Spec 7.1: 250 ml is 100 kcal, 9 g protein, 2.5 g fat, 12 g carbs, 12 g sugar, 90 mg sodium.
  ('milk-1', 'Leche 1%', NULL, NULL, 'ml', 'volume', NULL,
   100.0/250, 9.0/250, 12.0/250, 12.0/250, 2.5/250, NULL, 90.0/250,
   'user_measured', 719, 4000, NULL, 1),

  ('milk-2', 'Leche 2%', NULL, NULL, 'ml', 'volume', NULL,
   130.0/250, 9.0/250, 12.0/250, 12.0/250, 5.0/250, NULL, 90.0/250,
   'user_measured', NULL, NULL, NULL, 1),

  -- Spec 7.1: 40 g is 150 kcal, 5 g protein, 3 g fat. Carbohydrate is blank there.
  ('oats-quaker', 'Avena instantanea Quaker', 'Quaker', NULL, 'g', 'mass', 1,
   150.0/40, 5.0/40, NULL, NULL, 3.0/40, NULL, 0,
   'user_measured', NULL, NULL, NULL, 0),

  -- Spec 7.1 lists two eggs at 105 g. Stored per egg so five of them is five.
  ('eggs-large', 'Huevo grande', 'Selection', 'Food Basics', 'huevo', 'count', 105.0/2,
   160.0/2, 13.0/2, 1.0/2, NULL, 11.0/2, NULL, 130.0/2,
   'user_measured', 959, 30, NULL, 0),

  ('chicken-burger', 'Hamburguesa de pollo cruda', 'Lifesmart', 'Food Basics', 'unidad', 'count', 142,
   200, 28, 1, NULL, 9, NULL, 270,
   'user_measured', 999, 6, NULL, 0),

  ('chef-woo', 'Sopa instantanea vegetal', 'Chef Woo', 'Walmart', 'vaso', 'count', 71,
   320, 20, 26, 3, 14, NULL, 1130,
   'user_measured', 198, 1, NULL, 0),

  -- Spec 7.1: 85 g dry is about 250 kcal, 17 g protein, 58 g carbs, 2 g sugar, 2 g fat.
  ('catelli-pasta', 'Pasta alta en proteina', 'Catelli', 'Walmart', 'g', 'mass', 1,
   250.0/85, 17.0/85, 58.0/85, 2.0/85, 2.0/85, NULL, 4.0/85,
   'user_measured', 397, 340, NULL, 0),

  -- Spec 7.1 lists six bites at 85 g. Stored per bite.
  ('pizza-bites', 'Bocadito de pizza', 'Great Value', 'Walmart', 'unidad', 'count', 85.0/6,
   200.0/6, 7.0/6, 25.0/6, NULL, 8.0/6, NULL, 480.0/6,
   'user_measured', NULL, NULL, NULL, 1),

  ('wendys-jbc', 'Jr. Bacon Cheeseburger', 'Wendys', 'Wendys', 'unidad', 'count', NULL,
   370, 19, NULL, 5, 22, NULL, 680,
   'user_measured', NULL, NULL, NULL, 1);
`;
