// Dos cosas que faltaban en el modulo de ofertas.
//
// La marca de "lo que si me importa": huevos, pollo y carne. La lista de busquedas
// ya decia cuales son, pero la tabla no lo guardaba y la pantalla no podia ponerlos
// arriba.
//
// Y el enlace a la app. El boton dice Flipp, asi que deberia caer en Flipp; iOS solo
// contesta si un esquema abre cuando la app declara que puede preguntar, que es la
// entrada LSApplicationQueriesSchemes en app.json. Si Flipp no esta instalado, la
// pantalla lo dice y abre la web.
export const sql = `
ALTER TABLE deals_deal ADD COLUMN staple INTEGER NOT NULL DEFAULT 0 CHECK (staple IN (0, 1));

UPDATE deals_source SET deep_link_scheme = 'flipp://' WHERE id = 'flipp';
`;
