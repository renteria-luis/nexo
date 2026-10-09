// Lo que llega de Salud y de AutoSleep por el Atajo de iOS, con de donde vino y cuando.
//
// El dia sigue guardando su sueno y sus pasos en core_daily_log, que es lo que se puntua.
// Esta tabla es el comprobante: el ultimo valor que mando cada fuente para ese dia y la
// hora en que llego. Si lo que tiene el dia es justo eso, el dato vino de la importacion;
// si es otra cosa, lo escribio el a mano y no se pisa sin preguntarle.
//
// Una fila por dia, dato y fuente: volver a importar la reemplaza, nunca se suma.
export const sql = `
CREATE TABLE core_health_import (
  date        TEXT    NOT NULL,
  metric      TEXT    NOT NULL CHECK (metric IN ('sleep', 'steps')),
  source      TEXT    NOT NULL CHECK (source IN ('autosleep', 'apple_health')),
  value       INTEGER NOT NULL CHECK (value > 0),
  started_at  INTEGER,
  ended_at    INTEGER,
  imported_at INTEGER NOT NULL,
  PRIMARY KEY (date, metric, source)
);
`;
