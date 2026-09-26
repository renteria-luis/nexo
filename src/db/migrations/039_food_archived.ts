// Un alimento se puede sacar de la lista sin borrar lo que ya comio.
//
// Borrarlo de verdad solo tiene sentido cuando nunca lo comio: si tiene porciones
// anotadas, la clave foranea lo protege y con razon, porque sacarlo reescribiria los
// totales de esos dias. Archivado desaparece de donde elige y anota, y los dias
// viejos siguen diciendo exactamente lo mismo.
export const sql = `
ALTER TABLE nutrition_food ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
  CHECK (archived IN (0, 1));
`;
