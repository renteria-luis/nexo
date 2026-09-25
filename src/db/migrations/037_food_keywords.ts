// Palabras clave por alimento, para poder buscarlo como lo tenga en la cabeza.
//
// El catalogo esta en espanol y la etiqueta que lee esta en ingles: escribiendo "egg"
// no salia el huevo. Esto es un campo suyo, separado por comas, que se suma al nombre,
// la marca y la tienda a la hora de buscar. Los del catalogo salen sembrados con su
// nombre en ingles y su tienda; lo demas lo pone el.
export const sql = `
ALTER TABLE nutrition_food ADD COLUMN keywords TEXT;

UPDATE nutrition_food SET keywords = 'egg, eggs, huevo, costco' WHERE id = 'eggs-costco-xl';
UPDATE nutrition_food SET keywords = 'egg, eggs, huevo, food basics' WHERE id = 'eggs-large';
UPDATE nutrition_food SET keywords = 'chicken, breast, pollo, costco, kirkland' WHERE id = 'chicken-breast-kirkland';
UPDATE nutrition_food SET keywords = 'chicken, burger, pollo, hamburguesa, food basics' WHERE id = 'chicken-burger';
UPDATE nutrition_food SET keywords = 'hot dog, hotdog, costco, perro' WHERE id = 'costco-hot-dog';
UPDATE nutrition_food SET keywords = 'protein bar, barra, proteina' WHERE id = 'protein-bar-60g';
UPDATE nutrition_food SET keywords = 'starbucks, latte, coffee, cafe, protein' WHERE id = 'starbucks-protein-latte';
UPDATE nutrition_food SET keywords = 'wendys, burger, hamburguesa, jbc, bacon' WHERE id = 'wendys-jbc';
UPDATE nutrition_food SET keywords = 'oats, oatmeal, avena, quaker' WHERE id = 'oats-quaker';
UPDATE nutrition_food SET keywords = 'pasta, catelli, walmart, protein' WHERE id = 'catelli-pasta';
UPDATE nutrition_food SET keywords = 'soup, noodles, sopa, chef woo, walmart' WHERE id = 'chef-woo';
UPDATE nutrition_food SET keywords = 'pizza, bites, bocaditos, walmart' WHERE id = 'pizza-bites';
UPDATE nutrition_food SET keywords = 'milk, leche' WHERE id IN ('milk-1', 'milk-2');
`;
