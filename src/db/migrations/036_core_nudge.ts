// Lo que se le aviso y si hizo caso.
//
// Sin esto no hay forma de saber que un tipo de aviso lo esta ignorando, y un aviso
// que se ignora tres veces seguidas deja de ser un recordatorio para ser ruido. Con
// la fila se puede callar solo una semana (spec 18).
export const sql = `
CREATE TABLE core_nudge (
  -- tipo y dia, que es lo que lo hace unico: un aviso por tipo y dia.
  id       TEXT    PRIMARY KEY,
  kind     TEXT    NOT NULL,
  date     TEXT    NOT NULL,
  -- Cuando se programo. iOS lo muestra a su hora aunque la app este cerrada.
  sent_at  INTEGER NOT NULL,
  -- Cuando toco uno de sus botones, o null si lo dejo pasar.
  acted_at INTEGER
) STRICT;

CREATE INDEX core_nudge_by_kind ON core_nudge (kind, date);
`;
