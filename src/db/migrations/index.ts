import { sql as core } from './001_core.ts';
import { sql as trainingGymExercise } from './002_training_gym_exercise.ts';
import { sql as trainingRoutine } from './003_training_routine.ts';
import { sql as trainingSession } from './004_training_session.ts';
import { sql as nutritionFood } from './005_nutrition_food.ts';
import { sql as nutritionBatch } from './006_nutrition_batch.ts';
import { sql as seedFood } from './007_seed_food_catalog.ts';
import { sql as seedExercise } from './008_seed_exercise_catalog.ts';
import { sql as coreSetting } from './009_core_setting.ts';
import { sql as alcoholTiming } from './010_daily_log_alcohol_timing.ts';
import { sql as trainingEquipment } from './011_training_equipment.ts';
import { sql as seedFanshawe } from './012_seed_fanshawe.ts';
import { sql as techniqueCues } from './013_technique_cues.ts';
import { sql as coreStudy } from './014_core_study.ts';
import { sql as seedRoutines } from './015_seed_routines.ts';
import { sql as seedStarbucks } from './016_seed_starbucks.ts';
import { sql as coreExperiment } from './017_core_experiment.ts';
import { sql as gymLocations } from './018_gym_locations.ts';

export type Migration = {
  id: string;
  sql: string;
};

// Applied in array order and never edited once shipped. A new table means a new
// entry appended here, not a change to an existing one.
export const migrations: Migration[] = [
  { id: '001_core', sql: core },
  { id: '002_training_gym_exercise', sql: trainingGymExercise },
  { id: '003_training_routine', sql: trainingRoutine },
  { id: '004_training_session', sql: trainingSession },
  { id: '005_nutrition_food', sql: nutritionFood },
  { id: '006_nutrition_batch', sql: nutritionBatch },
  { id: '007_seed_food_catalog', sql: seedFood },
  { id: '008_seed_exercise_catalog', sql: seedExercise },
  { id: '009_core_setting', sql: coreSetting },
  { id: '010_daily_log_alcohol_timing', sql: alcoholTiming },
  { id: '011_training_equipment', sql: trainingEquipment },
  { id: '012_seed_fanshawe', sql: seedFanshawe },
  { id: '013_technique_cues', sql: techniqueCues },
  { id: '014_core_study', sql: coreStudy },
  { id: '015_seed_routines', sql: seedRoutines },
  { id: '016_seed_starbucks', sql: seedStarbucks },
  { id: '017_core_experiment', sql: coreExperiment },
  { id: '018_gym_locations', sql: gymLocations },
];
