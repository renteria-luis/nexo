// Row shapes exactly as SQLite returns them. Booleans are stored as INTEGER
// 0 or 1 because SQLite has no boolean type, and the tables are STRICT, so
// nothing else can end up in those columns.

import type { IsoDate } from '../core/dates.ts';

export type SqlBool = 0 | 1;

export type { IsoDate };

/** Milliseconds since the Unix epoch, UTC. */
export type EpochMs = number;

export type EquipmentType = 'machine' | 'barbell' | 'ez_bar' | 'dumbbell' | 'cable' | 'bodyweight';
export type TimeBudget = 'completo' | 'minus_25' | 'minus_50' | 'express';
export type Crowding = 'empty' | 'normal' | 'full';
export type Company = 'alone' | 'with_someone';
export type SleepSource = 'apple_health' | 'autosleep' | 'manual' | 'none';
export type FoodSource = 'user_measured' | 'off' | 'usda' | 'label';
export type UnitKind = 'mass' | 'volume' | 'count';
export type TargetRepMode = 'range' | 'amrap' | 'failure';
export type EquipmentKind =
  'selectorized' | 'plate_loaded' | 'cable' | 'free_weight' | 'bench' | 'rack' | 'cardio';
export type PrimaryUse = 'hypertrophy' | 'strength' | 'endurance' | 'mobility';
export type TrainingLevel = 'beginner' | 'intermediate' | 'advanced';

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

export type CoreNudgeRow = {
  id: string;
  kind: string;
  date: IsoDate;
  sent_at: EpochMs;
  acted_at: EpochMs | null;
};

export type CoreDailyLogRow = {
  date: IsoDate;
  water_ml: number | null;
  creatine_taken: SqlBool | null;
  alcohol_drinks: number | null;
  /** Spec 4.2: drinks taken inside six hours of a session cost half again as much. */
  alcohol_after_training: SqlBool | null;
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
  /** Spec 4.3: el dia estaba planeado como descanso, asi que no fallo ningun entreno. */
  rest_day: SqlBool;
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

export type TrainingEquipmentRow = {
  id: string;
  gym_id: string;
  /** The code stencilled on the frame. */
  model_code: string | null;
  brand: string | null;
  name_es: string;
  name_en: string;
  kind: EquipmentKind;
  /** Smallest real step, in kilograms. */
  load_increment: number | null;
  stack_min_kg: number | null;
  stack_max_kg: number | null;
  primary_use: PrimaryUse | null;
  level: TrainingLevel | null;
  notes_es: string | null;
  /** 0 until he has checked the step at the machine itself. */
  increment_confirmed: SqlBool;
};

export type TrainingExerciseEquipmentRow = {
  exercise_id: string;
  equipment_id: string;
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
  /** The unit he logs in: 'g', 'ml', 'huevo', 'unidad'. Not a label serving. */
  base_unit: string;
  unit_kind: UnitKind;
  /** Grams in one base unit, when the label states it. Needed for the batch maths. */
  base_unit_g: number | null;
  kcal: number;
  protein_g: number;
  /** Null where the source gives no figure; spec 16.3 rule 5 forbids inventing one. */
  carbs_g: number | null;
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
  /** Lo que el escribe para encontrarlo: "egg, costco", separadas por coma. */
  keywords: string | null;
  /** Fuera de las listas sin tocar lo que ya comio. */
  archived: SqlBool;
  /** Las cantidades que salen de boton al anotarlo, o null para las de siempre. */
  quick_amounts: string | null;
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

/** Spec 5.12. One topic and at most one criterion each: see migration 014. */
export type CoreStudyRow = {
  id: string;
  topic: string;
  criterion: string | null;
  spec_section: string;
  title: string;
  authors: string | null;
  year: number | null;
  journal: string | null;
  doi: string | null;
  pmid: string | null;
  open_access_url: string | null;
  summary: string;
  sort_order: number;
};

/** Spec 8.3 rule 8: what this session was planned to be, overrides included. */
export type TrainingSessionPlanRow = {
  session_id: string;
  exercise_id: string;
  position: number;
  sets_planned: number;
  rest_seconds: number;
};

/** Spec 5.11. Null end_date means it is still running. */
export type CoreExperimentRow = {
  id: string;
  name: string;
  hypothesis: string;
  variable_changed: string;
  start_date: IsoDate;
  end_date: IsoDate | null;
  outcome_metric: string;
  notes: string | null;
};

export type CoreExperimentReadingRow = {
  experiment_id: string;
  date: IsoDate;
  value: number;
  note: string | null;
};

/** Spec 16.5. Money is integer cents everywhere in this module. */
export type DealsSourceRow = {
  id: string;
  name: string;
  auth_type: 'none' | 'oauth' | 'email_pin' | 'scrape';
  poll_schedule: string | null;
  last_success_at: EpochMs | null;
  last_error: string | null;
  health: 'ok' | 'degraded' | 'down';
  deep_link_scheme: string | null;
  web_fallback_url: string | null;
};

export type DealsRetailerRow = {
  id: string;
  name: string;
  chain: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  province: string | null;
  city: string | null;
};

export type DealsDealRow = {
  id: string;
  source_id: string;
  retailer_id: string | null;
  title: string;
  description: string | null;
  price_cents: number | null;
  original_price_cents: number | null;
  savings_pct: number | null;
  /** What the price is per, as the source worded it. Null when it did not say. */
  unit: string | null;
  quantity_available: number | null;
  best_before: IsoDate | null;
  valid_from: IsoDate | null;
  valid_to: IsoDate | null;
  category: string | null;
  image_url: string | null;
  source_url: string | null;
  deep_link: string | null;
  fetched_at: EpochMs;
  expires_at: EpochMs | null;
  confidence: 'exact' | 'parsed';
  raw_payload: string | null;
  /** Spec 16.4: one of the few foods where the price is worth reacting to. */
  staple: SqlBool;
};

export type DealsDiscountRow = {
  id: string;
  retailer_id: string | null;
  chain: string | null;
  percent: number;
  /** ISO weekday numbers, 1 is Monday. Empty means every day. */
  days_of_week: string;
  conditions: string | null;
  active: SqlBool;
};
