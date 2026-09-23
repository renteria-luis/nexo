import type { SQLiteDatabase } from 'expo-sqlite';

import type { DateRange } from '../core/dates.ts';
import type { GymLocation } from '../core/geo.ts';
import type { TrainingEquipmentRow, TrainingExerciseRow, TrainingGymRow } from '../db/types.ts';

import type { ExerciseMuscles, LoggedSet, MuscleShare } from './calculations.ts';

type LoggedSetRow = {
  session_id: string;
  date: string;
  exercise_id: string;
  set_index: number;
  weight_kg: number;
  reps: number;
  rest_before_seconds: number | null;
  timestamp: number;
  rpe: number | null;
  equipment_type: string;
  equipment_kind: string | null;
  body_weight_kg: number | null;
};

// Una mancuerna se escribe por mancuerna pero se levantan dos. En maquina, polea o
// barra el peso escrito ya es el total, asi que el gimnasio de esa sesion decide:
// si ahi el ejercicio sale en una maquina, no se dobla nada.
const MACHINE_KINDS = ['selectorized', 'plate_loaded', 'cable'];

/** Si el peso escrito es el de una mano, o ya es todo lo que se movio. */
export function isPerSide(equipmentType: string, equipmentKind: string | null): boolean {
  if (equipmentType !== 'dumbbell') return false;
  return equipmentKind === null || !MACHINE_KINDS.includes(equipmentKind);
}

function loadFactor(row: LoggedSetRow): number {
  return isPerSide(row.equipment_type, row.equipment_kind) ? 2 : 1;
}

/**
 * El ultimo peso corporal conocido a esa fecha, que es lo que hay que sumarle a una
 * dominada. Se busca hacia atras a proposito: no se pesa todos los dias, y el peso
 * de la semana pasada describe mejor el de hoy que un cero.
 */
const BODY_WEIGHT_AS_OF = `(SELECT l.weight_kg
       FROM core_daily_log l
      WHERE l.date <= e.date AND l.weight_kg IS NOT NULL
   ORDER BY l.date DESC
      LIMIT 1)`;

/**
 * Working sets in a date range, warmups excluded per spec 5.5. Retroactive
 * sessions are included: spec 5.4 excludes them from crowding statistics only.
 */
export async function listWorkingSets(
  db: SQLiteDatabase,
  range: DateRange,
  exerciseId?: string,
): Promise<LoggedSet[]> {
  const rows = await db.getAllAsync<LoggedSetRow>(
    `SELECT s.session_id, e.date, s.exercise_id, s.set_index, s.weight_kg, s.reps,
            s.rest_before_seconds, s.timestamp, s.rpe, x.equipment_type,
            CASE WHEN x.equipment_type = 'bodyweight'
                 THEN ${BODY_WEIGHT_AS_OF} END AS body_weight_kg,
            -- Escalar y no un JOIN: un ejercicio con dos maquinas en el mismo
            -- gimnasio duplicaria la serie y con ella el volumen.
            (SELECT max(q.kind)
               FROM training_exercise_equipment xe
               JOIN training_equipment q ON q.id = xe.equipment_id
              WHERE xe.exercise_id = s.exercise_id AND q.gym_id = e.gym_id) AS equipment_kind
       FROM training_set_entry s
       JOIN training_session e ON e.id = s.session_id
       JOIN training_exercise x ON x.id = s.exercise_id
      WHERE s.is_warmup = 0
        AND e.date BETWEEN ? AND ?
        AND (? IS NULL OR s.exercise_id = ?)
   ORDER BY e.date, s.session_id, s.set_index;`,
    [range.from, range.to, exerciseId ?? null, exerciseId ?? null],
  );

  return rows.map((row) => ({
    sessionId: row.session_id,
    date: row.date,
    exerciseId: row.exercise_id,
    setIndex: row.set_index,
    weightKg: row.weight_kg,
    reps: row.reps,
    restBeforeSeconds: row.rest_before_seconds,
    timestamp: row.timestamp,
    rpe: row.rpe,
    loadFactor: loadFactor(row),
    bodyWeightKg: row.body_weight_kg,
  }));
}

export async function loadExerciseMuscles(db: SQLiteDatabase): Promise<ExerciseMuscles> {
  const rows = await db.getAllAsync<MuscleShare & { exercise_id: string }>(
    `SELECT exercise_id, muscle, contribution FROM training_exercise_muscle
      ORDER BY contribution DESC, muscle;`,
  );

  const byExercise = new Map<string, MuscleShare[]>();
  for (const row of rows) {
    const share = { muscle: row.muscle, contribution: row.contribution };
    const existing = byExercise.get(row.exercise_id);
    if (existing) existing.push(share);
    else byExercise.set(row.exercise_id, [share]);
  }
  return byExercise;
}

export type CatalogExercise = TrainingExerciseRow & {
  /** Primary muscle first, then secondaries alphabetically. */
  muscles: MuscleShare[];
  /** The machine it is performed on at this gym, when it is performed on one. */
  equipment: TrainingEquipmentRow | null;
  /**
   * The step the weight actually moves in, in kilograms. Spec 5.1 wants the real
   * smallest step for this equipment at this gym, so the machine's value wins over
   * the generic one on the exercise.
   */
  stepKg: number;
};

/** Spec 5.2: the gyms he trains at, with whatever coordinates they have. */
export async function listGyms(db: SQLiteDatabase): Promise<GymLocation[]> {
  const rows = await db.getAllAsync<TrainingGymRow>('SELECT * FROM training_gym ORDER BY name;');
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    radiusM: row.geofence_radius_m,
  }));
}

export async function listEquipment(
  db: SQLiteDatabase,
  gymId: string,
): Promise<TrainingEquipmentRow[]> {
  return db.getAllAsync<TrainingEquipmentRow>(
    `SELECT * FROM training_equipment WHERE gym_id = ?
      ORDER BY kind, name_es;`,
    [gymId],
  );
}

export async function listExercises(
  db: SQLiteDatabase,
  gymId?: string,
): Promise<CatalogExercise[]> {
  const [exercises, muscles, links] = await Promise.all([
    db.getAllAsync<TrainingExerciseRow>('SELECT * FROM training_exercise ORDER BY name_es;'),
    loadExerciseMuscles(db),
    gymId
      ? db.getAllAsync<TrainingEquipmentRow & { exercise_id: string }>(
          `SELECT xe.exercise_id, e.*
             FROM training_exercise_equipment xe
             JOIN training_equipment e ON e.id = xe.equipment_id
            WHERE e.gym_id = ?;`,
          [gymId],
        )
      : Promise.resolve([]),
  ]);

  const byExercise = new Map(links.map(({ exercise_id, ...row }) => [exercise_id, row]));

  return exercises.map((exercise) => {
    const found = muscles.get(exercise.id);
    // An exercise with no muscles would drop out of every volume count without
    // anything looking wrong, so it is an error rather than an empty list.
    if (!found) throw new Error(`exercise ${exercise.id} has no muscles recorded`);

    const equipment = byExercise.get(exercise.id) ?? null;
    return {
      ...exercise,
      muscles: [...found],
      equipment,
      stepKg: equipment?.load_increment ?? exercise.load_increment,
    };
  });
}
