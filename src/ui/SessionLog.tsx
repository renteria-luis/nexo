import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, Circle, Minus, Plus } from 'lucide-react-native';

import { shortDate } from '../core/dates.ts';
import { formatWeight, fromKg, snapToIncrement, toKg, type WeightUnit } from '../core/units.ts';
import {
  estimatedRestSeconds,
  repDropOffs,
  type E1rmMark,
  type LoggedSet,
} from '../training/calculations.ts';
import { isPerSide, type CatalogExercise } from '../training/queries.ts';
import type { SessionDraft } from '../core/session-draft.ts';
import type { Implement } from '../training/sessions.ts';

import { Button } from './Button.tsx';
import { NumericField } from './NumericField.tsx';
import { mono, theme } from './theme.ts';

/** Donde cae casi siempre una serie efectiva, asi que el primer toque arranca ahi. */
const RPE_START = 8;
const RPE_MAX = 10;

function setLine(set: LoggedSet, unit: WeightUnit): string {
  // "c/u" porque el numero es el de una mancuerna, no el de las dos.
  const each = (set.loadFactor ?? 1) > 1 ? ' c/u' : '';
  // En una dominada lo que escribe es el lastre, casi siempre cero, asi que al lado
  // va lo que de verdad levanto, que es el.
  const body = set.bodyWeightKg ? ` (+${formatWeight(set.bodyWeightKg, unit)} ${unit})` : '';
  return `${formatWeight(set.weightKg, unit)} ${unit}${each}${body} × ${set.reps}`;
}

/**
 * La misma serie partida en dos renglones, para el recuadro de la vez pasada.
 *
 * Todo seguido en una linea eran tres o cuatro series corridas sin donde cortar, que
 * es justo cuando no se lee nada de una ojeada entre serie y serie.
 */
function setChip(set: LoggedSet, unit: WeightUnit): { load: string; reps: string } {
  const each = (set.loadFactor ?? 1) > 1 ? ' c/u' : '';
  const body = set.bodyWeightKg ? `+${formatWeight(set.bodyWeightKg, unit)}` : '';
  // En una dominada lo que pesa de verdad es el, y el lastre suele ser cero.
  const load = set.bodyWeightKg
    ? set.weightKg > 0
      ? `${formatWeight(set.weightKg, unit)} ${body}`
      : `${body} ${unit}`
    : `${formatWeight(set.weightKg, unit)} ${unit}${each}`;
  return { load, reps: `× ${set.reps}` };
}

/** Spec 8.3 rule 8 visto de un vistazo: hecho, a medias, o todavia no. */
function progressOf(done: number, planned: number | undefined): 'done' | 'partial' | 'none' {
  if (done === 0) return 'none';
  if (planned === undefined || done >= planned) return 'done';
  return 'partial';
}

function hhmm(timestamp: number): string {
  const when = new Date(timestamp);
  return `${when.getHours()}:${String(when.getMinutes()).padStart(2, '0')}`;
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
  /** El boton de unidad cambia el ajuste, asi que vale en toda la app. */
  onChangeUnit: (unit: WeightUnit) => void;
  /** Spec 8.3 rule 8: the sets this session was approved to do, per exercise. */
  plannedSets: number | null;
  /** The exercises today's routine asked for. The rest of the catalogue hides behind "ver mas". */
  planExerciseIds: string[];
  /** Cuantas series lleva hoy cada ejercicio, para pintar lo que ya esta hecho. */
  setsDoneByExercise: Map<string, number>;
  /** Cuantas aprobo para cada uno. */
  plannedByExercise: Map<string, number>;
  onAddSet: (
    weightKg: number,
    reps: number,
    extra: { rpe: number | null; implement: Implement | null },
  ) => void;
  onRemoveSet: (setIndex: number) => void;
  /** Cuando toco empezar, para el reloj de la sesion. */
  startedAt: number | null;
  /** Lo que quedo escrito la ultima vez que estuvo aqui, si la app se cerro. */
  draft: SessionDraft | null;
  onDraftChange: (draft: {
    weight: string | null;
    reps: string | null;
    rpe: string | null;
    implement: Implement | null;
  }) => void;
  /** Set once he closes the session, which turns the button into a note. */
  finishedAt: number | null;
  onFinish: () => void;
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
  onChangeUnit,
  plannedSets,
  planExerciseIds,
  setsDoneByExercise,
  plannedByExercise,
  onAddSet,
  onRemoveSet,
  startedAt,
  draft,
  onDraftChange,
  finishedAt,
  onFinish,
}: SessionLogProps) {
  const exercise = exercises.find((item) => item.id === selectedExerciseId) ?? null;

  // Spec 8.5: the plan is the session. The full catalogue is still one tap away,
  // because a machine can be taken and the swap has to be logged somewhere.
  const [showAll, setShowAll] = useState(false);
  const inPlan = exercises.filter((item) => planExerciseIds.includes(item.id));
  const visibleExercises =
    showAll || inPlan.length === 0
      ? exercises
      : exercises.filter(
          (item) => planExerciseIds.includes(item.id) || item.id === selectedExerciseId,
        );

  // Null means untouched, so the field shows the pre-fill. Spec 6.4: the fields
  // carry last session's values for the same set index, because that is what he
  // copies most of the time. Derived rather than stored, so changing exercise or
  // adding a set moves them without a render pass to catch up.
  const [weightDraft, setWeightDraft] = useState<string | null>(draft?.weight ?? null);
  const [repsDraft, setRepsDraft] = useState<string | null>(draft?.reps ?? null);
  const [rpeDraft, setRpeDraft] = useState<string | null>(draft?.rpe ?? null);

  // Spec 9: the rest counts itself up from the last set. It is a reading, not a
  // timer he starts, and nothing happens when it passes the target.
  // Spec 10: the cues open on demand, because mid-set he is looking at the numbers.
  const [showTechnique, setShowTechnique] = useState(false);
  // Con que lo esta haciendo hoy. Null es "con lo que dice el catalogo".
  const [implement, setImplement] = useState<Implement | null>(
    (draft?.implement as Implement | null) ?? null,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Cada cambio se guarda, para que cerrar la app a mitad de una serie no borre lo
  // que estaba escrito. Es una escritura suelta en la base, sin recargar nada.
  const report = useRef(onDraftChange);
  useEffect(() => {
    report.current = onDraftChange;
  }, [onDraftChange]);
  useEffect(() => {
    report.current({ weight: weightDraft, reps: repsDraft, rpe: rpeDraft, implement });
  }, [weightDraft, repsDraft, rpeDraft, implement]);

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
  // El esfuerzo tambien se copia de la serie anterior: entre una y otra casi nunca
  // cambia, y cuando cambia son dos toques.
  const rpe = rpeDraft ?? (previous?.rpe == null ? '' : String(previous.rpe));

  const clearDrafts = () => {
    setWeightDraft(null);
    setRepsDraft(null);
    setRpeDraft(null);
  };

  // Spec 5.1 pedia el salto real de la maquina, pero la P156 sube de 15 en 15 y casi
  // todas las torres traen un bloquecito de 5 lb que se añade aparte, asi que el
  // salto util es ese. En kilos el equivalente redondo son 2.5.
  const stepKg = unit === 'lb' ? toKg(5, 'lb') : 2.5;
  // El martillo y las laterales se hacen con mancuernas o en polea, y el numero que
  // escribe significa una cosa distinta en cada caso, asi que se elige aqui.
  const swappable =
    exercise !== null &&
    (exercise.equipment_type === 'dumbbell' || exercise.equipment_type === 'cable');
  const doneWith = implement ?? exercise?.equipment_type ?? null;
  // Con mancuernas escribe lo que dice una, porque es lo que se lee agachado al
  // lado del rack. El volumen ya cuenta las dos por su cuenta.
  const perSide =
    doneWith === null
      ? false
      : isPerSide(doneWith, implement === null ? (exercise?.equipment?.kind ?? null) : null);
  const lastSet = todaySets.at(-1) ?? null;
  const betweenSeconds = lastSet?.timestamp ? (now - lastSet.timestamp) / 1000 : null;
  const dropOffs = exercise ? repDropOffs(todaySets, exercise.default_rest_seconds) : [];
  const parsedWeight = Number(weight);
  const parsedReps = Number(reps);
  const parsedRpe = rpe.trim() === '' ? null : Number(rpe);
  const canAdd =
    exercise !== null &&
    Number.isFinite(parsedWeight) &&
    parsedWeight >= 0 &&
    Number.isInteger(parsedReps) &&
    parsedReps > 0;

  // Un solo boton: dice en que unidad escribe y al tocarlo cambia. El numero que ya
  // estaba escrito se convierte, para que siga siendo el mismo peso.
  const flipUnit = () => {
    const next: WeightUnit = unit === 'lb' ? 'kg' : 'lb';
    const typed = Number(weightDraft);
    if (weightDraft !== null && weightDraft.trim() !== '' && Number.isFinite(typed)) {
      setWeightDraft(formatWeight(toKg(typed, unit), next));
    }
    onChangeUnit(next);
  };

  // Cambiar 12 por 11 no vale abrir el teclado, que tapa media pantalla.
  const stepReps = (direction: 1 | -1) => {
    const base = Number.isInteger(parsedReps) && parsedReps > 0 ? parsedReps : 0;
    setRepsDraft(String(Math.max(1, base + direction)));
  };

  const stepRpe = (direction: 1 | -1) => {
    if (parsedRpe === null || !Number.isFinite(parsedRpe)) {
      setRpeDraft(String(RPE_START));
      return;
    }
    const next = parsedRpe + direction;
    if (next < 0 || next > RPE_MAX) return;
    setRpeDraft(String(next));
  };

  const nudge = (direction: 1 | -1) => {
    const baseKg = toKg(Number.isFinite(parsedWeight) ? parsedWeight : 0, unit);
    setWeightDraft(formatWeight(snapToIncrement(baseKg + direction * stepKg, stepKg), unit));
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <Text style={styles.heading}>Volumen de hoy</Text>
        <Text style={styles.volume}>
          {Math.round(fromKg(sessionVolume, unit))} {unit}
        </Text>
      </View>

      <>
        {/* Lista y no fila de chips: los nombres son largos, cada chip ocupaba un
            renglon entero igual, y asi se ve de un vistazo lo que falta de cada uno. */}
        <View style={styles.exerciseList}>
          {visibleExercises.map((item) => {
            const done = setsDoneByExercise.get(item.id) ?? 0;
            const planned = plannedByExercise.get(item.id);
            const progress = progressOf(done, planned);
            const selected = item.id === selectedExerciseId;
            return (
              <Pressable
                key={item.id}
                accessibilityLabel={`${item.name_es}${
                  progress === 'done' ? ', hecho' : progress === 'partial' ? ', a medias' : ''
                }`}
                onPress={() => {
                  clearDrafts();
                  setShowTechnique(false);
                  setImplement(null);
                  onSelectExercise(item.id);
                }}
                style={[styles.exerciseRow, selected && styles.exerciseRowSelected]}
              >
                <View style={styles.exerciseMark}>
                  {progress === 'done' ? (
                    <Check size={16} color={theme.ok} strokeWidth={2} />
                  ) : progress === 'partial' ? (
                    <Circle size={14} color={theme.warn} strokeWidth={2} />
                  ) : (
                    <Circle size={14} color={theme.textGhost} strokeWidth={1.5} />
                  )}
                </View>
                <Text
                  style={[
                    styles.exerciseRowText,
                    selected && styles.exerciseRowTextSelected,
                    progress === 'done' && styles.exerciseRowTextDone,
                  ]}
                  numberOfLines={1}
                >
                  {item.name_es}
                </Text>
                <Text style={styles.exerciseCount}>
                  {done}
                  {planned === undefined ? '' : `/${planned}`}
                </Text>
              </Pressable>
            );
          })}

          {inPlan.length > 0 && inPlan.length < exercises.length && (
            <Pressable
              accessibilityLabel={
                showAll ? 'Ver solo la rutina de hoy' : 'Ver todos los ejercicios'
              }
              onPress={() => setShowAll((open) => !open)}
              style={styles.more}
            >
              <Text style={styles.moreText}>
                {showAll ? 'solo la rutina de hoy' : 'ver todos los ejercicios'}
              </Text>
            </Pressable>
          )}
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
              {swappable &&
                (['dumbbell', 'cable'] as const).map((option) => (
                  <Pressable
                    key={option}
                    accessibilityLabel={option === 'dumbbell' ? 'Con mancuernas' : 'En polea'}
                    onPress={() => setImplement(option)}
                    style={[styles.implement, doneWith === option && styles.implementOn]}
                  >
                    <Text
                      style={[styles.implementText, doneWith === option && styles.implementTextOn]}
                    >
                      {option === 'dumbbell' ? 'mancuerna' : 'polea'}
                    </Text>
                  </Pressable>
                ))}
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

            {/* Spec 9: el reloj cuenta desde que anoto la ultima serie, que es cuando
                empezo a descansar de verdad. El descuento por la serie solo aplica al
                hueco entre dos series ya anotadas, que si lleva una serie dentro: aqui
                dejaba el reloj clavado en cero durante medio minuto. */}
            <Text style={styles.rest}>
              Descanso sugerido {clock(exercise.default_rest_seconds)}
              {betweenSeconds === null ? '' : ` · descansando ${clock(betweenSeconds)}`}
            </Text>

            <Text style={styles.lastLabel}>
              {lastSets.length > 0
                ? `la vez pasada · ${shortDate(lastSets[0].date)}`
                : 'primera vez con este ejercicio'}
            </Text>
            {lastSets.length > 0 && (
              <View style={styles.lastSets}>
                {lastSets.map((set) => {
                  const chip = setChip(set, unit);
                  return (
                    <Pressable
                      key={set.setIndex}
                      // Tocarla la copia a los campos: a veces quiere repetir la
                      // segunda serie y no la que toca por numero.
                      accessibilityLabel={`Copiar la serie ${set.setIndex} de la vez pasada`}
                      onPress={() => {
                        setWeightDraft(formatWeight(set.weightKg, unit));
                        setRepsDraft(String(set.reps));
                      }}
                      style={styles.lastSet}
                    >
                      <Text style={styles.lastSetIndex}>
                        {set.setIndex}
                        {set.rpe == null ? '' : ` · RPE ${set.rpe}`}
                      </Text>
                      <Text style={styles.lastSetLoad}>{chip.load}</Text>
                      <Text style={styles.lastSetReps}>{chip.reps}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {marks && (
              /* Un 1RM estimado con centesimas es ruido: la formula ya es una
                 aproximacion, asi que se lee redondo. */
              <Text style={styles.marks}>
                1RM estimado · mejor {Math.round(fromKg(marks.best.e1rm, unit))} · peor{' '}
                {Math.round(fromKg(marks.worst.e1rm, unit))} {unit} · 8 semanas
              </Text>
            )}

            {todaySets.map((set, index) => (
              <View key={set.setIndex} style={styles.setRow}>
                <Text style={styles.setText}>
                  Serie {set.setIndex}: {setLine(set, unit)}
                  {typeof set.restBeforeSeconds === 'number' && todaySets[index - 1]
                    ? ` · descanso aprox. ${clock(
                        estimatedRestSeconds(set.restBeforeSeconds, todaySets[index - 1].reps),
                      )}`
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

            {/* Cuatro cuadrantes con su etiqueta y sus flechas. Entre serie y serie
                el pulgar sabe donde va sin leer nada, que es lo que hace que se anote
                mientras entrena y no al final de memoria. */}
            <View style={styles.grid}>
              <View style={styles.gridRow}>
                <View style={styles.cell}>
                  <View style={styles.cellHead}>
                    <Text style={styles.cellLabel}>peso</Text>
                    <Pressable
                      accessibilityLabel={`Cambiar a ${unit === 'lb' ? 'kilos' : 'libras'}`}
                      onPress={flipUnit}
                      style={styles.unit}
                    >
                      <Text style={styles.unitText}>{unit}</Text>
                    </Pressable>
                  </View>
                  <View style={styles.cellRow}>
                    <Pressable
                      accessibilityLabel="Bajar peso"
                      onPress={() => nudge(-1)}
                      style={styles.step}
                    >
                      <Minus size={18} color={theme.text} strokeWidth={1.75} />
                    </Pressable>
                    <NumericField
                      value={weight}
                      onChange={setWeightDraft}
                      allowDecimal={true}
                      accessibilityLabel="Peso"
                      placeholder={unit}
                      style={styles.cellInput}
                      focusedStyle={styles.cellInputEditing}
                    />
                    <Pressable
                      accessibilityLabel="Subir peso"
                      onPress={() => nudge(1)}
                      style={styles.step}
                    >
                      <Plus size={18} color={theme.text} strokeWidth={1.75} />
                    </Pressable>
                  </View>
                </View>

                <View style={styles.cell}>
                  <View style={styles.cellHead}>
                    <Text style={styles.cellLabel}>RPE</Text>
                  </View>
                  <View style={styles.cellRow}>
                    <Pressable
                      accessibilityLabel="Bajar RPE"
                      onPress={() => stepRpe(-1)}
                      style={styles.step}
                    >
                      <Minus size={18} color={theme.text} strokeWidth={1.75} />
                    </Pressable>
                    <NumericField
                      value={rpe}
                      onChange={setRpeDraft}
                      allowDecimal={false}
                      accessibilityLabel="RPE"
                      placeholder="—"
                      style={styles.cellInput}
                      focusedStyle={styles.cellInputEditing}
                    />
                    <Pressable
                      accessibilityLabel="Subir RPE"
                      onPress={() => stepRpe(1)}
                      style={styles.step}
                    >
                      <Plus size={18} color={theme.text} strokeWidth={1.75} />
                    </Pressable>
                  </View>
                </View>
              </View>

              <View style={styles.gridRow}>
                <View style={styles.cell}>
                  <View style={styles.cellHead}>
                    <Text style={styles.cellLabel}>reps</Text>
                  </View>
                  <View style={styles.cellRow}>
                    <Pressable
                      accessibilityLabel="Una repeticion menos"
                      onPress={() => stepReps(-1)}
                      style={styles.step}
                    >
                      <Minus size={18} color={theme.text} strokeWidth={1.75} />
                    </Pressable>
                    <NumericField
                      value={reps}
                      onChange={setRepsDraft}
                      allowDecimal={false}
                      accessibilityLabel="Repeticiones"
                      placeholder="0"
                      style={styles.cellInput}
                      focusedStyle={styles.cellInputEditing}
                    />
                    <Pressable
                      accessibilityLabel="Una repeticion mas"
                      onPress={() => stepReps(1)}
                      style={styles.step}
                    >
                      <Plus size={18} color={theme.text} strokeWidth={1.75} />
                    </Pressable>
                  </View>
                </View>

                <View style={styles.cell}>
                  <View style={styles.cellHead} />
                  <Button
                    label="Serie"
                    icon={Plus}
                    variant="primary"
                    size="large"
                    block
                    disabled={!canAdd}
                    accessibilityLabel="Agregar serie"
                    onPress={() => {
                      if (!canAdd) return;
                      const rpe =
                        parsedRpe !== null && Number.isFinite(parsedRpe)
                          ? Math.min(RPE_MAX, Math.max(0, parsedRpe))
                          : null;
                      onAddSet(toKg(parsedWeight, unit), parsedReps, { rpe, implement });
                      clearDrafts();
                    }}
                    style={styles.serie}
                  />
                </View>
              </View>
            </View>

            {perSide && (
              <Text style={styles.perSide}>
                El peso es el de una mancuerna; el volumen cuenta las dos.
              </Text>
            )}
          </>
        )}

        {finishedAt === null ? (
          <Button
            label="Terminar entreno"
            icon={Check}
            block
            accessibilityLabel="Terminar entreno"
            onPress={onFinish}
            style={styles.finish}
          />
        ) : (
          <Text style={styles.finished}>Entreno terminado a las {hhmm(finishedAt)}</Text>
        )}

        {startedAt !== null && (
          <Text style={styles.sessionClock}>Entrenando {clock((now - startedAt) / 1000)}</Text>
        )}
      </>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 12,
    marginTop: 4,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  cellHead: {
    flexDirection: 'row',
    alignItems: 'center',
    // Pegado a su etiqueta: al otro extremo quedaba junto al rotulo del RPE y
    // parecia decir "kg RPE".
    gap: 8,
    minHeight: 26,
  },
  cellLabel: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  unit: {
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  unitText: {
    fontSize: 12,
    color: theme.accent,
    fontFamily: mono,
  },
  cellRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
  },
  step: {
    width: 42,
    minHeight: 52,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 8,
    textAlign: 'center',
    fontSize: 20,
    color: theme.text,
    fontFamily: mono,
  },
  cellInputEditing: {
    borderColor: theme.accent,
  },
  serie: {
    minHeight: 52,
  },
  perSide: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  exerciseList: {
    borderTopWidth: 1,
    borderTopColor: theme.line,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 43,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
    paddingHorizontal: 4,
  },
  exerciseRowSelected: {
    backgroundColor: theme.surfaceHigh,
    borderLeftWidth: 2,
    borderLeftColor: theme.accent,
    paddingHorizontal: 8,
  },
  exerciseMark: {
    width: 18,
    alignItems: 'center',
  },
  exerciseRowText: {
    flex: 1,
    fontSize: 14,
    color: theme.textDim,
    fontFamily: mono,
  },
  exerciseRowTextSelected: {
    color: theme.text,
  },
  exerciseRowTextDone: {
    color: theme.ok,
  },
  exerciseCount: {
    fontSize: 13,
    color: theme.textGhost,
    fontFamily: mono,
  },
  finish: {
    marginTop: 18,
  },
  wrapper: {
    alignSelf: 'stretch',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  heading: {
    fontSize: 14,
    fontFamily: mono,
    color: theme.text,
  },
  volume: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  planned: {
    fontSize: 11,
    color: theme.textFaint,
    fontFamily: mono,
  },
  more: {
    paddingHorizontal: 4,
    paddingVertical: 5,
  },
  moreText: {
    fontSize: 11,
    color: theme.textFaint,
    textDecorationLine: 'underline',
    fontFamily: mono,
  },
  machineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  machine: {
    fontSize: 11,
    color: theme.textFaint,
    fontFamily: mono,
  },
  info: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 9,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: {
    fontSize: 11,
    color: theme.textFaint,
    fontFamily: mono,
  },
  implement: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  implementOn: {
    borderColor: theme.accent,
    backgroundColor: theme.accent,
  },
  implementText: {
    fontSize: 10,
    color: theme.textGhost,
    fontFamily: mono,
  },
  implementTextOn: {
    color: theme.accentInk,
  },
  technique: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    padding: 10,
    gap: 3,
  },
  techniqueLine: {
    fontSize: 12,
    color: theme.textDim,
  },
  rest: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  restEstimate: {
    fontSize: 11,
    color: theme.textGhost,
    marginTop: -4,
    fontFamily: mono,
  },
  dropOff: {
    fontSize: 11,
    color: theme.warn,
  },
  lastLabel: {
    fontSize: 11,
    color: theme.textGhost,
    marginTop: 4,
    fontFamily: mono,
  },
  lastSets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  lastSet: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 78,
  },
  lastSetIndex: {
    fontSize: 9,
    fontFamily: mono,
    color: theme.textGhost,
  },
  lastSetLoad: {
    fontSize: 15,
    fontFamily: mono,
    color: theme.text,
  },
  lastSetReps: {
    fontSize: 15,
    fontFamily: mono,
    color: theme.textFaint,
  },
  marks: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  setRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  setText: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  remove: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  removeText: {
    fontSize: 11,
    color: theme.danger,
    fontFamily: mono,
  },
  sessionClock: {
    fontSize: 12,
    color: theme.textGhost,
    fontFamily: mono,
    textAlign: 'center',
    marginTop: 10,
  },
  finished: {
    fontSize: 12,
    color: theme.textFaint,
    marginTop: 16,
    fontFamily: mono,
  },
});
