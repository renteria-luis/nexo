import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View, type StyleProp, type TextStyle } from 'react-native';

import { matchesSearch } from '../../nutrition/index.ts';
import { useAppData } from '../../shell/AppData.tsx';
import type { CatalogEntry, ExerciseCard, ExerciseRoutine } from '../../training/catalog.ts';
import { SWAPPABLE, type Swappable } from '../../training/queries.ts';
import type { EquipmentType } from '../../db/types.ts';
import { EQUIPMENT_NAMES, variantLabel } from '../../training/variants.ts';
import { SavedText } from '../SavedText.tsx';
import type { TimeBudget } from '../../training/routines.ts';

import { Button } from '../Button.tsx';
import { Card } from '../Card.tsx';
import { Chip } from '../Chip.tsx';
import { ChevronRight } from '../icons.ts';
import { MUSCLE_ES } from '../muscles.ts';
import { NumericField } from '../NumericField.tsx';
import { TextField } from '../TextField.tsx';
import { Toggle } from '../Toggle.tsx';
import { font, sheet, shape } from '../theme.ts';

import { Screen } from './Screen.tsx';

const IMPLEMENT_ES: Record<Swappable, string> = {
  dumbbell: 'Mancuerna',
  cable: 'Polea',
  machine: 'Máquina',
};

const BUDGETS: { id: TimeBudget; label: string }[] = [
  { id: 'completo', label: 'Completo' },
  { id: 'minus_25', label: '−25%' },
  { id: 'minus_50', label: '−50%' },
  { id: 'express', label: 'Express' },
];

const TIERS = [1, 2, 3, 4];
const TIER_ES: Record<number, string> = {
  1: 'núcleo',
  2: 'secundario',
  3: 'accesorio',
  4: 'opcional',
};

function NewExerciseForm({
  parent,
  onCreated,
  onCancel,
}: {
  parent?: ExerciseCard;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const { createExercise } = useAppData();
  const [name, setName] = useState('');
  const [muscle, setMuscle] = useState(parent?.exercise.primary_muscle ?? 'chest');
  const [secondary, setSecondary] = useState<string[]>(
    () =>
      parent?.variants
        .find((item) => item.id === parent.exercise.id)
        ?.muscles.filter((item) => item.contribution === 0.5)
        .map((item) => item.muscle) ?? [],
  );
  const [equipment, setEquipment] = useState<EquipmentType>(
    parent?.exercise.equipment_type ?? 'dumbbell',
  );
  const [unilateral, setUnilateral] = useState(false);
  const [rest, setRest] = useState(String(parent?.exercise.default_rest_seconds ?? 120));
  const [increment, setIncrement] = useState(String(parent?.exercise.load_increment ?? 2.5));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const writing = useRef(false);
  const save = async () => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const id = await createExercise({
        name,
        muscle,
        equipmentType: equipment,
        unilateral,
        restSeconds: Number(rest),
        loadIncrement: Number(increment),
        note,
        variantOf: parent?.familyId,
        secondaryMuscles: secondary.filter((item) => item !== muscle),
      });
      onCreated(id);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'No se pudo crear el ejercicio.');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  return (
    <Card title={parent ? `Nueva variante de ${parent.familyName}` : 'Nuevo ejercicio'}>
      <Field label="Nombre">
        <TextField
          value={name}
          onChange={setName}
          accessibilityLabel="Nombre del nuevo ejercicio"
          style={styles.input}
        />
      </Field>
      <Field label="Equipo">
        <View style={styles.chips}>
          {Object.entries(EQUIPMENT_NAMES).map(([id, label]) => (
            <Chip
              key={id}
              label={label}
              selected={equipment === id}
              onPress={() => setEquipment(id as EquipmentType)}
            />
          ))}
        </View>
      </Field>
      <Field label="Músculo principal">
        <View style={styles.chips}>
          {Object.entries(MUSCLE_ES).map(([id, label]) => (
            <Chip
              key={id}
              label={label}
              accessibilityLabel={`Principal ${label}`}
              selected={muscle === id}
              onPress={() => setMuscle(id)}
            />
          ))}
        </View>
      </Field>
      <Field label="Músculos secundarios (opcional)">
        <View style={styles.chips}>
          {Object.entries(MUSCLE_ES)
            .filter(([id]) => id !== muscle)
            .map(([id, label]) => (
              <Chip
                key={id}
                label={label}
                accessibilityLabel={`Secundario ${label}`}
                selected={secondary.includes(id)}
                onPress={() =>
                  setSecondary((current) =>
                    current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
                  )
                }
              />
            ))}
        </View>
      </Field>
      <SwitchRow
        label="Unilateral"
        value={unilateral}
        onChange={setUnilateral}
        hint="Un lado por vez; el cálculo incluye ambos lados."
      />
      <Field label="Descanso (segundos)">
        <NumericField
          value={rest}
          onChange={setRest}
          accessibilityLabel="Descanso del nuevo ejercicio"
          style={styles.input}
        />
      </Field>
      <Field label="Salto de peso (kg)">
        <NumericField
          value={increment}
          onChange={setIncrement}
          allowDecimal
          accessibilityLabel="Salto de peso del nuevo ejercicio"
          style={styles.input}
        />
      </Field>
      <Field label="Explicación">
        <TextField
          value={note}
          onChange={setNote}
          multiline
          accessibilityLabel="Explicación del nuevo ejercicio"
          style={[styles.input, styles.note]}
        />
      </Field>
      {problem && (
        <Text accessibilityRole="alert" style={styles.problem}>
          {problem}
        </Text>
      )}
      <Button
        label={busy ? 'Creando…' : 'Guardar nuevo ejercicio'}
        disabled={busy || !name.trim()}
        onPress={() => {
          void save();
        }}
      />
      <Button label="Cancelar creación" variant="ghost" disabled={busy} onPress={onCancel} />
    </Card>
  );
}

/** Un dato con su nombre encima, como en el registro del dia. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function SwitchRow({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchText}>
        <Text style={styles.switchLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Toggle value={value} accessibilityLabel={label} onChange={onChange} />
    </View>
  );
}

/**
 * Un numero que se guarda al dejar de escribirlo.
 *
 * Quien lo usa le pone de clave el valor guardado, asi que cuando la ficha vuelve de la
 * base con otro numero el campo se monta de nuevo y muestra el que quedo.
 */
function SavedNumber({
  value,
  onSave,
  accessibilityLabel,
  allowDecimal = false,
  placeholder,
  style,
}: {
  value: number | null;
  onSave: (next: number | null) => void;
  accessibilityLabel: string;
  allowDecimal?: boolean;
  placeholder?: string;
  style?: StyleProp<TextStyle>;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));

  return (
    <NumericField
      value={draft}
      onChange={setDraft}
      allowDecimal={allowDecimal}
      accessibilityLabel={accessibilityLabel}
      placeholder={placeholder}
      onCommit={() => {
        const parsed = draft.trim() === '' ? null : Number(draft);
        if (parsed !== null && !Number.isFinite(parsed)) return;
        if (parsed === value) return;
        onSave(parsed);
      }}
      style={style ?? styles.input}
      focusedStyle={styles.inputEditing}
    />
  );
}

/**
 * La lista del catalogo. La ficha de un ejercicio es otra ruta a proposito: asi el gesto
 * de volver del telefono vuelve a la lista, que es de donde salio, y no dos pantallas
 * atras a Ajustes.
 */
export function ExercisesScreen() {
  const { state, loadCatalog } = useAppData();
  const [creating, setCreating] = useState(false);
  const [archived, setArchived] = useState(false);
  const navigation = useNavigation<{
    navigate: (name: string, params: { exerciseId: string }) => void;
  }>();

  const [list, setList] = useState<CatalogEntry[] | null>(null);
  const [search, setSearch] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    // Se vuelve a leer cada vez que se entra: al volver de una ficha, lo que cambio ahi
    // tiene que verse aqui.
    const unsubscribe = navigation as unknown as {
      addListener?: (event: string, run: () => void) => () => void;
    };
    loadCatalog()
      .then(setList)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(error instanceof Error ? error.message : String(error));
      });
    return unsubscribe.addListener?.('focus', () => {
      loadCatalog()
        .then(setList)
        .catch((error: unknown) => console.error(error));
    });
  }, [loadCatalog, navigation]);

  if (state.phase !== 'ready') return <Screen title="Ejercicios">{null}</Screen>;

  const shown = (list ?? []).filter(
    (item) =>
      Boolean(item.archived) === archived &&
      matchesSearch([item.name, item.familyName, item.muscle], search),
  );

  return (
    <Screen title="Ejercicios">
      <Text style={styles.intro}>
        Tus ejercicios, variantes y explicaciones. Cada variante conserva su historial.
      </Text>
      <View style={styles.chips}>
        <Chip label="Activos" selected={!archived} onPress={() => setArchived(false)} />
        <Chip label="Archivados" selected={archived} onPress={() => setArchived(true)} />
      </View>
      <Button label="Crear ejercicio" onPress={() => setCreating(true)} />
      {creating && (
        <NewExerciseForm
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigation.navigate('Ejercicio', { exerciseId: id });
          }}
        />
      )}

      <TextField
        value={search}
        onChange={setSearch}
        autoCapitalize="none"
        accessibilityLabel="Buscar un ejercicio"
        placeholder="Buscar"
        style={styles.search}
      />

      {problem && <Text style={styles.problem}>{problem}</Text>}

      <Card>
        {shown.map((item, index) => (
          <View key={item.id} style={[styles.row, index > 0 && styles.ruled]}>
            <View style={styles.rowText}>
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowDetail}>
                {MUSCLE_ES[item.muscle] ?? item.muscle} · {EQUIPMENT_NAMES[item.equipmentType]}
                {item.unilateral ? ' · unilateral' : ''}
                {item.implements.length > 1
                  ? ` · ${item.implements.map((option) => IMPLEMENT_ES[option].toLowerCase()).join(', ')}`
                  : ''}
                {item.routines > 0
                  ? ` · en ${item.routines} rutina${item.routines > 1 ? 's' : ''}`
                  : ' · suelto'}
              </Text>
            </View>
            <Button
              label="Abrir"
              accessibilityLabel={`Editar ${item.name}`}
              variant="ghost"
              icon={ChevronRight}
              onPress={() => navigation.navigate('Ejercicio', { exerciseId: item.id })}
            />
          </View>
        ))}
        {shown.length === 0 && <Text style={styles.hint}>Ningún ejercicio con ese nombre.</Text>}
      </Card>
    </Screen>
  );
}

/** La ficha de un ejercicio: todo lo suyo, y cada cambio se guarda solo. */
export function ExerciseScreen() {
  const {
    state,
    loadExercise,
    editExercise,
    editExerciseNote,
    editExerciseGym,
    archiveExercise,
    editExerciseRoutine,
    editRoutineSets,
    editRoutineReps,
    editRoutineTier,
  } = useAppData();
  const route = useRoute<RouteProp<Record<string, { exerciseId: string }>, string>>();
  const exerciseId = route.params.exerciseId;
  const navigation = useNavigation<{
    navigate: (name: string, params: { exerciseId: string }) => void;
  }>();
  const [creatingVariant, setCreatingVariant] = useState(false);

  const [card, setCard] = useState<ExerciseCard | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const complain = useCallback((error: unknown) => {
    console.error(error);
    setProblem(error instanceof Error ? error.message : String(error));
  }, []);

  const request = useRef(0);
  const reload = useCallback(() => {
    const revision = ++request.current;
    loadExercise(exerciseId)
      .then((loaded) => {
        if (request.current === revision) setCard(loaded);
      })
      .catch(complain);
  }, [loadExercise, exerciseId, complain]);

  useEffect(reload, [reload]);
  const [seenId, setSeenId] = useState(exerciseId);
  if (seenId !== exerciseId) {
    setSeenId(exerciseId);
    setCreatingVariant(false);
  }

  /** Cada cambio se guarda solo y la ficha se vuelve a leer de la base. */
  const after = useCallback(
    (work: Promise<unknown>) => {
      work
        .then(() => {
          setProblem(null);
          reload();
        })
        .catch(complain);
    },
    [reload, complain],
  );

  if (state.phase !== 'ready' || card === null || card.exercise.id !== exerciseId)
    return (
      <Screen title="Ejercicio">
        {problem ? (
          <>
            <Text style={styles.problem}>{problem}</Text>
            <Button label="Reintentar" onPress={reload} />
          </>
        ) : (
          <Text style={styles.hint}>Cargando…</Text>
        )}
      </Screen>
    );

  const exercise = card.exercise;

  return (
    <Screen title={exercise.name_es}>
      {problem && <Text style={styles.problem}>{problem}</Text>}

      <Card>
        <Text style={styles.hint}>
          {MUSCLE_ES[exercise.primary_muscle] ?? exercise.primary_muscle} · {variantLabel(exercise)}
        </Text>

        <Field label="Nombre">
          <SavedText
            key={`${exercise.id}-name`}
            value={exercise.name_es}
            onSave={(name) => editExercise(exercise.id, { name })}
            accessibilityLabel="Nombre del ejercicio"
            style={styles.input}
            focusedStyle={styles.inputEditing}
          />
        </Field>

        <View style={styles.pair}>
          <Field label="Descanso (seg)">
            <SavedNumber
              key={`rest-${exercise.default_rest_seconds}`}
              value={exercise.default_rest_seconds}
              accessibilityLabel="Descanso en segundos"
              onSave={(next) => {
                if (next === null) return;
                after(editExercise(exercise.id, { restSeconds: next }));
              }}
            />
          </Field>
          <Field label="Salto de peso (kg)">
            <SavedNumber
              key={`step-${exercise.load_increment}`}
              value={exercise.load_increment}
              allowDecimal
              accessibilityLabel="Salto de peso"
              onSave={(next) => {
                if (next === null) return;
                after(editExercise(exercise.id, { loadIncrement: next }));
              }}
            />
          </Field>
        </View>

        <SwitchRow
          label="A un brazo"
          hint="El mismo número de series cuesta el doble de reloj."
          value={exercise.unilateral === 1}
          onChange={(next) => after(editExercise(exercise.id, { unilateral: next }))}
        />
      </Card>

      <Card title="Variantes">
        <Field label="Nombre de la familia">
          <SavedText
            key={`${card.familyId}-family`}
            value={card.familyName}
            onSave={(familyName) => editExercise(exercise.id, { familyName })}
            accessibilityLabel="Nombre de la familia"
            style={styles.input}
            focusedStyle={styles.inputEditing}
          />
        </Field>
        <Text style={styles.hint}>
          Al cambiar de variante durante el entreno, se reemplazan sus series pendientes. Cada una
          tiene sus propios pesos y tiempos.
        </Text>
        {card.variants.map((variant) => (
          <Button
            key={variant.id}
            label={`${variant.name_es} · ${variantLabel(variant)}${variant.archived ? ' · archivado' : ''}`}
            disabled={variant.id === exercise.id}
            onPress={() => navigation.navigate('Ejercicio', { exerciseId: variant.id })}
          />
        ))}
        <Button label="Crear variante" onPress={() => setCreatingVariant(true)} />
        {creatingVariant && (
          <NewExerciseForm
            parent={card}
            onCancel={() => setCreatingVariant(false)}
            onCreated={(id) => {
              setCreatingVariant(false);
              navigation.navigate('Ejercicio', { exerciseId: id });
            }}
          />
        )}
      </Card>

      <Card title="Explicación">
        <Text style={styles.hint}>
          Se guarda mientras escribes. Si existe una nota específica del equipo, se muestra antes
          que la general.
        </Text>
        <Field label="General">
          <SavedText
            key={`${exercise.id}-general`}
            value={card.notes[''] ?? ''}
            multiline
            onSave={(text) => editExerciseNote(exercise.id, '', text)}
            accessibilityLabel="Nota general"
            style={[styles.input, styles.note]}
            focusedStyle={styles.inputEditing}
          />
        </Field>
        {SWAPPABLE.filter((option) => card.notes[option] !== undefined).map((option) => (
          <Field key={option} label={`Nota con ${IMPLEMENT_ES[option].toLowerCase()}`}>
            <SavedText
              key={`${exercise.id}-${option}`}
              value={card.notes[option] ?? ''}
              multiline
              onSave={(text) => editExerciseNote(exercise.id, option, text)}
              accessibilityLabel={`Nota con ${IMPLEMENT_ES[option].toLowerCase()}`}
              style={[styles.input, styles.note]}
              focusedStyle={styles.inputEditing}
            />
          </Field>
        ))}
      </Card>
      <Card title="Catálogo">
        <Text style={styles.hint}>
          Archivar oculta esta variante de las nuevas selecciones y conserva sus series, notas e
          historial.
        </Text>
        <Button
          label={exercise.archived ? 'Restaurar ejercicio' : 'Archivar ejercicio'}
          onPress={() => after(archiveExercise(exercise.id, !exercise.archived))}
        />
      </Card>

      <Card title="Dónde lo tengo">
        <Text style={styles.hint}>
          El plan de una sesión solo propone lo que hay en ese gimnasio.
        </Text>
        {card.gyms.map((gym) => (
          <SwitchRow
            key={gym.id}
            label={gym.name}
            value={gym.available}
            onChange={(next) => after(editExerciseGym(exercise.id, gym.id, next))}
          />
        ))}
      </Card>

      <Card title="Añadir a una rutina">
        <Text style={styles.hint}>
          Los cambios se aplican a próximos entrenos. El plan de una sesión iniciada se edita desde
          Entreno.
        </Text>
        {card.availableRoutines.map((routine) => (
          <Button
            key={routine.id}
            label={`Añadir a ${routine.name}`}
            disabled={Boolean(exercise.archived)}
            onPress={() => after(editExerciseRoutine(exercise.id, routine.id, true))}
          />
        ))}
        {card.availableRoutines.length === 0 && (
          <Text style={styles.hint}>Ya está en todas tus rutinas.</Text>
        )}
      </Card>
      {card.routines.map((routine) => (
        <Card key={routine.routineId} title={`En ${routine.name}`}>
          <Button
            label={`Quitar de ${routine.name}`}
            variant="ghost"
            onPress={() => after(editExerciseRoutine(exercise.id, routine.routineId, false))}
          />
          <Text style={styles.hint}>
            Puesto {routine.position} de la rutina. Las series vacías lo dejan fuera con ese tiempo.
          </Text>

          <Field label="Importancia">
            <View style={styles.chips}>
              {TIERS.map((tier) => (
                <Chip
                  key={tier}
                  label={TIER_ES[tier]}
                  accessibilityLabel={`Importancia ${TIER_ES[tier]} en ${routine.name}`}
                  selected={routine.tier === tier}
                  onPress={() => after(editRoutineTier(routine.routineId, exercise.id, tier))}
                />
              ))}
            </View>
          </Field>

          <Field label={routine.tier === 1 ? 'Series' : 'Series por tiempo'}>
            {routine.tier === 1 && (
              <Text style={styles.hint}>
                Lo de núcleo no se recorta: hace las mismas series con cualquier tiempo. Para que se
                recorte, bájale la importancia.
              </Text>
            )}
            <View style={styles.sets}>
              {(routine.tier === 1 ? BUDGETS.slice(0, 1) : BUDGETS).map((budget) => (
                <View key={budget.id} style={styles.setsCell}>
                  <Text style={styles.setsLabel}>{budget.label}</Text>
                  <SavedNumber
                    key={`${routine.routineId}-${budget.id}-${setsOf(routine, budget.id) ?? 'x'}`}
                    value={setsOf(routine, budget.id)}
                    accessibilityLabel={`Series de ${routine.name} con tiempo ${budget.label}`}
                    placeholder="—"
                    style={styles.setsInput}
                    onSave={(sets) =>
                      after(editRoutineSets(routine.routineId, exercise.id, budget.id, sets))
                    }
                  />
                </View>
              ))}
            </View>
          </Field>

          <Field label="Repeticiones">
            <View style={styles.pair}>
              <SavedNumber
                key={`min-${routine.routineId}-${routine.repMin ?? 'x'}`}
                value={routine.repMin}
                accessibilityLabel={`Repeticiones minimas en ${routine.name}`}
                placeholder="mín"
                onSave={(next) =>
                  after(editRoutineReps(routine.routineId, exercise.id, next, routine.repMax))
                }
              />
              <SavedNumber
                key={`max-${routine.routineId}-${routine.repMax ?? 'x'}`}
                value={routine.repMax}
                accessibilityLabel={`Repeticiones maximas en ${routine.name}`}
                placeholder="máx"
                onSave={(next) =>
                  after(editRoutineReps(routine.routineId, exercise.id, routine.repMin, next))
                }
              />
            </View>
          </Field>
        </Card>
      ))}

      {card.routines.length === 0 && (
        <Card>
          <Text style={styles.hint}>
            No está en ninguna rutina: solo aparece al ver todos los ejercicios dentro del entreno.
          </Text>
        </Card>
      )}
    </Screen>
  );
}

function setsOf(routine: ExerciseRoutine, budget: TimeBudget): number | null {
  switch (budget) {
    case 'completo':
      return routine.setsFull;
    case 'minus_25':
      return routine.setsMinus25;
    case 'minus_50':
      return routine.setsMinus50;
    case 'express':
      return routine.setsExpress;
  }
}

const styles = sheet((theme) => ({
  intro: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  search: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: font.bold,
    color: theme.text,
  },
  problem: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.danger,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  ruled: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  rowDetail: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  field: {
    gap: 5,
  },
  label: {
    fontSize: 12,
    fontFamily: font.black,
    letterSpacing: 0.6,
    color: theme.textFaint,
    textTransform: 'uppercase',
  },
  hint: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
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
    fontFamily: font.bold,
    color: theme.text,
  },
  inputEditing: {
    backgroundColor: theme.surfaceHigh,
  },
  note: {
    minHeight: 72,
    textAlignVertical: 'top',
    fontFamily: font.regular,
  },
  pair: {
    flexDirection: 'row',
    gap: 10,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 44,
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 6,
  },
  switchText: {
    flexShrink: 1,
    gap: 2,
  },
  switchLabel: {
    fontSize: 15,
    fontFamily: font.bold,
    color: theme.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sets: {
    flexDirection: 'row',
    gap: 8,
  },
  setsCell: {
    flex: 1,
    gap: 4,
  },
  setsLabel: {
    fontSize: 11,
    fontFamily: font.bold,
    color: theme.textFaint,
    textAlign: 'center',
  },
  setsInput: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingVertical: 9,
    fontSize: 16,
    fontFamily: font.black,
    color: theme.text,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
}));
