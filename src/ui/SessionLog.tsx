import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatWeight, fromKg, snapToIncrement, toKg, type WeightUnit } from '../core/units.ts';
import { repDropOffs, type E1rmMark, type LoggedSet } from '../training/calculations.ts';
import type { Crowding } from '../db/types.ts';
import type { CatalogExercise } from '../training/queries.ts';

function setLine(set: LoggedSet, unit: WeightUnit): string {
  return `${formatWeight(set.weightKg, unit)} ${unit} × ${set.reps}`;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export type SessionLogProps = {
  exercises: CatalogExercise[];
  selectedExerciseId: string | null;
  onSelectExercise: (exerciseId: string) => void;
  /** Sets already logged today for the selected exercise. */
  todaySets: LoggedSet[];
  /** Spec 6.4: what he did last time, which is what he copies. */
  lastSets: LoggedSet[];
  marks: { best: E1rmMark; worst: E1rmMark } | null;
  sessionVolume: number;
  unit: WeightUnit;
  /** Spec 8.3 rule 8: the sets this session was approved to do, per exercise. */
  plannedSets: number | null;
  crowding: Crowding | null;
  onDescribe: (details: { crowding: Crowding }) => void;
  onAddSet: (
    weightKg: number,
    reps: number,
    extra?: { isWarmup?: boolean; rpe?: number | null },
  ) => void;
  onRemoveSet: (setIndex: number) => void;
};

export function SessionLog({
  exercises,
  selectedExerciseId,
  onSelectExercise,
  todaySets,
  lastSets,
  marks,
  sessionVolume,
  unit,
  plannedSets,
  crowding,
  onDescribe,
  onAddSet,
  onRemoveSet,
}: SessionLogProps) {
  const exercise = exercises.find((item) => item.id === selectedExerciseId) ?? null;

  // Null means untouched, so the field shows the pre-fill. Spec 6.4: the fields
  // carry last session's values for the same set index, because that is what he
  // copies most of the time. Derived rather than stored, so changing exercise or
  // adding a set moves them without a render pass to catch up.
  const [weightDraft, setWeightDraft] = useState<string | null>(null);
  const [repsDraft, setRepsDraft] = useState<string | null>(null);

  // Spec 9: the rest counts itself up from the last set. It is a reading, not a
  // timer he starts, and nothing happens when it passes the target.
  // Spec 10: the cues open on demand, because mid-set he is looking at the numbers.
  const [showTechnique, setShowTechnique] = useState(false);
  const [warmup, setWarmup] = useState(false);
  const [rpeDraft, setRpeDraft] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Mid-exercise the useful default is the set he just did, because the weight
  // usually holds across a run of sets. Starting one, it is what he did last time
  // at the same set index, which is spec 6.4.
  const previous =
    todaySets.at(-1) ??
    lastSets.find((set) => set.setIndex === todaySets.length + 1) ??
    lastSets.at(-1) ??
    null;
  const weight = weightDraft ?? (previous ? formatWeight(previous.weightKg, unit) : '');
  const reps = repsDraft ?? (previous ? String(previous.reps) : '');

  const clearDrafts = () => {
    setWeightDraft(null);
    setRepsDraft(null);
  };

  // Spec 5.1: the arrows move by the real step of this machine at this gym, never
  // by one. Stored in kilograms, shown in whatever unit he reads the plates in.
  const stepKg = exercise?.stepKg ?? toKg(5, 'lb');
  const lastSet = todaySets.at(-1) ?? null;
  const dropOffs = exercise ? repDropOffs(todaySets, exercise.default_rest_seconds) : [];
  const parsedWeight = Number(weight);
  const parsedReps = Number(reps);
  const canAdd =
    exercise !== null &&
    Number.isFinite(parsedWeight) &&
    parsedWeight >= 0 &&
    Number.isInteger(parsedReps) &&
    parsedReps > 0;

  const nudge = (direction: 1 | -1) => {
    const baseKg = toKg(Number.isFinite(parsedWeight) ? parsedWeight : 0, unit);
    setWeightDraft(formatWeight(snapToIncrement(baseKg + direction * stepKg, stepKg), unit));
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <Text style={styles.heading}>Entreno de hoy</Text>
        {sessionVolume > 0 && (
          <Text style={styles.volume}>
            {Math.round(fromKg(sessionVolume, unit))} {unit} de volumen
          </Text>
        )}
      </View>

      <>
        {/* Spec 8.5: asked on arrival and apart from starting, so it stays off the
            critical path. Spec 5.4 keeps it off a session written after the fact. */}
        <View style={styles.chips}>
          <Text style={styles.crowdingLabel}>¿Cómo está?</Text>
          {(
            [
              ['empty', 'Vacío'],
              ['normal', 'Normal'],
              ['full', 'Lleno'],
            ] as const
          ).map(([id, label]) => (
            <Pressable
              key={id}
              accessibilityLabel={`Gimnasio ${label}`}
              onPress={() => onDescribe({ crowding: id })}
              style={[styles.chip, crowding === id && styles.chipSelected]}
            >
              <Text style={styles.chipText}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.chips}>
          {exercises.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => {
                clearDrafts();
                setShowTechnique(false);
                onSelectExercise(item.id);
              }}
              style={[styles.chip, item.id === selectedExerciseId && styles.chipSelected]}
            >
              <Text style={styles.chipText}>{item.name_es}</Text>
            </Pressable>
          ))}
        </View>

        {exercise && (
          <>
            {/* Spec 6.4 order: last session's sets first and largest, then the marks. */}
            <View style={styles.machineRow}>
              {exercise.equipment && (
                <Text style={styles.machine}>
                  {exercise.equipment.name_es}
                  {exercise.equipment.model_code ? ` · ${exercise.equipment.model_code}` : ''}
                </Text>
              )}
              {exercise.technique_text && (
                <Pressable
                  accessibilityLabel={`Ver la tecnica de ${exercise.name_es}`}
                  onPress={() => setShowTechnique((open) => !open)}
                  style={styles.info}
                >
                  <Text style={styles.infoText}>i</Text>
                </Pressable>
              )}
            </View>

            {showTechnique && exercise.technique_text && (
              <View style={styles.technique}>
                {exercise.technique_text.split('\n').map((line) => (
                  <Text key={line} style={styles.techniqueLine}>
                    {line}
                  </Text>
                ))}
              </View>
            )}

            <Text style={styles.rest}>
              Descanso sugerido {clock(exercise.default_rest_seconds)}
              {lastSet?.timestamp
                ? ` · descansando ${clock((now - lastSet.timestamp) / 1000)}`
                : ''}
            </Text>

            <Text style={styles.lastLabel}>
              {lastSets.length > 0
                ? `La vez pasada (${lastSets[0].date})`
                : 'Primera vez con este ejercicio'}
            </Text>
            {lastSets.length > 0 && (
              <Text style={styles.lastSets}>
                {lastSets.map((set) => setLine(set, unit)).join('   ')}
              </Text>
            )}

            {marks && (
              <Text style={styles.marks}>
                Mejor {formatWeight(marks.best.e1rm, unit)} {unit} · peor{' '}
                {formatWeight(marks.worst.e1rm, unit)} {unit}, 1RM estimado en 8 semanas
              </Text>
            )}

            {todaySets.map((set) => (
              <View key={set.setIndex} style={styles.setRow}>
                <Text style={styles.setText}>
                  Serie {set.setIndex}: {setLine(set, unit)}
                  {typeof set.restBeforeSeconds === 'number'
                    ? ` · descansó ${clock(set.restBeforeSeconds)}`
                    : ''}
                </Text>
                <Pressable
                  accessibilityLabel={`Quitar serie ${set.setIndex}`}
                  onPress={() => onRemoveSet(set.setIndex)}
                  style={styles.remove}
                >
                  <Text style={styles.removeText}>quitar</Text>
                </Pressable>
              </View>
            ))}

            {warmup && (
              // Spec 5.5: warmups stay out of volume and marks, so a set logged with
              // this on will not appear in the list above.
              <Text style={styles.warmupNote}>
                Los calentamientos no cuentan para el volumen ni para las marcas.
              </Text>
            )}

            {plannedSets !== null && (
              <Text style={styles.planned}>
                Llevas {todaySets.length} de {plannedSets} series planeadas
              </Text>
            )}

            {dropOffs.map((drop) => (
              <Text key={drop.setIndex} style={styles.dropOff}>
                La serie {drop.setIndex} bajó a {drop.reps} de {drop.firstSetReps} repeticiones con{' '}
                {clock(drop.restSeconds)} de descanso. Spec 9: descansa lo suficiente para sostener
                el 90% de la primera serie.
              </Text>
            ))}

            <View style={styles.addRow}>
              <Pressable
                accessibilityLabel="Bajar peso"
                onPress={() => nudge(-1)}
                style={styles.nudge}
              >
                <Text style={styles.nudgeText}>−{formatWeight(stepKg, unit)}</Text>
              </Pressable>
              <TextInput
                value={weight}
                onChangeText={setWeightDraft}
                keyboardType="numeric"
                accessibilityLabel="Peso"
                placeholder={unit}
                style={styles.input}
              />
              <Pressable
                accessibilityLabel="Subir peso"
                onPress={() => nudge(1)}
                style={styles.nudge}
              >
                <Text style={styles.nudgeText}>+{formatWeight(stepKg, unit)}</Text>
              </Pressable>
              <TextInput
                value={reps}
                onChangeText={setRepsDraft}
                keyboardType="numeric"
                accessibilityLabel="Repeticiones"
                placeholder="reps"
                style={styles.input}
              />
              <TextInput
                value={rpeDraft}
                onChangeText={setRpeDraft}
                keyboardType="numeric"
                accessibilityLabel="RPE"
                placeholder="RPE"
                style={styles.input}
              />
              <Pressable
                accessibilityLabel="Serie de calentamiento"
                accessibilityState={{ checked: warmup }}
                onPress={() => setWarmup((value) => !value)}
                style={[styles.chip, warmup && styles.chipSelected]}
              >
                <Text style={styles.chipText}>Calentamiento</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Agregar serie"
                disabled={!canAdd}
                onPress={() => {
                  if (!canAdd) return;
                  const rpe = rpeDraft.trim() === '' ? null : Number(rpeDraft);
                  onAddSet(toKg(parsedWeight, unit), parsedReps, {
                    isWarmup: warmup,
                    rpe: rpe !== null && Number.isFinite(rpe) ? rpe : null,
                  });
                  clearDrafts();
                  setRpeDraft('');
                }}
                style={[styles.add, !canAdd && styles.addDisabled]}
              >
                <Text style={styles.addText}>Serie</Text>
              </Pressable>
            </View>
          </>
        )}
      </>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  heading: {
    fontSize: 14,
  },
  volume: {
    fontSize: 11,
    color: '#888',
  },
  planned: {
    fontSize: 11,
    color: '#666',
  },
  crowdingLabel: {
    fontSize: 11,
    color: '#888',
    alignSelf: 'center',
    marginRight: 2,
  },
  warmupNote: {
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
  machineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  machine: {
    fontSize: 11,
    color: '#666',
  },
  info: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 9,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: {
    fontSize: 11,
    color: '#666',
  },
  technique: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 10,
    gap: 3,
  },
  techniqueLine: {
    fontSize: 12,
    color: '#444',
  },
  rest: {
    fontSize: 11,
    color: '#999',
  },
  dropOff: {
    fontSize: 11,
    color: '#8a6d1f',
  },
  lastLabel: {
    fontSize: 11,
    color: '#888',
    marginTop: 4,
  },
  lastSets: {
    fontSize: 18,
  },
  marks: {
    fontSize: 11,
    color: '#888',
  },
  setRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  setText: {
    fontSize: 13,
  },
  remove: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  removeText: {
    fontSize: 11,
    color: '#8a1f11',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexWrap: 'wrap',
  },
  nudge: {
    borderWidth: 1,
    borderColor: '#e2e2e2',
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  nudgeText: {
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 7,
    fontSize: 14,
    width: 62,
  },
  add: {
    borderWidth: 1,
    borderColor: '#555',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addDisabled: {
    borderColor: '#ddd',
  },
  addText: {
    fontSize: 12,
  },
});
