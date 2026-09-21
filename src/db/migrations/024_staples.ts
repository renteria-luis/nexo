// The two foods he buys at Costco.
//
// Chicken is entirely his label: 125 g is 150 kcal, 28 g protein, 3.5 g fat, 0 carbs
// and 55 mg sodium, at $15.49 a kilo.
//
// Eggs are his label for what the label says, which is 14 g of protein per two eggs,
// and $19 for sixty. The label gives no weight, so the grams come from the Canadian
// grading for extra large (64 to 69 g in shell, about 56 g once shelled) and the rest
// of the macros are the Canadian Nutrient File figure for whole raw egg scaled to
// those 56 g. That derivation agrees with his label on protein, 7.0 g against the 7 g
// it prints, which is why it is trusted here and written down rather than hidden.
//
// Beef is missing on purpose: he has not read the package yet, and a made up
// calorie figure is worse than a food that is not in the list.
export const sql = `
INSERT INTO nutrition_food
  (id, name, brand, store, base_unit, unit_kind, base_unit_g, kcal, protein_g, carbs_g,
   sugar_g, fat_g, fibre_g, sodium_mg, source, price_cad_cents, package_size,
   glycemic_index, is_dairy)
VALUES
  ('chicken-breast-kirkland', 'Pechuga de pollo', 'Kirkland', 'Costco', 'g', 'mass', 1,
   150.0/125, 28.0/125, 0, NULL, 3.5/125, NULL, 55.0/125,
   'label', 1549, 1000, NULL, 0),

  ('eggs-costco-xl', 'Huevo extra grande', 'Kirkland', 'Costco', 'huevo', 'count', 56,
   80, 7, 0.4, NULL, 5.3, NULL, 80,
   'label', 1900, 60, NULL, 0);
`;
