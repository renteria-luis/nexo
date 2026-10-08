export const sql = `
ALTER TABLE training_exercise ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));
ALTER TABLE training_exercise ADD COLUMN family_name TEXT;
ALTER TABLE training_exercise ADD COLUMN catalog_source TEXT NOT NULL DEFAULT 'seed' CHECK (catalog_source IN ('seed', 'user'));
ALTER TABLE training_exercise ADD COLUMN edited_at INTEGER;
ALTER TABLE training_exercise_variant ADD COLUMN auto_select INTEGER NOT NULL DEFAULT 1 CHECK (auto_select IN (0, 1));

CREATE UNIQUE INDEX training_variant_parent ON training_exercise_variant (exercise_id);

UPDATE training_exercise SET family_name = name_es
 WHERE implements <> '' OR id IN (SELECT base_exercise_id FROM training_exercise_variant);

-- Preserve existing variant IDs and every historical set. Convert remaining equipment choices to concrete exercises.
CREATE TEMP TABLE catalog_variants AS
SELECT e.id AS base_id, e.id || '-variant-' || o.equipment AS variant_id, o.equipment
  FROM training_exercise e
 CROSS JOIN (SELECT 'dumbbell' AS equipment UNION ALL SELECT 'cable' UNION ALL SELECT 'machine') o
 WHERE instr(',' || e.implements || ',', ',' || o.equipment || ',') > 0
   AND o.equipment <> e.equipment_type
   AND NOT EXISTS (
     SELECT 1 FROM training_exercise_variant v JOIN training_exercise x ON x.id = v.exercise_id
      WHERE v.base_exercise_id = e.id AND x.equipment_type = o.equipment
   );

INSERT INTO training_exercise
 (id, name_es, name_en, primary_muscle, equipment_type, load_increment, default_rest_seconds, unilateral)
SELECT v.variant_id, e.name_es || ' · ' || CASE v.equipment
 WHEN 'dumbbell' THEN 'mancuernas' WHEN 'cable' THEN 'polea' ELSE 'máquina' END,
 e.name_en, e.primary_muscle, v.equipment, e.load_increment, e.default_rest_seconds, e.unilateral
 FROM catalog_variants v JOIN training_exercise e ON e.id = v.base_id;

INSERT INTO training_exercise_variant (base_exercise_id, exercise_id, rank, auto_select)
SELECT v.base_id, v.variant_id, 100 + row_number() OVER (PARTITION BY v.base_id ORDER BY v.equipment), 0
 FROM catalog_variants v;

INSERT INTO training_exercise_muscle (exercise_id, muscle, contribution)
SELECT v.variant_id, m.muscle, m.contribution FROM catalog_variants v
 JOIN training_exercise_muscle m ON m.exercise_id = v.base_id;
INSERT INTO training_exercise_gym (exercise_id, gym_id)
SELECT v.variant_id, g.gym_id FROM catalog_variants v
 JOIN training_exercise_gym g ON g.exercise_id = v.base_id;
INSERT INTO training_exercise_note (exercise_id, implement, note)
SELECT v.variant_id, '', coalesce(
 (SELECT note FROM training_exercise_note WHERE exercise_id = v.base_id AND implement = v.equipment),
 (SELECT note FROM training_exercise_note WHERE exercise_id = v.base_id AND implement = '')
) FROM catalog_variants v WHERE EXISTS (
 SELECT 1 FROM training_exercise_note WHERE exercise_id = v.base_id AND implement IN ('', v.equipment)
);

UPDATE training_exercise SET implements = '';
INSERT INTO training_exercise_note (exercise_id, implement, note)
SELECT v.exercise_id, n.implement, n.note
 FROM training_exercise_variant v JOIN training_exercise e ON e.id = v.exercise_id
 JOIN training_exercise_note n ON n.exercise_id = v.base_exercise_id AND n.implement = e.equipment_type
 WHERE 1 ON CONFLICT (exercise_id, implement) DO NOTHING;
DROP TABLE catalog_variants;
`;
