export const sql = `
INSERT INTO core_study
  (id, topic, criterion, spec_section, title, authors, year, journal, doi, pmid,
   open_access_url, summary, sort_order)
VALUES
  ('areta-2014', 'energy_availability', 'calories', '12.3b',
   'Reduced resting skeletal muscle protein synthesis is rescued by resistance exercise and protein ingestion following short-term energy deficit',
   'Areta JL et al.', 2014, 'Am J Physiol Endocrinol Metab 306:E989-E997',
   '10.1152/ajpendo.00590.2013', '24595305', NULL,
   'En este experimento, varios dias con menos energia redujeron la sintesis muscular en reposo. El entrenamiento de fuerza y la proteina recuperaron la respuesta. Por eso quedar corto de calorias cuesta puntos de forma gradual, y entrenar sigue contando durante un deficit.',
   2),
  ('murphy-koehler-2022', 'energy_availability', 'calories', '12.3b',
   'Energy deficiency impairs resistance training gains in lean mass but not strength: A meta-analysis and meta-regression',
   'Murphy C, Koehler K', 2022, 'Scand J Med Sci Sports 32:125-137',
   '10.1111/sms.14075', '34623696', NULL,
   'Al reunir ensayos de entrenamiento de fuerza, el deficit energetico redujo la ganancia de masa magra, mientras que las ganancias de fuerza fueron comparables. Respalda que la curva de calorias baje al comer menos de la meta sin convertir cualquier deficit en cero puntos.',
   3);
`;
