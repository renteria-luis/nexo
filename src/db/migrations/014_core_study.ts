// Spec 12: every grid criterion links to the studies that set its weight, so the
// scoring can be audited instead of trusted. Spec 5.12 is the shape.
//
// topic_tags and linked_criteria are single columns rather than lists: in the whole
// of spec 12 no study sits under two topics or backs two criteria, and a join table
// for one user would be ceremony. criterion is null where the evidence shapes a
// target or a decision rather than a scored criterion.
//
// No paywalled PDFs are bundled (spec 12). The open access link is built from the
// PMC id the spec gives, never invented.
export const sql = `
CREATE TABLE core_study (
  id              TEXT PRIMARY KEY,
  topic           TEXT NOT NULL,
  criterion       TEXT
    CHECK (criterion IS NULL OR criterion IN
      ('trained', 'sleep', 'protein', 'calories', 'alcohol', 'water', 'steps', 'creatine')),
  spec_section    TEXT NOT NULL,
  title           TEXT NOT NULL,
  authors         TEXT,
  year            INTEGER,
  journal         TEXT,
  doi             TEXT,
  pmid            TEXT,
  open_access_url TEXT,
  summary         TEXT NOT NULL,
  sort_order      INTEGER NOT NULL
) STRICT;

INSERT INTO core_study
  (id, topic, criterion, spec_section, title, authors, year, journal, doi, pmid, open_access_url, summary, sort_order)
VALUES
  ('lamon-2021', 'sleep', 'sleep', '12.1',
   'The effect of acute sleep deprivation on skeletal muscle protein synthesis and the hormonal environment',
   'Lamon S et al.', 2021, 'Physiological Reports', NULL, NULL,
   'https://pmc.ncbi.nlm.nih.gov/articles/PMC7785053/',
   'Una noche sin dormir: sintesis de proteina muscular -18%, cortisol +21%, testosterona -24%.', 1),

  ('leproult-2011', 'sleep', 'sleep', '12.1',
   'Effect of 1 week of sleep restriction on testosterone levels in young healthy men',
   'Leproult R, Van Cauter E', 2011, 'JAMA 305:2173-2174', NULL, NULL, NULL,
   'Ocho noches de 5 horas: testosterona diurna -10 a -15%, con menos animo y vigor.', 2),

  ('nedeltcheva-2010', 'sleep', 'sleep', '12.1',
   'Insufficient sleep undermines dietary efforts to reduce adiposity',
   'Nedeltcheva AV et al.', 2010, 'Ann Intern Med 153:435-441', NULL, NULL, NULL,
   'En deficit, 5.5 h contra 8.5 h de sueno: 60% mas masa magra perdida y 55% menos grasa perdida.', 3),

  ('saner-2020', 'sleep', 'sleep', '12.1',
   'The effect of sleep restriction, with or without high-intensity interval exercise, on myofibrillar protein synthesis',
   'Saner NJ et al.', 2020, 'J Physiol', NULL, NULL,
   'https://pmc.ncbi.nlm.nih.gov/articles/PMC7217042/',
   'Cinco noches de 4 horas bajaron la sintesis muscular, pero entrenar durante esa racha la mantuvo en niveles normales. Entrenar protege parcialmente una mala racha de sueno.', 4),

  ('parr-2014', 'alcohol', 'alcohol', '12.2',
   'Alcohol ingestion impairs maximal post-exercise rates of myofibrillar protein synthesis',
   'Parr EB et al.', 2014, 'PLoS ONE 9(2):e88384', NULL, NULL,
   'https://pmc.ncbi.nlm.nih.gov/articles/PMC3922864/',
   '1.5 g/kg, unos 12 tragos: sintesis de proteina -24% junto con proteina y -37% junto con carbohidrato.', 1),

  ('alcohol-review-2023', 'alcohol', 'alcohol', '12.2',
   'Effects of Alcohol Consumption Following Resistance Exercise', 'Revision sistematica', 2023, NULL, NULL, NULL, NULL,
   'Las caidas de fuerza y de marcadores anabolicos van con la dosis. La respuesta de testosterona varia mucho entre personas.', 2),

  ('cecchini-2024', 'alcohol', 'alcohol', '12.2',
   'Alcohol Intake and Risk of Hypertension', 'Cecchini M et al.', 2024, 'Hypertension', NULL, NULL,
   'https://pmc.ncbi.nlm.nih.gov/articles/PMC11251509/',
   'El riesgo de hipertension sube casi en linea recta y ya pesa arriba de unos 12 g al dia.', 3),

  ('morton-2018', 'protein', 'protein', '12.3',
   'A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains',
   'Morton RW et al.', 2018, 'Br J Sports Med', NULL, '28698222', NULL,
   '49 estudios y 1863 participantes: la ganancia de masa magra deja de subir en 1.62 g/kg al dia. Es de donde sale tu meta de proteina.', 1),

  ('whittaker-2021', 'fat_testosterone', NULL, '12.4',
   'Low-fat diets and testosterone in men: systematic review and meta-analysis of intervention studies',
   'Whittaker J, Wu K', 2021, 'J Steroid Biochem Mol Biol', NULL, NULL, NULL,
   'Pasar de 40% a 20% de la energia como grasa bajo la testosterona total 10 a 15%. Es la base de la banda de 25 a 33% de grasa y del piso de 0.8 g/kg.', 1),

  ('pelland-2026', 'volume', 'trained', '12.5',
   'Resistance training volume and hypertrophy', 'Pelland JC et al.', 2026, 'Sports Med 56(2):481-505', NULL, '41343037', NULL,
   '67 estudios y 2058 participantes: mas volumen da mas ganancia, pero con rendimientos decrecientes claros.', 1),

  ('schoenfeld-2017', 'volume', 'trained', '12.5',
   'Dose-response relationship between weekly resistance training volume and increases in muscle mass',
   'Schoenfeld BJ, Ogborn D, Krieger JW', 2017, 'J Sports Sci', NULL, '27433992', NULL,
   'Cada serie semanal extra suma 0.37% de ganancia. De aqui sale la banda de 10 a 20 series por musculo por semana.', 2),

  ('schoenfeld-2016', 'rest', NULL, '12.6',
   'Longer interset rest periods enhance muscle strength and hypertrophy in resistance-trained men',
   'Schoenfeld BJ et al.', 2016, 'J Strength Cond Res', NULL, NULL, NULL,
   '21 hombres entrenados, 8 semanas: 3 minutos de descanso ganaron mas fuerza y mas grosor de cuadriceps que 1 minuto.', 1),

  ('spot-review-2021', 'spot_reduction', NULL, '12.7',
   'Effect of localised resistance training on localised fat', 'Revision sistematica y metaanalisis', 2021, NULL, NULL, NULL, NULL,
   '13 estudios y mas de 1100 participantes: entrenar una zona no baja la grasa de esa zona. No se puede elegir donde adelgazar.', 1),

  ('vispute-2011', 'spot_reduction', NULL, '12.7',
   'The effect of abdominal exercise on abdominal fat', 'Vispute SS et al.', 2011, 'J Strength Cond Res 25(9):2559-2564', NULL, NULL, NULL,
   'Seis semanas de abdominales no cambiaron la grasa abdominal.', 2),

  ('issn-creatine', 'creatine', 'creatine', '12.8',
   'ISSN position stand: safety and efficacy of creatine supplementation', 'International Society of Sports Nutrition', NULL, NULL, NULL, NULL, NULL,
   '3 a 5 g al dia saturan el musculo en 3 o 4 semanas sin fase de carga. Si dejas de tomarla, el lavado tarda de 4 a 8 semanas.', 1),

  ('jaad-2022', 'skin', NULL, '12.9',
   'Diet and acne: a systematic review', NULL, 2022, 'JAAD International', NULL, NULL, NULL,
   '34 articulos. Evidencia convincente de que una dieta de indice glucemico bajo reduce el acne; la de lacteos es mixta.', 1),

  ('acne-patterns-2025', 'skin', NULL, '12.9',
   'Dietary patterns and acne vulgaris: systematic review', NULL, 2025, NULL, NULL, NULL, NULL,
   '26 estudios entre 2010 y 2025: carga glucemica alta, lacteos y proteina de suero asociados con acne. La via seria insulina e IGF-1.', 2),

  ('eadv-2024', 'skin', NULL, '12.9',
   'Dietary guidance review', 'EADV', 2024, NULL, NULL, NULL, NULL,
   'Para balancear: los estudios de lacteos se apoyan en recuerdos y tienen sesgo. Un ensayo doble ciego de seis meses con suero no dio el resultado esperado.', 3),

  ('iom-2005', 'hydration', 'water', '12.10',
   'Dietary Reference Intakes for Water, Potassium, Sodium, Chloride and Sulfate', 'Institute of Medicine', 2005, NULL, NULL, NULL, NULL,
   'Agua total adecuada de 3.7 L al dia para hombres de 19 a 50 anos, y cerca del 20% viene de la comida. Las cifras no aplican a deportistas.', 1),

  ('efsa-2010', 'hydration', 'water', '12.10',
   'Scientific opinion on dietary reference values for water', 'EFSA', 2010, NULL, NULL, NULL, NULL,
   '2.5 L al dia solo de bebidas para hombres. Activo se suele necesitar de 3 a 4 L.', 2),

  ('galmiche-2026', 'cannabis', NULL, '12.11',
   'Cannabis consumption is associated with altered steroid metabolism in young men',
   'Galmiche M et al.', 2026, 'Communications Medicine', NULL, NULL, NULL,
   'No bajo la testosterona; la sintesis testicular parecio unos 23% mas alta. Implicaciones clinicas poco claras. Por eso se registra pero no se puntua.', 1),

  ('cannabis-sleep-2026', 'cannabis', NULL, '12.11',
   'Chronic cannabis use and sleep architecture', NULL, 2026, 'SLEEP 49(5)', NULL, NULL,
   'https://pmc.ncbi.nlm.nih.gov/articles/PMC13163167/',
   '1449 pacientes de clinica del sueno: el uso diario por un ano o mas se asocia a mas vigilia nocturna. Tu patron esta muy por debajo de esa exposicion.', 2),

  ('lally-2010', 'habit', 'trained', '12.12',
   'How are habits formed: modelling habit formation in the real world',
   'Lally P, van Jaarsveld CHM, Potts HWW, Wardle J', 2010, 'Eur J Soc Psychol', NULL, NULL, NULL,
   '96 voluntarios, 12 semanas: mediana de 66 dias hasta que la conducta se vuelve automatica, rango de 18 a 254. Saltarse una sola vez no afecto el habito, y por eso el castigo por faltar es progresivo y no inmediato.', 1);
`;
