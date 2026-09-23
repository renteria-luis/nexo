// Spec 4.3 ya distingue un dia de descanso planeado de uno perdido: el planeado se
// puntua en todo lo demas y no castiga nada. Lo que faltaba era donde decirlo, asi
// que hasta ahora la app asumia que ningun dia era de descanso y cualquier dia sin
// entreno contaba como fallado.
export const sql = `
ALTER TABLE core_daily_log ADD COLUMN rest_day INTEGER NOT NULL DEFAULT 0
  CHECK (rest_day IN (0, 1));
`;
