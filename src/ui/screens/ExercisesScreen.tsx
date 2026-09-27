import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, View, type StyleProp, type TextStyle } from 'react-native';

import { matchesSearch } from '../../nutrition/index.ts';
import { useAppData } from '../../shell/AppData.tsx';
import type { CatalogEntry, ExerciseCard, ExerciseRoutine } from '../../training/catalog.ts';
import { SWAPPABLE, type Swappable } from '../../training/queries.ts';
import type { TimeBudget } from '../../training/routines.ts';

import { Button } from '../Button.tsx';
import { Card } from '../Card.tsx';
import { Chip } from '../Chip.tsx';
import { ChevronRight } from '../icons.ts';
import { MUSCLE_ES } from '../muscles.ts';
import { NumericField } from '../NumericField.tsx';
import { Toggle } from '../Toggle.tsx';
import { font, sheet, shape, theme } from '../theme.ts';

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

  const shown = (list ?? []).filter((item) => matchesSearch([item.name, item.muscle], search));

  return (
    <Screen title="Ejercicios">
      <Text style={styles.intro}>
        Todo lo que la app sabe de cada ejercicio, para cambiarlo sin pedirlo: con qué se puede
        hacer, qué dice su (i), en qué gimnasio lo tienes y cuántas series le toca en cada rutina y
        con cada tiempo.
      </Text>

      <TextInput
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Buscar un ejercicio"
        placeholder="Buscar"
        placeholderTextColor={theme.textGhost}
        style={styles.search}
      />

      {problem && <Text style={styles.problem}>{problem}</Text>}

      <Card>
        {shown.map((item, index) => (
          <View key={item.id} style={[styles.row, index > 0 && styles.ruled]}>
            <View style={styles.rowText}>
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowDetail}>
                {MUSCLE_ES[item.muscle] ?? item.muscle}
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
    editRoutineSets,
    editRoutineReps,
    editRoutineTier,
  } = useAppData();
  const route = useRoute<RouteProp<Record<string, { exerciseId: string }>, string>>();
  const exerciseId = route.params.exerciseId;

  const [card, setCard] = useState<ExerciseCard | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const complain = useCallback((error: unknown) => {
    console.error(error);
    setProblem(error instanceof Error ? error.message : String(error));
  }, []);

  const reload = useCallback(() => {
    loadExercise(exerciseId).then(setCard).catch(complain);
  }, [loadExercise, exerciseId, complain]);

  useEffect(reload, [reload]);

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

  if (state.phase !== 'ready' || card === null) return <Screen>{null}</Screen>;

  const exercise = card.exercise;

  return (
    <Screen title={exercise.name_es}>
      {problem && <Text style={styles.problem}>{problem}</Text>}

      <Card>
        <Text style={styles.hint}>
          {MUSCLE_ES[exercise.primary_muscle] ?? exercise.primary_muscle} ·{' '}
          {exercise.equipment_type}
        </Text>

        <Field label="Nombre">
          <TextInput
            defaultValue={exercise.name_es}
            onEndEditing={(event) => {
              const next = event.nativeEvent.text.trim();
              if (next !== '' && next !== exercise.name_es) {
                after(editExercise(exercise.id, { name: next }));
              }
            }}
            accessibilityLabel="Nombre del ejercicio"
            style={styles.input}
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

      <Card title="Con qué se hace">
        <Text style={styles.hint}>
          Con dos o más, en el entreno salen los botones para elegir. Con uno o ninguno no hay nada
          que elegir y no sale ninguno.
        </Text>
        {SWAPPABLE.map((option) => (
          <SwitchRow
            key={option}
            label={IMPLEMENT_ES[option]}
            value={card.implements.includes(option)}
            onChange={(next) =>
              after(
                editExercise(exercise.id, {
                  implements: next
                    ? [...card.implements, option]
                    : card.implements.filter((kept) => kept !== option),
                }),
              )
            }
          />
        ))}
      </Card>

      <Card title="Lo que dice la (i)">
        <Text style={styles.hint}>
          La nota general vale siempre; la de un implemento manda cuando lo estás haciendo con ese.
          Vacía la borra.
        </Text>

        <Field label="General">
          <TextInput
            defaultValue={card.notes[''] ?? ''}
            multiline
            onEndEditing={(event) =>
              after(editExerciseNote(exercise.id, '', event.nativeEvent.text))
            }
            accessibilityLabel="Nota general"
            style={[styles.input, styles.note]}
          />
        </Field>

        {card.implements.map((option) => (
          <Field key={option} label={IMPLEMENT_ES[option]}>
            <TextInput
              defaultValue={card.notes[option] ?? ''}
              multiline
              onEndEditing={(event) =>
                after(editExerciseNote(exercise.id, option, event.nativeEvent.text))
              }
              accessibilityLabel={`Nota con ${IMPLEMENT_ES[option].toLowerCase()}`}
              style={[styles.input, styles.note]}
            />
          </Field>
        ))}
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

      {card.routines.map((routine) => (
        <Card key={routine.routineId} title={`En ${routine.name}`}>
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
