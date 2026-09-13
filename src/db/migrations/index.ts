import { sql as core } from './001_core.ts';
import { sql as trainingGymExercise } from './002_training_gym_exercise.ts';
import { sql as trainingRoutine } from './003_training_routine.ts';
import { sql as trainingSession } from './004_training_session.ts';
import { sql as nutritionFood } from './005_nutrition_food.ts';
import { sql as nutritionBatch } from './006_nutrition_batch.ts';

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
];
