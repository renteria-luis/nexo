// Dos medidas mas para el agua, al lado de la botella.
//
// Spec 1.7 deja anadir recipientes cuando hagan falta, y el 2026-10-03 pidio tres
// botones: 150 ml, 300 ml y la botella de 710.
export const sql = `
INSERT INTO nutrition_container (id, name, volume_ml) VALUES ('glass-150', 'Vaso 150 ml', 150);
INSERT INTO nutrition_container (id, name, volume_ml) VALUES ('glass-300', 'Vaso 300 ml', 300);
`;
