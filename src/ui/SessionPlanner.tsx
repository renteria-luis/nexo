import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Company, TrainingRoutineRow } from '../db/types.ts';
import type { PlannedExercise, RoutinePlan, TimeBudget } from '../training/index.ts';

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
  onLoadPlan: (routineId: string, budget: TimeBudget) => Promise<RoutinePlan>;
  onStart: (
    routineId: string,
    budget: TimeBudget,
    exercises: PlannedExercise[],
    company?: Company,
  ) => void;
};

/**
 * Spec 8.5: gym and routine first, then the time he has, then the trimmed plan for
 * approval. Spec 8.3 rule 7 is the reason this screen exists at all: the trim is
 * never applied behind his back. The gym step waits for the geofence (spec 5.2).
 */
export function SessionPlanner({ routines, onLoadPlan, onStart }: SessionPlannerProps) {
  const [routineId, setRoutineId] = useState<string | null>(null);
  const [budget, setBudget] = useState<TimeBudget>('completo');
  const [company, setCompany] = useState<Company | null>(null);
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

      <View style={styles.chips}>
        {routines.map((routine) => (
          <Pressable
            key={routine.id}
            accessibilityLabel={`Rutina ${routine.name}`}
            onPress={() => setRoutineId(routine.id)}
            style={[styles.chip, routine.id === selected && styles.chipSelected]}
          >
            <Text style={styles.chipText}>{routine.name}</Text>
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
            <Text style={styles.chipText}>{label}</Text>
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
            <Text style={styles.chipText}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      {problem && <Text style={styles.problem}>{problem}</Text>}

      {exercises.map((exercise) => (
        <View key={exercise.exerciseId} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.exercise}>
              {exercise.name} · {exercise.sets} × {reps(exercise)}
            </Text>
            <Text style={styles.detail}>
              {TIER_ES[exercise.tier]} · descanso {Math.round(exercise.restSeconds / 60)} min
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

      <Pressable
        accessibilityLabel="Empezar entreno"
        disabled={!selected || exercises.length === 0}
        onPress={() => {
          if (!selected || exercises.length === 0) return;
          onStart(selected, budget, exercises, company ?? undefined);
        }}
        style={[styles.start, exercises.length === 0 && styles.startDisabled]}
      >
        <Text style={styles.startText}>Empezar entreno</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'stretch',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
  },
  heading: {
    fontSize: 14,
  },
  label: {
    fontSize: 11,
    color: '#888',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#e2e2e2',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  chipSelected: {
    borderColor: '#555',
    backgroundColor: '#f3f3f3',
  },
  chipText: {
    fontSize: 11,
  },
  problem: {
    fontSize: 11,
    color: '#8a1f11',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: '#f5f5f5',
    paddingTop: 6,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  exercise: {
    fontSize: 13,
  },
  detail: {
    fontSize: 11,
    color: '#888',
  },
  nudge: {
    borderWidth: 1,
    borderColor: '#e2e2e2',
    borderRadius: 6,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeText: {
    fontSize: 14,
  },
  estimate: {
    fontSize: 11,
    color: '#666',
  },
  start: {
    borderWidth: 1,
    borderColor: '#555',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  startDisabled: {
    borderColor: '#ddd',
  },
  startText: {
    fontSize: 13,
  },
});
