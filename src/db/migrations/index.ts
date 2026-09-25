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
import { sql as seedFit4Less } from './019_seed_fit4less.ts';
import { sql as fit4lessBasics } from './020_fit4less_basics.ts';
import { sql as matrixPulleyStack } from './021_matrix_pulley_stack.ts';
import { sql as deals } from './022_deals.ts';
import { sql as exerciseNames } from './023_exercise_names.ts';
import { sql as staples } from './024_staples.ts';
import { sql as dealLinks } from './025_deal_links.ts';
import { sql as restDay } from './026_rest_day.ts';
import { sql as lateralRaise } from './027_lateral_raise.ts';
import { sql as moreFoods } from './028_more_foods.ts';
import { sql as lateralRaiseCable } from './029_lateral_raise_cable.ts';
import { sql as hotDogProtein } from './030_hot_dog_protein.ts';
import { sql as setImplement } from './031_set_implement.ts';
import { sql as dropPreacher } from './032_drop_preacher_from_pull.ts';
import { sql as shouldersAndForearms } from './033_shoulders_and_forearms.ts';
import { sql as absoluteScore } from './034_absolute_score.ts';
import { sql as curveScores } from './035_curve_scores.ts';

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
  { id: '019_seed_fit4less', sql: seedFit4Less },
  { id: '020_fit4less_basics', sql: fit4lessBasics },
  { id: '021_matrix_pulley_stack', sql: matrixPulleyStack },
  { id: '022_deals', sql: deals },
  { id: '023_exercise_names', sql: exerciseNames },
  { id: '024_staples', sql: staples },
  { id: '025_deal_links', sql: dealLinks },
  { id: '026_rest_day', sql: restDay },
  { id: '027_lateral_raise', sql: lateralRaise },
  { id: '028_more_foods', sql: moreFoods },
  { id: '029_lateral_raise_cable', sql: lateralRaiseCable },
  { id: '030_hot_dog_protein', sql: hotDogProtein },
  { id: '031_set_implement', sql: setImplement },
  { id: '032_drop_preacher_from_pull', sql: dropPreacher },
  { id: '033_shoulders_and_forearms', sql: shouldersAndForearms },
  { id: '034_absolute_score', sql: absoluteScore },
  { id: '035_curve_scores', sql: curveScores },
];
