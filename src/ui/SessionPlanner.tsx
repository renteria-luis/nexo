import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, Text, View } from 'react-native';

import type { GymLocation } from '../core/geo.ts';
import type { Company, TrainingRoutineRow } from '../db/types.ts';
import type { LocationOutcome } from '../shell/location.ts';
import type { PlannedExercise, RoutinePlan, TimeBudget } from '../training/index.ts';

import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { Chip } from './Chip.tsx';
import { Dumbbell, GripLines, MapPin, Moon, Play, Timer, Users, type LucideIcon } from './icons.ts';
import { font, hardShadow, sheet, shape, theme } from './theme.ts';

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

/**
 * Lo que mide una fila del orden.
 *
 * Fija a proposito: con una sola medida, saber donde caeria la fila es una division, y
 * sin ella habria que medir las siete y guardarse sus alturas para lo mismo.
 */
const ROW = 86;

/** Lo que se corre una fila que no es la que se arrastra, para abrirle el hueco. */
function shiftFor(index: number, from: number | null, to: number | null): number {
  // from menor que cero es "lo que se arrastraba ya no esta en la lista": sin esta
  // linea, las filas se quedaban corridas y montadas unas encima de otras.
  if (from === null || from < 0 || to === null || index === from) return 0;
  if (from < to && index > from && index <= to) return -ROW;
  if (from > to && index < from && index >= to) return ROW;
  return 0;
}

function reps(exercise: PlannedExercise): string {
  if (exercise.repMode === 'amrap') return 'al fallo técnico';
  if (exercise.repMode === 'failure') return 'al fallo';
  if (exercise.repMin === null || exercise.repMax === null) return '';
  return exercise.repMin === exercise.repMax
    ? `${exercise.repMin} repeticiones`
    : `${exercise.repMin} a ${exercise.repMax} repeticiones`;
}

/** Una decision del entreno, con su icono y su raya. Igual que el registro del dia. */
function Field({
  label,
  icon: Icon,
  first = false,
  children,
}: {
  label: string;
  icon: LucideIcon;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={[styles.field, !first && styles.ruled]}>
      <View style={styles.head}>
        <View style={styles.badge}>
          <Icon size={15} color={theme.text} strokeWidth={2.5} />
        </View>
        <Text style={styles.label}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

/**
 * El orden de hoy, y se puede cambiar antes de empezar.
 *
 * Se arrastra desde el asa de las tres rayas, y solo desde ahi: apoyar el dedo en ella
 * despega la fila en el acto, sin esperas, y de ahi sigue al dedo mientras las otras se
 * abren para hacerle sitio. Todo lo demas de la fila queda libre para leer, desplazar la
 * pantalla y tocar los botones de series. Hecho con el PanResponder de siempre y no con
 * una libreria de arrastre: todas piden Reanimated, y Reanimated es lo que tumbo la app
 * en septiembre (ver docs/sliders.md).
 *
 * Mientras una fila esta despegada, la pantalla deja de desplazarse: un arrastre
 * vertical dentro de un scroll es ambiguo y el scroll gana siempre.
 */
function Order({
  exercises,
  onReorder,
  onOverride,
  onDragging,
}: {
  exercises: PlannedExercise[];
  onReorder: (from: number, to: number) => void;
  onOverride: (exerciseId: string, direction: 1 | -1) => void;
  onDragging: (dragging: boolean) => void;
}) {
  const count = exercises.length;
  // Despegado se guarda por ejercicio y no por sitio. Por sitio, si el orden nuevo
  // llegaba un cuadro antes de apagar lo amarillo, lo amarillo le caia encima al que
  // acababa de ocupar ese sitio: el parpadeo que se veia al soltar.
  const [held, setHeld] = useState<string | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [pan] = useState(() => new Animated.Value(0));
  // Lo mismo en referencias: el gesto las lee fuera del render.
  const holding = useRef<string | null>(null);
  const started = useRef<number | null>(null);
  const landing = useRef<number | null>(null);

  const lift = useCallback(
    (exerciseId: string, index: number) => {
      // En cero antes de empezar y no al soltar: asi soltar no depende de que un valor
      // animado llegue a tiempo.
      pan.setValue(0);
      holding.current = exerciseId;
      started.current = index;
      landing.current = index;
      setHeld(exerciseId);
      setTarget(index);
      onDragging(true);
    },
    [onDragging, pan],
  );

  const stop = useCallback(() => {
    const id = holding.current;
    const from = started.current;
    const to = landing.current;
    holding.current = null;
    started.current = null;
    landing.current = null;

    // Se limpia siempre, haya habido arrastre o no. Si solo se limpiaba cuando lo habia,
    // un segundo aviso de soltar (llegan dos: el del dedo y el del gesto) podia dejar
    // puesto lo despegado y las filas se quedaban corridas, montadas unas sobre otras.
    // Soltar es un solo cambio de estado y ninguna animacion: la fila deja de seguir al
    // dedo porque deja de estar despegada, no porque se mueva un valor animado por otro
    // camino que puede llegar un cuadro despues.
    setHeld(null);
    setTarget(null);
    onDragging(false);
    if (id !== null && from !== null && to !== null && to !== from) onReorder(from, to);
  }, [onDragging, onReorder]);

  const drag = useMemo(() => {
    // Los manejadores corren al arrastrar, nunca durante el render, que es lo unico
    // que la regla de las referencias quiere evitar.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: () => holding.current !== null,
      // Que nadie se lo quite a medias: el carrusel de pestanas lo pedia en cuanto el
      // dedo se iba un poco a un lado.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderMove: (_event, gesture) => {
        const from = started.current;
        if (from === null) return;
        pan.setValue(gesture.dy);
        const to = Math.max(0, Math.min(count - 1, from + Math.round(gesture.dy / ROW)));
        if (to !== landing.current) {
          landing.current = to;
          setTarget(to);
        }
      },
      onPanResponderRelease: stop,
      onPanResponderTerminate: stop,
    });
  }, [count, pan, stop]);

  const from = held === null ? null : exercises.findIndex((item) => item.exerciseId === held);

  return (
    <View {...drag.panHandlers}>
      {exercises.map((exercise, index) => {
        const lifted = exercise.exerciseId === held;
        return (
          <Animated.View
            key={exercise.exerciseId}
            style={[
              styles.row,
              index > 0 && styles.ruled,
              lifted && styles.rowLifted,
              { transform: [{ translateY: lifted ? pan : shiftFor(index, from, target) }] },
            ]}
          >
            {/* El asa, y lo unico que arrastra. Ocupa todo el alto de la fila para que
                sea facil de agarrar, y lleva el numero debajo de las rayas porque el
                orden es justo lo que se esta cambiando. */}
            <View
              accessibilityLabel={`Mover ${exercise.name} de sitio`}
              onTouchStart={() => lift(exercise.exerciseId, index)}
              onTouchEnd={stop}
              onTouchCancel={stop}
              style={styles.handle}
            >
              <GripLines size={18} color={theme.textFaint} strokeWidth={2.5} />
              <View style={styles.number}>
                <Text style={styles.numberText}>{index + 1}</Text>
              </View>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.exercise} numberOfLines={2}>
                {exercise.name}
              </Text>
              <Text style={styles.detail} numberOfLines={1}>
                {exercise.sets} × {reps(exercise)} · {TIER_ES[exercise.tier]} · desc.{' '}
                {Math.round(exercise.restSeconds / 60)} min
                {exercise.unilateral ? ' · por brazo' : ''}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={`Una serie menos de ${exercise.name}`}
              onPress={() => onOverride(exercise.exerciseId, -1)}
              style={({ pressed }) => [styles.nudge, pressed && styles.nudgePressed]}
            >
              <Text style={styles.nudgeText}>−</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`Una serie más de ${exercise.name}`}
              onPress={() => onOverride(exercise.exerciseId, 1)}
              style={({ pressed }) => [styles.nudge, pressed && styles.nudgePressed]}
            >
              <Text style={styles.nudgeText}>+</Text>
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

export type SessionPlannerProps = {
  routines: TrainingRoutineRow[];
  gyms: GymLocation[];
  /** One reading, taken only when he asks for it (spec 5.2). */
  onLocate: () => Promise<LocationOutcome>;
  onLoadPlan: (routineId: string, budget: TimeBudget, gymId: string | null) => Promise<RoutinePlan>;
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
  /** Para que la pantalla deje de desplazarse mientras arrastra una fila del orden. */
  onDragging: (dragging: boolean) => void;
};

/**
 * Spec 8.5: gym and routine first, then the time he has, then the trimmed plan for
 * approval. Spec 8.3 rule 7 is the reason this screen exists at all: the trim is
 * never applied behind his back. The gym step waits for the geofence (spec 5.2).
 *
 * La lista de abajo va numerada porque su orden significa algo: es el orden en que
 * dice que los va a hacer, y es el que sigue el selector de la pantalla de entreno
 * cuando termina las series de uno.
 */
export function SessionPlanner({
  routines,
  gyms,
  onLocate,
  onLoadPlan,
  onStart,
  restDay,
  onRestDay,
  onDragging,
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
    // El gimnasio entra en el plan: el mismo hueco se hace con la maquina, la polea o
    // la mancuerna segun lo que haya enfrente.
    onLoadPlan(selected, budget, gymId)
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
  }, [selected, budget, gymId, onLoadPlan]);

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

  const reorder = (from: number, to: number) =>
    setExercises((current) => {
      const moved = current.slice();
      const [taken] = moved.splice(from, 1);
      moved.splice(to, 0, taken);
      // La posicion que se guarda es la del orden nuevo: es la que lee la sesion para
      // saber cual abrir primero y cual sigue.
      return moved.map((exercise, index) => ({ ...exercise, position: index + 1 }));
    });

  return (
    <View style={styles.wrapper}>
      <Card title="Entreno de hoy">
        <Field label="Dónde" icon={MapPin} first>
          <View style={styles.chips}>
            {gyms.map((gym) => (
              <Chip
                key={gym.id}
                label={gym.name}
                accessibilityLabel={`Gimnasio ${gym.name}`}
                selected={gym.id === gymId}
                onPress={() => {
                  setGymId(gym.id);
                  setWhereNote(null);
                }}
              />
            ))}
            <Button
              label="Usar mi ubicación"
              accessibilityLabel="Usar mi ubicación"
              loading={locating}
              onPress={() => {
                setLocating(true);
                setWhereNote('Buscando…');
                onLocate()
                  .then((outcome) => {
                    if (outcome.kind === 'match') {
                      setGymId(outcome.fix.gym.id);
                      setWhereNote(
                        `${outcome.fix.gym.name}, a ${Math.round(outcome.fix.distanceM)} m`,
                      );
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
            />
          </View>
          {whereNote && <Text style={styles.note}>{whereNote}</Text>}
        </Field>

        <Field label="Rutina" icon={Dumbbell}>
          <View style={styles.chips}>
            {routines.map((routine) => (
              <Chip
                key={routine.id}
                label={routine.name}
                accessibilityLabel={`Rutina ${routine.name}`}
                selected={routine.id === selected}
                onPress={() => setRoutineId(routine.id)}
              />
            ))}
          </View>
        </Field>

        <Field label="Con quién" icon={Users}>
          <View style={styles.chips}>
            {(
              [
                ['alone', 'Solo'],
                ['with_someone', 'Acompañado'],
              ] as const
            ).map(([id, label]) => (
              <Chip
                key={id}
                label={label}
                selected={company === id}
                onPress={() => setCompany((current) => (current === id ? null : id))}
              />
            ))}
          </View>
        </Field>

        <Field label="Tiempo que tengo" icon={Timer}>
          <View style={styles.chips}>
            {BUDGETS.map((option) => (
              <Chip
                key={option.id}
                label={option.label}
                accessibilityLabel={`Tiempo ${option.label}`}
                selected={option.id === budget}
                onPress={() => setBudget(option.id)}
              />
            ))}
          </View>
        </Field>
      </Card>

      {problem && <Text style={styles.problem}>{problem}</Text>}

      {exercises.length > 0 && (
        <Card title="El orden de hoy">
          <Text style={styles.note}>
            En este orden los vas a hacer, y al completar las series de uno allá adentro se abre el
            siguiente solo. Mantén apretado un ejercicio para moverlo de sitio. Con − y + le quitas
            o le pones series.
          </Text>

          <Order
            exercises={exercises}
            onReorder={reorder}
            onOverride={override}
            onDragging={onDragging}
          />

          {plan && (
            <Text style={styles.estimate}>
              {exercises.length} ejercicios · unos {Math.round(seconds / 60)} min
            </Text>
          )}
        </Card>
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
      />

      {restDay ? (
        <Card tone="ok">
          <Text style={styles.restNote}>
            Hoy es descanso. Cuenta como día planeado, así que no penaliza nada.
          </Text>
        </Card>
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

const styles = sheet((theme) => ({
  wrapper: {
    alignSelf: 'stretch',
    gap: 12,
  },
  field: {
    gap: 8,
    paddingVertical: 10,
  },
  ruled: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 6,
    backgroundColor: theme.surfaceHigh,
  },
  label: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  note: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
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
    height: ROW,
  },
  // Despegada: amarilla, con mas sombra y por encima de las otras.
  rowLifted: {
    zIndex: 2,
    backgroundColor: theme.accent,
    borderRadius: shape.radiusSmall,
    borderTopColor: theme.line,
    paddingHorizontal: 6,
    ...hardShadow(theme, 5),
  },
  // Columna estrecha y de todo el alto: facil de agarrar y no le quita sitio al nombre.
  handle: {
    width: 34,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  // El numero es el orden de verdad, no un adorno: es el que sigue el selector.
  number: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 6,
    backgroundColor: theme.accent,
  },
  numberText: {
    fontSize: 14,
    fontFamily: font.black,
    color: theme.accentInk,
    fontVariant: ['tabular-nums'],
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  exercise: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  detail: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  nudge: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgePressed: {
    backgroundColor: theme.accent,
  },
  nudgeText: {
    fontSize: 17,
    fontFamily: font.black,
    color: theme.text,
  },
  estimate: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  restNote: {
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.accentInk,
  },
}));
