// Spec 7.4, the standing order. Spec forbids hardcoding an invented protein figure,
// so this one is his: he had it checked at the counter and settled on 40 g, because
// the pour varies by barista. Starbucks publishes 41 g for the venti iced sugar-free
// vanilla protein latte, which is the closest thing to what he orders.
//
// Calories and fat are the published figures for that drink. Carbohydrate is left
// blank rather than guessed: the app already says out loud when a figure is missing.
//
// The order: venti iced latte, protein-boosted milk, quad blonde espresso,
// sugar-free vanilla, no mocha, no white mocha, no drizzle, no crumbles.
export const sql = `
INSERT INTO nutrition_food
  (id, name, brand, store, base_unit, unit_kind, base_unit_g,
   kcal, protein_g, carbs_g, sugar_g, fat_g, source, is_dairy)
VALUES
  ('starbucks-protein-latte', 'Latte proteico venti sin azucar', 'Starbucks', 'Starbucks',
   'unidad', 'count', NULL, 280, 40, NULL, NULL, 6, 'user_measured', 1);
`;
