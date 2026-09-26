import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check, Circle, Minus, Plus } from './icons.ts';

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
import { Card } from './Card.tsx';
import { Chip } from './Chip.tsx';
import { NumericField } from './NumericField.tsx';
import { font, sheet, shape, theme } from './theme.ts';

/**
 * Con que se puede hacer el mismo ejercicio.
 *
 * Solo la mancuerna se escribe por mano: en polea y en maquina el numero del pin ya
 * es todo lo que se movio. Sin la opcion de maquina habia que marcar mancuerna y el
 * volumen salia al doble.
 */
const IMPLEMENTS: { id: Implement; short: string; long: string }[] = [
  { id: 'dumbbell', short: 'mancuerna', long: 'Con mancuernas' },
  { id: 'cable', short: 'polea', long: 'En polea' },
  { id: 'machine', short: 'máquina', long: 'En máquina' },
];

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

/**
 * El tiempo que lleva corriendo desde un instante, contandose solo.
 *
 * Vive en su propio componente a proposito: el segundo que pasa solo tiene que
 * repintar estos cuatro caracteres, no la pantalla entera del entreno. Cuando el
 * reloj estaba en el componente grande, cada segundo volvia a dibujar la lista de
 * series, el selector de ejercicio y el formulario, y eso se nota justo cuando esta
 * escribiendo un peso.
 *
 * Quien lo usa le pasa el instante tambien como clave, asi que empezar a contar de
 * nuevo es montarlo de nuevo y no hay que sincronizar nada por dentro.
 */
function Elapsed({ since, prefix = '' }: { since: number; prefix?: string }) {
  const [seconds, setSeconds] = useState(() => (Date.now() - since) / 1000);

  useEffect(() => {
    const tick = setInterval(() => setSeconds((Date.now() - since) / 1000), 1000);
    return () => clearInterval(tick);
  }, [since]);

  return (
    <>
      {prefix}
      {clock(seconds)}
    </>
  );
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
  /** Deshace el terminar: es el unico boton de aqui sin vuelta atras. */
  onReopen: () => void;
};

/**
 * Memoizada: es el componente mas grande de la app y se dibuja entero cada vez que la
 * pantalla se repinta. Mientras lo que muestra sea lo mismo, tocar el gentio del
 * gimnasio o cualquier cosa de otra pestana ya no lo vuelve a armar.
 */
/**
 * Un renglon de la lista de ejercicios.
 *
 * Memoizado porque son diez con su icono y su cuenta, y elegir otro ejercicio solo
 * cambia dos: el que se apaga y el que se prende. Los otros ocho no tienen por que
 * volver a armarse.
 */
const ExerciseRow = memo(function ExerciseRow({
  item,
  done,
  planned,
  selected,
  onPick,
}: {
  item: CatalogExercise;
  done: number;
  planned: number | undefined;
  selected: boolean;
  onPick: (exerciseId: string) => void;
}) {
  const progress = progressOf(done, planned);

  return (
    <Pressable
      accessibilityLabel={`${item.name_es}${
        progress === 'done' ? ', hecho' : progress === 'partial' ? ', a medias' : ''
      }`}
      onPress={() => onPick(item.id)}
      style={({ pressed }) => [
        styles.exerciseRow,
        selected && styles.exerciseRowSelected,
        pressed && styles.pressedSoft,
      ]}
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
});

export const SessionLog = memo(function SessionLog({
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
  onReopen,
}: SessionLogProps) {
  const exercise = exercises.find((item) => item.id === selectedExerciseId) ?? null;
  const card = useRef<View>(null);

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
  // Reabrir el entreno se pregunta: el boton esta al lado de la hora de fin y un
  // dedazo ahi vuelve a abrir una sesion que ya estaba cerrada.
  const [reopening, setReopening] = useState(false);
  const [showTechnique, setShowTechnique] = useState(false);
  // Con que lo esta haciendo hoy. Null es "con lo que dice el catalogo".
  const [implement, setImplement] = useState<Implement | null>(
    (draft?.implement as Implement | null) ?? null,
  );
  // Cada cambio se guarda, para que cerrar la app a mitad de una serie no borre lo
  // que estaba escrito. Es una escritura suelta en la base, sin recargar nada.
  const report = useRef(onDraftChange);
  useEffect(() => {
    report.current = onDraftChange;
  }, [onDraftChange]);
  // El ejercicio abierto entra en las dependencias aunque no se escriba aqui: lo que se
  // guarda lleva dentro cual era, y si no se reescribe al cambiar de ejercicio el
  // borrador se queda apuntando al de antes.
  useEffect(() => {
    report.current({ weight: weightDraft, reps: repsDraft, rpe: rpeDraft, implement });
  }, [weightDraft, repsDraft, rpeDraft, implement, selectedExerciseId]);

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

  // Cambiar de ejercicio deja la tarjeta en blanco: lo escrito, la tecnica abierta y
  // el implemento eran de otro ejercicio. Se ajusta en el render y no en `pick` porque
  // el cambio tambien llega solo, cuando cierra las series de uno y se abre el
  // siguiente del plan.
  const [seen, setSeen] = useState(selectedExerciseId);
  if (selectedExerciseId !== seen) {
    setSeen(selectedExerciseId);
    setWeightDraft(null);
    setRepsDraft(null);
    setRpeDraft(null);
    setShowTechnique(false);
    setImplement(null);
  }

  // Estable, para que los renglones de la lista no se rearmen solo porque la funcion
  // de tocarlos es otra en cada render.
  const pick = useCallback(
    (exerciseId: string) => onSelectExercise(exerciseId),
    [onSelectExercise],
  );

  // Spec 5.1 pedia el salto real de la maquina, pero la P156 sube de 15 en 15 y casi
  // todas las torres traen un bloquecito de 5 lb que se añade aparte, asi que el
  // salto util es ese. En kilos el equivalente redondo son 2.5.
  const stepKg = unit === 'lb' ? toKg(5, 'lb') : 2.5;
  // El martillo y las laterales se hacen con mancuernas o en polea, y el numero que
  // escribe significa una cosa distinta en cada caso, asi que se elige aqui.
  // Las laterales y el martillo se hacen con mancuerna, en polea o en la maquina, y
  // el numero que escribe significa una cosa distinta en cada caso: con mancuerna es
  // el de una mano, con polea y con maquina ya es todo lo que movio.
  const swappable =
    exercise !== null &&
    (exercise.equipment_type === 'dumbbell' ||
      exercise.equipment_type === 'cable' ||
      exercise.equipment_type === 'machine');
  const doneWith = implement ?? exercise?.equipment_type ?? null;
  // Con mancuernas escribe lo que dice una, porque es lo que se lee agachado al
  // lado del rack. El volumen ya cuenta las dos por su cuenta.
  const perSide =
    doneWith === null
      ? false
      : isPerSide(doneWith, implement === null ? (exercise?.equipment?.kind ?? null) : null);
  const lastSet = todaySets.at(-1) ?? null;
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
      {/* Lo que lleva movido y cuanto lleva dentro, que son las dos cosas que mira
          cuando levanta la vista del banco. */}
      <Card>
        <View style={styles.header}>
          <View>
            <Text style={styles.heading}>VOLUMEN DE HOY</Text>
            <Text style={styles.volume}>
              {Math.round(fromKg(sessionVolume, unit))} {unit}
            </Text>
          </View>
          {startedAt !== null && (
            <View style={styles.clockSide}>
              <Text style={styles.heading}>{finishedAt === null ? 'ENTRENANDO' : 'DURÓ'}</Text>
              <Text style={styles.sessionClock}>
                {finishedAt === null ? (
                  <Elapsed key={startedAt} since={startedAt} />
                ) : (
                  clock((finishedAt - startedAt) / 1000)
                )}
              </Text>
            </View>
          )}
        </View>
      </Card>

      <>
        {/* Lista y no fila de chips: los nombres son largos, cada chip ocupaba un
            renglon entero igual, y asi se ve de un vistazo lo que falta de cada uno.
            El orden es alfabetico a proposito: se busca por nombre, no por plan. */}
        <Card title="Ejercicios">
          <View style={styles.exerciseList}>
            {visibleExercises.map((item) => (
              <ExerciseRow
                key={item.id}
                item={item}
                done={setsDoneByExercise.get(item.id) ?? 0}
                planned={plannedByExercise.get(item.id)}
                selected={item.id === selectedExerciseId}
                onPick={pick}
              />
            ))}
          </View>

          {inPlan.length > 0 && inPlan.length < exercises.length && (
            <Button
              label={showAll ? 'Solo la rutina de hoy' : 'Ver todos los ejercicios'}
              accessibilityLabel={
                showAll ? 'Ver solo la rutina de hoy' : 'Ver todos los ejercicios'
              }
              variant="ghost"
              onPress={() => setShowAll((open) => !open)}
              style={styles.more}
            />
          )}
        </Card>

        {/* La cartilla entera se sube cuando se toca cualquiera de los tres campos: el
            peso sin las repeticiones al lado no sirve de nada. */}
        {exercise && (
          <View ref={card} collapsable={false}>
            <Card title={exercise.name_es}>
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
                    style={({ pressed }) => [styles.info, pressed && styles.pressedSoft]}
                  >
                    <Text style={styles.infoText}>i</Text>
                  </Pressable>
                )}
                {swappable &&
                  IMPLEMENTS.map((option) => (
                    <Chip
                      key={option.id}
                      label={option.short}
                      accessibilityLabel={option.long}
                      selected={doneWith === option.id}
                      onPress={() => setImplement(option.id)}
                    />
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
                {lastSet?.timestamp ? (
                  <Elapsed
                    key={lastSet.timestamp}
                    since={lastSet.timestamp}
                    prefix=" · descansando "
                  />
                ) : null}
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
                    style={({ pressed }) => [styles.remove, pressed && styles.pressedSoft]}
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
                  La serie {drop.setIndex} bajó a {drop.reps} de {drop.firstSetReps} repeticiones
                  con {clock(drop.restSeconds)} de descanso. Spec 9: descansa lo suficiente para
                  sostener el 90% de la primera serie.
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
                        style={({ pressed }) => [styles.unit, pressed && styles.pressedSoft]}
                      >
                        <Text style={styles.unitText}>{unit}</Text>
                      </Pressable>
                    </View>
                    <View style={styles.cellRow}>
                      <Pressable
                        accessibilityLabel="Bajar peso"
                        onPress={() => nudge(-1)}
                        style={({ pressed }) => [styles.step, pressed && styles.stepPressed]}
                      >
                        <Minus size={18} color={theme.text} strokeWidth={1.75} />
                      </Pressable>
                      <NumericField
                        value={weight}
                        onChange={setWeightDraft}
                        allowDecimal={true}
                        accessibilityLabel="Peso"
                        reveals={card}
                        placeholder={unit}
                        style={styles.cellInput}
                        focusedStyle={styles.cellInputEditing}
                      />
                      <Pressable
                        accessibilityLabel="Subir peso"
                        onPress={() => nudge(1)}
                        style={({ pressed }) => [styles.step, pressed && styles.stepPressed]}
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
                        style={({ pressed }) => [styles.step, pressed && styles.stepPressed]}
                      >
                        <Minus size={18} color={theme.text} strokeWidth={1.75} />
                      </Pressable>
                      <NumericField
                        value={rpe}
                        onChange={setRpeDraft}
                        allowDecimal={false}
                        accessibilityLabel="RPE"
                        reveals={card}
                        placeholder="—"
                        style={styles.cellInput}
                        focusedStyle={styles.cellInputEditing}
                      />
                      <Pressable
                        accessibilityLabel="Subir RPE"
                        onPress={() => stepRpe(1)}
                        style={({ pressed }) => [styles.step, pressed && styles.stepPressed]}
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
                        style={({ pressed }) => [styles.step, pressed && styles.stepPressed]}
                      >
                        <Minus size={18} color={theme.text} strokeWidth={1.75} />
                      </Pressable>
                      <NumericField
                        value={reps}
                        onChange={setRepsDraft}
                        allowDecimal={false}
                        accessibilityLabel="Repeticiones"
                        reveals={card}
                        placeholder="0"
                        style={styles.cellInput}
                        focusedStyle={styles.cellInputEditing}
                      />
                      <Pressable
                        accessibilityLabel="Una repeticion mas"
                        onPress={() => stepReps(1)}
                        style={({ pressed }) => [styles.step, pressed && styles.stepPressed]}
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
            </Card>
          </View>
        )}

        {finishedAt === null ? (
          <Button
            label="Terminar entreno"
            icon={Check}
            size="large"
            block
            accessibilityLabel="Terminar entreno"
            onPress={onFinish}
            style={styles.finish}
          />
        ) : (
          <Card tone="warn">
            <Text style={styles.finished}>Entreno terminado a las {hhmm(finishedAt)}</Text>
            {/* Pegado al boton y no un modal: el teclado de la app vive en la raiz y
                un modal de iOS lo dejaria debajo. */}
            {reopening ? (
              <>
                <Text style={styles.confirmText}>
                  ¿Seguir entrenando? El entreno vuelve a quedar abierto.
                </Text>
                <View style={styles.confirmButtons}>
                  <Button
                    label="Sí, seguir"
                    accessibilityLabel="Sí, seguir entrenando"
                    variant="primary"
                    onPress={() => {
                      setReopening(false);
                      onReopen();
                    }}
                  />
                  <Button
                    label="No"
                    accessibilityLabel="No seguir entrenando"
                    onPress={() => setReopening(false)}
                  />
                </View>
              </>
            ) : (
              <Button
                label="Seguir entrenando"
                accessibilityLabel="Seguir entrenando"
                onPress={() => setReopening(true)}
              />
            )}
          </Card>
        )}
      </>
    </View>
  );
});

const styles = sheet((theme) => ({
  wrapper: {
    alignSelf: 'stretch',
    gap: 12,
  },
  // Lo que se ve en el instante del toque, antes de que el dato viaje a ningun lado.
  // Sin esto, entre el dedo y el numero no pasaba nada y el boton parecia trabado.
  pressedSoft: {
    opacity: 0.55,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  clockSide: {
    alignItems: 'flex-end',
  },
  heading: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 1,
    color: theme.textFaint,
  },
  volume: {
    fontSize: 30,
    fontFamily: font.display,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  sessionClock: {
    fontSize: 30,
    fontFamily: font.display,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },

  exerciseList: {
    alignSelf: 'stretch',
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  // El que esta abierto se pinta de amarillo entero: a un metro se ve cual es.
  exerciseRowSelected: {
    backgroundColor: theme.accent,
    borderBottomColor: theme.line,
  },
  exerciseMark: {
    width: 22,
    alignItems: 'center',
  },
  exerciseRowText: {
    flex: 1,
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.text,
  },
  exerciseRowTextSelected: {
    fontFamily: font.black,
    color: theme.accentInk,
  },
  exerciseRowTextDone: {
    color: theme.textFaint,
  },
  exerciseCount: {
    fontSize: 14,
    fontFamily: font.black,
    color: theme.textDim,
    fontVariant: ['tabular-nums'],
  },
  more: {
    alignSelf: 'flex-start',
  },

  machineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  machine: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.textFaint,
  },
  info: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 13,
    backgroundColor: theme.surfaceHigh,
  },
  infoText: {
    fontSize: 14,
    fontFamily: font.black,
    color: theme.text,
  },
  technique: {
    gap: 4,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surfaceHigh,
    padding: 10,
  },
  techniqueLine: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.text,
  },

  rest: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.textDim,
    fontVariant: ['tabular-nums'],
  },
  dropOff: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  lastLabel: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 0.8,
    color: theme.textFaint,
    textTransform: 'uppercase',
  },
  lastSets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Una serie de la vez pasada: se toca para copiarla, asi que se ve tocable.
  lastSet: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingHorizontal: 9,
    paddingVertical: 6,
    minWidth: 72,
  },
  lastSetIndex: {
    fontSize: 10,
    fontFamily: font.bold,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  lastSetLoad: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  lastSetReps: {
    fontSize: 12,
    fontFamily: font.bold,
    color: theme.textDim,
    fontVariant: ['tabular-nums'],
  },
  marks: {
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
    borderTopWidth: 1,
    borderTopColor: theme.lineSoft,
    paddingTop: 7,
  },
  setText: {
    flex: 1,
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  remove: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  removeText: {
    fontSize: 12,
    fontFamily: font.bold,
    color: theme.danger,
  },
  planned: {
    fontSize: 13,
    fontFamily: font.black,
    color: theme.textDim,
    fontVariant: ['tabular-nums'],
  },

  // Cuatro cuadrantes: peso y RPE arriba, repeticiones y el boton abajo. El pulgar
  // sabe donde va sin leer, que es lo que hace que se anote entre serie y serie.
  grid: {
    gap: 10,
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 12,
    marginTop: 2,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cell: {
    flex: 1,
    gap: 6,
  },
  cellHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 26,
  },
  cellLabel: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 1,
    color: theme.textFaint,
    textTransform: 'uppercase',
  },
  unit: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 6,
    backgroundColor: theme.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  unitText: {
    fontSize: 12,
    fontFamily: font.black,
    color: theme.accentInk,
  },
  cellRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
  },
  step: {
    width: 42,
    minHeight: 52,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepPressed: {
    backgroundColor: theme.accent,
  },
  cellInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    textAlign: 'center',
    fontSize: 21,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  cellInputEditing: {
    backgroundColor: theme.surfaceHigh,
  },
  serie: {
    minHeight: 52,
  },
  perSide: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
  },

  finish: {
    marginTop: 2,
  },
  finished: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.accentInk,
  },
  confirmText: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.accentInk,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 8,
  },
}));
