import { useState } from 'react';
import { Text, View } from 'react-native';

import { formatWeight, toKg, type WeightUnit } from '../core/units.ts';
import type { TrainingRoutineRow } from '../db/types.ts';
import type { DayExercise } from '../shell/records.ts';
import type { CatalogExercise } from '../training/queries.ts';

import { Button } from './Button.tsx';
import { Chip } from './Chip.tsx';
import { IconButton } from './IconButton.tsx';
import { ConfirmButton } from './InfoBubble.tsx';
import { Check, Plus, Trash } from './icons.ts';
import { NumericField } from './NumericField.tsx';
import { font, sheet, shape } from './theme.ts';

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

  /** Las dos casillas y el boton de guardar, iguales para un ejercicio o para otro. */
  const form = (exerciseId: string, what: string) => (
    <View style={styles.addRow}>
      <NumericField
        value={weight}
        onChange={setWeight}
        allowDecimal={true}
        accessibilityLabel={`Peso para ${what}`}
        placeholder={unit}
        style={styles.input}
        focusedStyle={styles.inputEditing}
      />
      <NumericField
        value={reps}
        onChange={setReps}
        allowDecimal={false}
        accessibilityLabel={`Repeticiones para ${what}`}
        placeholder="reps"
        style={styles.input}
        focusedStyle={styles.inputEditing}
      />
      <IconButton
        icon={Check}
        tone="accent"
        accessibilityLabel={`Guardar la serie de ${what}`}
        onPress={() => submit(exerciseId)}
      />
    </View>
  );

  if (sessionId === null) {
    return (
      <View style={styles.block}>
        <Text style={styles.empty}>Sin entreno este día.</Text>
        <Text style={styles.hint}>Si entrenaste y no lo anotaste, escríbelo ahora:</Text>
        <View style={styles.chips}>
          {routines.map((routine) => (
            <Chip
              key={routine.id}
              label={routine.name}
              icon={Plus}
              accessibilityLabel={`Escribir un entreno de ${routine.name}`}
              onPress={() => onCreateSession(routine.id)}
            />
          ))}
          <Chip
            label="suelto"
            icon={Plus}
            accessibilityLabel="Escribir un entreno sin rutina"
            onPress={() => onCreateSession(null)}
          />
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

      {exercises.map((exercise, index) => (
        <View key={exercise.exerciseId} style={[styles.exercise, index > 0 && styles.ruled]}>
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
              <ConfirmButton
                icon={Trash}
                question={`¿Quitar la serie ${set.setIndex} de ${exercise.name}?`}
                accessibilityLabel={`Quitar la serie ${set.setIndex} de ${exercise.name}`}
                onConfirm={() => onRemoveSet(exercise.exerciseId, set.setIndex)}
              />
            </View>
          ))}

          {adding === exercise.exerciseId ? (
            form(exercise.exerciseId, exercise.name)
          ) : (
            <Button
              label="Serie"
              icon={Plus}
              accessibilityLabel={`Agregar una serie a ${exercise.name}`}
              style={styles.more}
              onPress={() => setAdding(exercise.exerciseId)}
            />
          )}
        </View>
      ))}

      <Text style={styles.hint}>Agregar otro ejercicio a este día:</Text>
      <View style={styles.chips}>
        {catalog
          .filter((item) => !exercises.some((done) => done.exerciseId === item.id))
          .map((item) => (
            <Chip
              key={item.id}
              label={item.name_es}
              accessibilityLabel={`Agregar ${item.name_es}`}
              selected={adding === item.id}
              onPress={() => setAdding(item.id)}
            />
          ))}
      </View>

      {adding !== null &&
        !exercises.some((done) => done.exerciseId === adding) &&
        form(adding, 'el ejercicio nuevo')}
    </View>
  );
}

const styles = sheet((theme) => ({
  block: {
    gap: 10,
  },
  line: {
    fontSize: 13,
    color: theme.textFaint,
    fontFamily: font.bold,
  },
  empty: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  hint: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  exercise: {
    gap: 6,
    paddingTop: 2,
  },
  ruled: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 10,
  },
  exerciseTop: {
    gap: 2,
  },
  exerciseName: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  exerciseMeta: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  setText: {
    flex: 1,
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  inputEditing: {
    backgroundColor: theme.surfaceHigh,
  },
  more: {
    alignSelf: 'flex-start',
  },
}));
