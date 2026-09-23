import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GymLocation } from '../core/geo.ts';
import type { Company, TrainingRoutineRow } from '../db/types.ts';
import type { LocationOutcome } from '../shell/location.ts';
import type { PlannedExercise, RoutinePlan, TimeBudget } from '../training/index.ts';
import { Moon, Play } from 'lucide-react-native';

import { Button } from './Button.tsx';
import { mono, theme } from './theme.ts';

const BUDGETS: { id: TimeBudget; label: string }[] = [
  { id: 'completo', label: 'Completo' },
  { id: 'minus_25', label: '−25%' },
  { id: 'minus_50', label: '−50%' },
  { id: 'express', label: 'Express' },
];

const TIER_ES: Record<number, string> = {
  1: 'núcleo',
  2: 'secundario',
  3: 'accesorio',
  4: 'opcional',
};

function reps(exercise: PlannedExercise): string {
  if (exercise.repMode === 'amrap') return 'al fallo técnico';
  if (exercise.repMode === 'failure') return 'al fallo';
  if (exercise.repMin === null || exercise.repMax === null) return '';
  return exercise.repMin === exercise.repMax
    ? `${exercise.repMin} repeticiones`
    : `${exercise.repMin} a ${exercise.repMax} repeticiones`;
}

export type SessionPlannerProps = {
  routines: TrainingRoutineRow[];
  gyms: GymLocation[];
  /** One reading, taken only when he asks for it (spec 5.2). */
  onLocate: () => Promise<LocationOutcome>;
  onLoadPlan: (routineId: string, budget: TimeBudget) => Promise<RoutinePlan>;
  onStart: (
    routineId: string,
    budget: TimeBudget,
    exercises: PlannedExercise[],
    company?: Company,
    gymId?: string,
  ) => void;
  /** Spec 4.3: un descanso dicho a tiempo no es un entreno fallado. */
  restDay: boolean;
  onRestDay: () => void;
};

/**
 * Spec 8.5: gym and routine first, then the time he has, then the trimmed plan for
 * approval. Spec 8.3 rule 7 is the reason this screen exists at all: the trim is
 * never applied behind his back. The gym step waits for the geofence (spec 5.2).
 */
export function SessionPlanner({
  routines,
  gyms,
  onLocate,
  onLoadPlan,
  onStart,
  restDay,
  onRestDay,
}: SessionPlannerProps) {
  const [routineId, setRoutineId] = useState<string | null>(null);
  const [budget, setBudget] = useState<TimeBudget>('completo');
  const [company, setCompany] = useState<Company | null>(null);
  const [gymId, setGymId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [whereNote, setWhereNote] = useState<string | null>(null);
  const [plan, setPlan] = useState<RoutinePlan | null>(null);
  const [exercises, setExercises] = useState<PlannedExercise[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const selected = routineId ?? routines[0]?.id ?? null;

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    onLoadPlan(selected, budget)
      .then((loaded) => {
        if (cancelled) return;
        setPlan(loaded);
        setExercises(loaded.exercises);
        setProblem(null);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setProblem(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [selected, budget, onLoadPlan]);

  // Spec 8.3 rule 6: the estimate follows the overrides, not the untouched plan.
  const seconds = exercises.reduce(
    (total, exercise) => total + exercise.sets * (45 + exercise.restSeconds) + 60,
    exercises.length > 0 ? 300 : 0,
  );

  const override = (exerciseId: string, direction: 1 | -1) =>
    setExercises((current) =>
      current.map((exercise) =>
        exercise.exerciseId === exerciseId
          ? { ...exercise, sets: Math.max(1, exercise.sets + direction) }
          : exercise,
      ),
    );

  return (
    <View style={styles.wrapper}>
      <Text style={styles.heading}>Entreno de hoy</Text>

      <Text style={styles.label}>Dónde</Text>
      <View style={styles.chips}>
        {gyms.map((gym) => (
          <Pressable
            key={gym.id}
            accessibilityLabel={`Gimnasio ${gym.name}`}
            onPress={() => {
              setGymId(gym.id);
              setWhereNote(null);
            }}
            style={[styles.chip, gym.id === gymId && styles.chipSelected]}
          >
            <Text style={[styles.chipText, gym.id === gymId && styles.chipTextSelected]}>
              {gym.name}
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityLabel="Usar mi ubicación"
          disabled={locating}
          onPress={() => {
            setLocating(true);
            setWhereNote('Buscando…');
            onLocate()
              .then((outcome) => {
                if (outcome.kind === 'match') {
                  setGymId(outcome.fix.gym.id);
                  setWhereNote(`${outcome.fix.gym.name}, a ${Math.round(outcome.fix.distanceM)} m`);
                } else if (outcome.kind === 'elsewhere') {
                  setWhereNote('No estás en ninguno de los dos');
                } else {
                  setWhereNote('Sin permiso de ubicación');
                }
              })
              .catch((error: unknown) => {
                console.error(error);
                setWhereNote(error instanceof Error ? error.message : String(error));
              })
              .finally(() => setLocating(false));
          }}
          style={[styles.chip, locating && styles.chipSelected]}
        >
          <Text style={[styles.chipText, locating && styles.chipTextSelected]}>
            Usar mi ubicación
          </Text>
        </Pressable>
      </View>
      {whereNote && <Text style={styles.detail}>{whereNote}</Text>}

      <Text style={styles.label}>Rutina</Text>
      <View style={styles.chips}>
        {routines.map((routine) => (
          <Pressable
            key={routine.id}
            accessibilityLabel={`Rutina ${routine.name}`}
            onPress={() => setRoutineId(routine.id)}
            style={[styles.chip, routine.id === selected && styles.chipSelected]}
          >
            <Text style={[styles.chipText, routine.id === selected && styles.chipTextSelected]}>
              {routine.name}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Con quién</Text>
      <View style={styles.chips}>
        {(
          [
            ['alone', 'Solo'],
            ['with_someone', 'Acompañado'],
          ] as const
        ).map(([id, label]) => (
          <Pressable
            key={id}
            accessibilityLabel={label}
            onPress={() => setCompany((current) => (current === id ? null : id))}
            style={[styles.chip, company === id && styles.chipSelected]}
          >
            <Text style={[styles.chipText, company === id && styles.chipTextSelected]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Tiempo que tengo</Text>
      <View style={styles.chips}>
        {BUDGETS.map((option) => (
          <Pressable
            key={option.id}
            accessibilityLabel={`Tiempo ${option.label}`}
            onPress={() => setBudget(option.id)}
            style={[styles.chip, option.id === budget && styles.chipSelected]}
          >
            <Text style={[styles.chipText, option.id === budget && styles.chipTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {problem && <Text style={styles.problem}>{problem}</Text>}

      {exercises.length > 0 && (
        <Text style={styles.detail}>Con − y + le quitas o le pones series a un ejercicio.</Text>
      )}

      {exercises.map((exercise) => (
        <View key={exercise.exerciseId} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.exercise}>
              {exercise.name} · {exercise.sets} × {reps(exercise)}
            </Text>
            <Text style={styles.detail}>
              {TIER_ES[exercise.tier]} · descanso {Math.round(exercise.restSeconds / 60)} min
              {exercise.unilateral ? ' · por brazo' : ''}
            </Text>
          </View>
          <Pressable
            accessibilityLabel={`Una serie menos de ${exercise.name}`}
            onPress={() => override(exercise.exerciseId, -1)}
            style={styles.nudge}
          >
            <Text style={styles.nudgeText}>−</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={`Una serie más de ${exercise.name}`}
            onPress={() => override(exercise.exerciseId, 1)}
            style={styles.nudge}
          >
            <Text style={styles.nudgeText}>+</Text>
          </Pressable>
        </View>
      ))}

      {plan && (
        <Text style={styles.estimate}>
          {exercises.length} ejercicios · unos {Math.round(seconds / 60)} min
        </Text>
      )}

      <Button
        label="Empezar entreno"
        icon={Play}
        variant="primary"
        size="large"
        block
        disabled={!selected || exercises.length === 0}
        accessibilityLabel="Empezar entreno"
        onPress={() => {
          if (!selected || exercises.length === 0) return;
          onStart(selected, budget, exercises, company ?? undefined, gymId ?? undefined);
        }}
        style={styles.start}
      />

      {restDay ? (
        <Text style={styles.restNote}>
          Hoy es descanso. Cuenta como día planeado, así que no penaliza nada.
        </Text>
      ) : (
        <Button
          label="Hoy descanso"
          icon={Moon}
          block
          accessibilityLabel="Hoy descanso"
          onPress={onRestDay}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  start: {
    marginTop: 6,
  },
  wrapper: {
    alignSelf: 'stretch',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 12,
  },
  heading: {
    fontSize: 14,
    fontFamily: mono,
    color: theme.text,
  },
  label: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  chip: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 38,
    justifyContent: 'center',
  },
  chipSelected: {
    borderColor: theme.accent,
    backgroundColor: theme.accent,
  },
  chipText: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.text,
  },
  chipTextSelected: {
    color: theme.accentInk,
  },
  problem: {
    fontSize: 11,
    color: theme.danger,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: theme.lineSoft,
    paddingTop: 6,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  exercise: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  detail: {
    fontSize: 11,
    color: theme.textGhost,
  },
  nudge: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 6,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeText: {
    fontSize: 14,
    fontFamily: mono,
    color: theme.text,
  },
  estimate: {
    fontSize: 11,
    color: theme.textFaint,
    fontFamily: mono,
  },
  restNote: {
    fontSize: 11,
    color: theme.ok,
    textAlign: 'center',
    paddingVertical: 8,
  },
});
