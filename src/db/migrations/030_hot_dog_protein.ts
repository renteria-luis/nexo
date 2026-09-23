// El hot dog de Costco baja a 21 g de proteina.
//
// La ficha publicada dice 23 y aqui manda el dueno, que es quien se lo come: 21 es
// lo que cuenta para sus bandas. El resto de la etiqueta queda como estaba.
export const sql = `
UPDATE nutrition_food SET protein_g = 21 WHERE id = 'costco-hot-dog';
`;
