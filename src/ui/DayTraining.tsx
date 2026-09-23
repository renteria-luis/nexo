import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatWeight, toKg, type WeightUnit } from '../core/units.ts';
import type { TrainingRoutineRow } from '../db/types.ts';
import type { DayExercise } from '../shell/records.ts';
import type { CatalogExercise } from '../training/queries.ts';

import { NumericField } from './NumericField.tsx';
import { mono, theme } from './theme.ts';

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export type DayTrainingProps = {
  sessionId: string | null;
  retroactive: boolean;
  routineName: string | null;
  gymName: string | null;
  minutes: number | null;
  exercises: DayExercise[];
  catalog: CatalogExercise[];
  routines: TrainingRoutineRow[];
  unit: WeightUnit;
  onCreateSession: (routineId: string | null) => void;
  onAddSet: (exerciseId: string, weightKg: number, reps: number) => void;
  onRemoveSet: (exerciseId: string, setIndex: number) => void;
};

/**
 * El entreno de un dia cualquiera, incluido uno que la app no vio pasar. Escribir
 * una sesion vieja es lo unico que permite rellenar lo que entreno antes de tener
 * esto instalado, y spec 5.4 solo pide que quede marcada como escrita despues.
 */
export function DayTraining({
  sessionId,
  retroactive,
  routineName,
  gymName,
  minutes,
  exercises,
  catalog,
  routines,
  unit,
  onCreateSession,
  onAddSet,
  onRemoveSet,
}: DayTrainingProps) {
  const [adding, setAdding] = useState<string | null>(null);
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');

  const submit = (exerciseId: string) => {
    const parsedWeight = Number(weight.replace(',', '.'));
    const parsedReps = Number(reps);
    if (!Number.isFinite(parsedWeight) || parsedWeight < 0) return;
    if (!Number.isInteger(parsedReps) || parsedReps < 1) return;

    onAddSet(exerciseId, toKg(parsedWeight, unit), parsedReps);
    setWeight('');
    setReps('');
  };

  if (sessionId === null) {
    return (
      <View style={styles.block}>
        <Text style={styles.empty}>Sin entreno este día.</Text>
        <Text style={styles.hint}>Si entrenaste y no lo anotaste, escríbelo ahora:</Text>
        <View style={styles.chips}>
          {routines.map((routine) => (
            <Pressable
              key={routine.id}
              accessibilityLabel={`Escribir un entreno de ${routine.name}`}
              onPress={() => onCreateSession(routine.id)}
              style={styles.chip}
            >
              <Text style={styles.chipText}>+ {routine.name}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityLabel="Escribir un entreno sin rutina"
            onPress={() => onCreateSession(null)}
            style={styles.chip}
          >
            <Text style={styles.chipText}>+ suelto</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <Text style={styles.line}>
        {[routineName ?? 'Sin rutina', gymName, minutes === null ? null : `${minutes} min`]
          .filter(Boolean)
          .join(' · ')}
        {retroactive ? ' · escrito después' : ''}
      </Text>

      {exercises.map((exercise) => (
        <View key={exercise.exerciseId} style={styles.exercise}>
          <View style={styles.exerciseTop}>
            <Text style={styles.exerciseName}>{exercise.name}</Text>
            <Text style={styles.exerciseMeta}>
              {exercise.sets.length}
              {exercise.plannedSets === null ? '' : ` de ${exercise.plannedSets}`} series
              {exercise.averageRestSeconds === null
                ? ''
                : ` · ${clock(exercise.averageRestSeconds)} entre series`}
            </Text>
          </View>

          {exercise.sets.map((set) => (
            <View key={set.setIndex} style={styles.setRow}>
              <Text style={styles.setText}>
                {set.setIndex}. {formatWeight(set.weightKg, unit)} {unit}
                {exercise.perSide ? ' c/u' : ''} × {set.reps}
              </Text>
              <Pressable
                accessibilityLabel={`Quitar la serie ${set.setIndex} de ${exercise.name}`}
                onPress={() => onRemoveSet(exercise.exerciseId, set.setIndex)}
                style={styles.remove}
              >
                <Text style={styles.removeText}>quitar</Text>
              </Pressable>
            </View>
          ))}

          {adding === exercise.exerciseId ? (
            <View style={styles.addRow}>
              <NumericField
                value={weight}
                onChange={setWeight}
                allowDecimal={true}
                accessibilityLabel={`Peso para ${exercise.name}`}
                placeholder={unit}
                style={styles.input}
                focusedStyle={styles.inputEditing}
              />
              <NumericField
                value={reps}
                onChange={setReps}
                allowDecimal={false}
                accessibilityLabel={`Repeticiones para ${exercise.name}`}
                placeholder="reps"
                style={styles.input}
                focusedStyle={styles.inputEditing}
              />
              <Pressable
                accessibilityLabel={`Guardar la serie de ${exercise.name}`}
                onPress={() => submit(exercise.exerciseId)}
                style={styles.save}
              >
                <Text style={styles.saveText}>guardar</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityLabel={`Agregar una serie a ${exercise.name}`}
              onPress={() => setAdding(exercise.exerciseId)}
              style={styles.more}
            >
              <Text style={styles.moreText}>+ serie</Text>
            </Pressable>
          )}
        </View>
      ))}

      <Text style={styles.hint}>Agregar otro ejercicio a este día:</Text>
      <View style={styles.chips}>
        {catalog
          .filter((item) => !exercises.some((done) => done.exerciseId === item.id))
          .map((item) => (
            <Pressable
              key={item.id}
              accessibilityLabel={`Agregar ${item.name_es}`}
              onPress={() => setAdding(item.id)}
              style={[styles.chip, adding === item.id && styles.chipSelected]}
            >
              <Text style={[styles.chipText, adding === item.id && styles.chipTextSelected]}>
                {item.name_es}
              </Text>
            </Pressable>
          ))}
      </View>

      {adding !== null && !exercises.some((done) => done.exerciseId === adding) && (
        <View style={styles.addRow}>
          <NumericField
            value={weight}
            onChange={setWeight}
            allowDecimal={true}
            accessibilityLabel="Peso del ejercicio nuevo"
            placeholder={unit}
            style={styles.input}
            focusedStyle={styles.inputEditing}
          />
          <NumericField
            value={reps}
            onChange={setReps}
            allowDecimal={false}
            accessibilityLabel="Repeticiones del ejercicio nuevo"
            placeholder="reps"
            style={styles.input}
            focusedStyle={styles.inputEditing}
          />
          <Pressable
            accessibilityLabel="Guardar la serie del ejercicio nuevo"
            onPress={() => submit(adding)}
            style={styles.save}
          >
            <Text style={styles.saveText}>guardar</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: 8,
  },
  line: {
    fontSize: 12,
    color: theme.textDim,
    fontFamily: mono,
  },
  empty: {
    fontSize: 13,
    color: theme.textFaint,
  },
  hint: {
    fontSize: 11,
    color: theme.textGhost,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
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
    color: theme.text,
    fontFamily: mono,
  },
  chipTextSelected: {
    color: theme.accentInk,
  },
  exercise: {
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 8,
    gap: 4,
  },
  exerciseTop: {
    gap: 2,
  },
  exerciseName: {
    fontSize: 14,
    color: theme.text,
    fontFamily: mono,
  },
  exerciseMeta: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  setText: {
    fontSize: 14,
    color: theme.text,
    fontFamily: mono,
  },
  remove: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  removeText: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.text,
    fontFamily: mono,
    // Sin esto el campo no encoge por debajo de su ancho natural y la fila
    // se sale de la pantalla, que es el desbordamiento clasico de flex.
    minWidth: 0,
  },
  inputEditing: {
    borderColor: theme.accent,
  },
  save: {
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  saveText: {
    fontSize: 13,
    color: theme.accent,
    fontFamily: mono,
  },
  more: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  moreText: {
    fontSize: 12,
    color: theme.accent,
    fontFamily: mono,
  },
});
