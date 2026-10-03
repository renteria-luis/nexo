// A que hora sale cada aviso que se programo.
//
// Spec 18.2 regla 4 calla un tipo de aviso ignorado tres veces seguidas, y se contaba como
// ignorado todo lo que se habia planeado: lo que nunca llego a salir porque ya lo habia
// anotado, y lo de los dias por delante. Con la hora a la que sale, un aviso que se cancela
// antes de esa hora se borra (no lo vio) y uno que salio y despues anoto lo que pedia
// cuenta como que hizo caso.
//
// Las filas de antes se quedan sin hora y no cuentan como ignoradas: no hay forma de saber
// cuales llegaron a salir.
export const sql = `
ALTER TABLE core_nudge ADD COLUMN fires_at INTEGER;
`;
