// Lo que trae un paquete cuando no se mide en gramos, y la densidad de la leche.
//
// El nombre que publica Flipp se queda corto: "SELECTION LARGE EGGS" sin el "18'S",
// "LACTANTIA PURFILTRE MILK" sin el "4 L". El tamano esta en la letra chica del
// articulo, que el recolector ya lee, pero no habia donde guardarlo si no eran gramos:
// dieciocho huevos no pesan nada que el folleto diga, y cuatro litros tampoco.
//
// Y la leche entra al catalogo en mililitros sin peso por mililitro, asi que ni su
// proteina por dolar ni su precio por kilo podian calcularse. Un mililitro de leche
// pesa 1.03 g (densidad 1.03 kg/L a 4 grados), y con eso las dos cuentas salen.
export const sql = `
ALTER TABLE deals_deal ADD COLUMN pack_ml INTEGER CHECK (pack_ml IS NULL OR pack_ml > 0);
ALTER TABLE deals_deal ADD COLUMN pack_count INTEGER CHECK (pack_count IS NULL OR pack_count > 0);

UPDATE nutrition_food SET base_unit_g = 1.03 WHERE id IN ('milk-1', 'milk-2');
`;
