// Row shapes exactly as SQLite returns them. Booleans are stored as INTEGER
// 0 or 1 because SQLite has no boolean type, and the tables are STRICT, so
// nothing else can end up in those columns.

export type SqlBool = 0 | 1;

/** Local calendar day, 'YYYY-MM-DD'. */
export type IsoDate = string;

/** Milliseconds since the Unix epoch, UTC. */
export type EpochMs = number;

export type EquipmentType = 'machine' | 'barbell' | 'ez_bar' | 'dumbbell' | 'cable' | 'bodyweight';
export type TimeBudget = 'completo' | 'minus_25' | 'minus_50' | 'express';
export type Crowding = 'empty' | 'normal' | 'full';
export type Company = 'alone' | 'with_someone';
export type SleepSource = 'apple_health' | 'autosleep' | 'manual' | 'none';
export type FoodSource = 'user_measured' | 'off' | 'usda' | 'label';
export type TargetRepMode = 'range' | 'amrap' | 'failure';

/** 1.0 for the primary muscle, 0.5 for a secondary one. */
export type MuscleContribution = 1.0 | 0.5;

export type CoreMigrationRow = {
  id: string;
  applied_at: EpochMs;
};

export type CoreTargetSnapshotRow = {
  id: string;
  effective_from: IsoDate;
  weight_basis_kg: number;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  water_ml_rest: number;
  water_ml_training: number;
  sleep_minutes: number;
  steps: number;
};

export type CoreDailyLogRow = {
  date: IsoDate;
  water_ml: number | null;
  creatine_taken: SqlBool | null;
  alcohol_drinks: number | null;
  cannabis: SqlBool | null;
  sleep_minutes: number | null;
  sleep_source: SleepSource | null;
  resting_hr: number | null;
  hrv_ms: number | null;
  steps: number | null;
  weight_kg: number | null;
  /** Null when fewer than three criteria have data (spec 6.6). */
  score: number | null;
  has_data: SqlBool;
};

export type TrainingGymRow = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  geofence_radius_m: number;
};

export type TrainingExerciseRow = {
  id: string;
  name_es: string;
  name_en: string;
  primary_muscle: string;
  equipment_type: EquipmentType;
  load_increment: number;
  default_rest_seconds: number;
  unilateral: SqlBool;
  technique_text: string | null;
  technique_clip_ref: string | null;
};

export type TrainingExerciseMuscleRow = {
  exercise_id: string;
  muscle: string;
  contribution: MuscleContribution;
};

export type TrainingExerciseGymRow = {
  exercise_id: string;
  gym_id: string;
};

export type TrainingRoutineRow = {
  id: string;
  name: string;
};

export type TrainingRoutineExerciseRow = {
  id: string;
  routine_id: string;
  exercise_id: string;
  position: number;
  tier: 1 | 2 | 3 | 4;
  sets_full: number;
  /** Null means the exercise is dropped at that budget. */
  sets_minus_25: number | null;
  sets_minus_50: number | null;
  sets_express: number | null;
  target_rep_mode: TargetRepMode;
  target_rep_min: number | null;
  target_rep_max: number | null;
};

export type TrainingSessionRow = {
  id: string;
  date: IsoDate;
  start_time: EpochMs | null;
  end_time: EpochMs | null;
  gym_id: string | null;
  routine_id: string | null;
  alone_or_partner: Company | null;
  time_budget: TimeBudget;
  /** Always null on a retroactive session (spec 5.4). */
  crowding: Crowding | null;
  is_retroactive: SqlBool;
  notes: string | null;
};

export type TrainingSetEntryRow = {
  id: string;
  session_id: string;
  exercise_id: string;
  set_index: number;
  weight_kg: number;
  reps: number;
  rest_before_seconds: number | null;
  timestamp: EpochMs;
  rpe: number | null;
  is_warmup: SqlBool;
};

export type NutritionFoodRow = {
  id: string;
  name: string;
  brand: string | null;
  store: string | null;
  base_unit: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  sugar_g: number | null;
  fat_g: number;
  fibre_g: number | null;
  sodium_mg: number | null;
  barcode: string | null;
  source: FoodSource;
  /** Integer cents, never a float. */
  price_cad_cents: number | null;
  package_size: number | null;
  glycemic_index: number | null;
  is_dairy: SqlBool;
};

export type NutritionContainerRow = {
  id: string;
  name: string;
  volume_ml: number;
};

export type NutritionBatchRow = {
  id: string;
  food_id: string;
  raw_weight_g: number;
  cooked_weight_g: number | null;
  portions_count: number;
  cooked_date: IsoDate;
  portions_remaining: number;
  fat_drained: SqlBool;
};

export type NutritionFoodEntryRow = {
  id: string;
  food_id: string;
  quantity: number;
  unit: string;
  timestamp: EpochMs;
  date: IsoDate;
  meal_slot: string;
  batch_id: string | null;
};
