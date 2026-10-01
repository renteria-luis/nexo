// El estudio del que sale la curva de la creatina.
//
// Spec 12: lo que la app afirma tiene que poder auditarse, y la grafica del deposito
// afirma dos cosas con numeros: que se llena en veintiocho dias y que se vacia en
// treinta. Las dos son de aqui, asi que el estudio entra en Lecturas como cualquier otro
// y la grafica puede mandar a leerlo.
export const sql = `
INSERT INTO core_study
  (id, topic, criterion, spec_section, title, authors, year, journal, doi, pmid,
   open_access_url, summary, sort_order)
VALUES
  ('hultman-1996', 'creatine', 'creatine', '12.8',
   'Muscle creatine loading in men',
   'Hultman E, Söderlund K, Timmons JA, Cederblad G, Greenhaff PL', 1996,
   'Journal of Applied Physiology 81:232-237', '10.1152/jappl.1996.81.1.232', '8828669', NULL,
   'La carga de 20 g al dia sube la creatina muscular un 20% en seis dias, y 3 g al dia llegan al mismo sitio en veintiocho. Dejandola, a los treinta dias ya no se distingue del punto de partida. De aqui salen los dos extremos de la curva del deposito.',
   2);
`;
