// Las cantidades que salen como botones al anotar ese alimento.
//
// La lista fija por tipo de unidad no le sirve a todo: de los huevos come 1, 3 o 6, y
// 2, 4 o 5 solo le estorban. Vacio significa la lista de siempre, asi que un alimento
// al que no le ponga nada sigue funcionando igual.
export const sql = `
ALTER TABLE nutrition_food ADD COLUMN quick_amounts TEXT;

UPDATE nutrition_food SET quick_amounts = '1, 2, 3, 6' WHERE id IN ('eggs-large', 'eggs-costco-xl');
`;
