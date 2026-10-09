import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, Text, View } from 'react-native';

import type { GymLocation } from '../core/geo.ts';
import type { Company, TrainingRoutineRow } from '../db/types.ts';
import type { LocateMode, LocationOutcome } from '../shell/location.ts';
import {
  estimateSeconds,
  overrideSets,
  serializePlannerDraft,
  toStart,
  withPlannerEdits,
  type PlannedExercise,
  type PlannerDraft,
  type RoutinePlan,
  type TimeBudget,
} from '../training/index.ts';

import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { clockFace } from '../training/pace.ts';

import { Chip } from './Chip.tsx';
import { clock } from './Elapsed.tsx';
import { IconButton } from './IconButton.tsx';
import { ConfirmAction } from './InfoBubble.tsx';
import {
  Dumbbell,
  GripLines,
  MapPin,
  Moon,
  Navigation,
  Play,
  Timer,
  Users,
  type LucideIcon,
} from './icons.ts';
import { font, hardShadow, pressed as pressedInto, sheet, shape, theme } from './theme.ts';

const BUDGETS: { id: TimeBudget; label: string }[] = [
  { id: 'completo', label: 'Completo' },
  { id: 'minus_25', label: '−25%' },
  { id: 'minus_50', label: '−50%' },
  { id: 'express', label: 'Express' },
];

/** Lo que espera al entrar a la pestana: cruzarla de camino a Comida no pide nada. */
const AUTO_DWELL_MS = 400;

/**
 * Hasta cuando la flecha sigue girando. La lectura nativa no se puede cancelar y sigue
 * su curso; lo que conteste despues de esto ya no cambia nada.
 */
const LOCATE_DEADLINE_MS = 20_000;

const WHERE_NOTES: Record<Exclude<LocationOutcome['kind'], 'match'>, string> = {
  elsewhere: 'No estás en ninguno de los gimnasios guardados.',
  unsure: 'La ubicación no es lo bastante precisa: elige a mano.',
  denied: 'Sin permiso de ubicación.',
};

/**
 * "Fit4Less" y no "Fit4Less Proudfoot", para que los tres y la flecha quepan en una fila.
 * Si dos empezaran igual van enteros; el nombre completo es siempre el que lee VoiceOver.
 */
function gymLabel(gym: GymLocation, gyms: readonly GymLocation[]): string {
  const first = gym.name.split(' ')[0];
  return gyms.some((other) => other.id !== gym.id && other.name.split(' ')[0] === first)
    ? gym.name
    : first;
}

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

/** Corto a proposito: "12-15" y no "12 a 15 repeticiones", que es lo mismo tres veces. */
function reps(exercise: PlannedExercise): string {
  if (exercise.repMode === 'amrap') return 'al fallo técnico';
  if (exercise.repMode === 'failure') return 'al fallo';
  if (exercise.repMin === null || exercise.repMax === null) return '';
  return exercise.repMin === exercise.repMax
    ? String(exercise.repMin)
    : `${exercise.repMin}-${exercise.repMax}`;
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
/**
 * Una fila del orden, con su propio gesto.
 *
 * El gesto vive en cada asa y no en la lista entera, y reclama el toque **al apoyar el
 * dedo** (`onStartShouldSetPanResponderCapture`), no al moverlo. Esa es la diferencia
 * entre arrastrar y no: el desplazamiento de la pantalla es nativo y empieza con el
 * primer milimetro, asi que pedirlo despues llegaba tarde y se iba la pantalla en vez de
 * la fila.
 *
 * Y con el toque tomado desde el principio no hace falta apagar nada alrededor: el
 * desplazamiento de la pantalla y el de las pestanas preguntan antes de llevarselo y
 * aqui se les dice que no (`onPanResponderTerminationRequest`). Apagarlos por estado era
 * ademas lo que dejaba filas colgadas: cambiar esas propiedades con el dedo encima hace
 * que iOS cancele el toque, y entonces no llegaba ni el soltar ni el aviso de cancelado.
 */
const OrderRow = memo(function OrderRow({
  exercise,
  index,
  lifted,
  shift,
  pan,
  onLift,
  onMove,
  onDrop,
  onOverride,
}: {
  exercise: PlannedExercise;
  index: number;
  lifted: boolean;
  shift: number;
  pan: Animated.Value;
  onLift: (exerciseId: string, index: number) => void;
  onMove: (dy: number) => void;
  onDrop: () => void;
  onOverride: (exerciseId: string, direction: 1 | -1) => void;
}) {
  const drag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        // Que nadie se lo quite a medias: el carrusel de pestanas lo pedia en cuanto el
        // dedo se iba un poco a un lado.
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => onLift(exercise.exerciseId, index),
        onPanResponderMove: (_event, gesture) => onMove(gesture.dy),
        onPanResponderRelease: onDrop,
        onPanResponderTerminate: onDrop,
        // Y por si acaso: este llega tanto al soltar como al cancelar, y soltar dos
        // veces no hace nada.
        onPanResponderEnd: onDrop,
      }),
    [exercise.exerciseId, index, onLift, onMove, onDrop],
  );

  return (
    <Animated.View
      // Mientras se mueve, la fila se dibuja una vez y se desplaza esa imagen: la sombra
      // dura, que iOS recalcula en cada cuadro, es lo que hacia que el arrastre se
      // sintiera pesado.
      shouldRasterizeIOS={lifted}
      style={[
        styles.row,
        index > 0 && styles.ruled,
        lifted && styles.rowLifted,
        { transform: [{ translateY: lifted ? pan : shift }] },
      ]}
    >
      {/* El asa, y lo unico que arrastra: el resto de la fila queda libre para leer,
          desplazar la pantalla y tocar los botones de series. */}
      <View
        accessibilityLabel={`Mover ${exercise.name} de sitio`}
        style={styles.handle}
        {...drag.panHandlers}
      >
        <GripLines size={20} color={theme.textFaint} strokeWidth={2.5} />
      </View>

      <View style={styles.rowText}>
        <Text style={styles.exercise} numberOfLines={2}>
          {exercise.name}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {exercise.sets} × {reps(exercise)} · {TIER_ES[exercise.tier]} ·{' '}
          {clock(exercise.restSeconds)}
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
});

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

  const stop = useCallback(
    (commit = true) => {
      const id = holding.current;
      const from = started.current;
      const to = landing.current;
      holding.current = null;
      started.current = null;
      landing.current = null;

      // Y el valor animado a cero tambien aqui, no solo al empezar. El ultimo
      // movimiento puede llegar a la vista despues del render que la suelta, y entonces
      // la fila se queda corrida encima de otra: por eso pasaba mas cuanto mas rapido
      // se soltaba, que es cuando el movimiento y el soltar caen en el mismo cuadro.
      pan.setValue(0);

      // Se limpia siempre, haya habido arrastre o no. Si solo se limpiaba cuando lo
      // habia, un segundo aviso de soltar podia dejar puesto lo despegado y las filas se
      // quedaban corridas, montadas unas sobre otras.
      setHeld(null);
      setTarget(null);
      if (id === null) return;

      onDragging(false);
      if (commit && from !== null && to !== null && to !== from) onReorder(from, to);
    },
    [onDragging, onReorder, pan],
  );

  const move = useCallback(
    (dy: number) => {
      const from = started.current;
      if (from === null) return;

      // Fuera de la lista se suelta solo y vuelve a su sitio, sin mover nada: sacar una
      // fila a la cartilla de arriba no significa nada, y dejarla ahi colgada menos.
      if (dy < -(from + 1) * ROW || dy > (count - from) * ROW) {
        stop(false);
        return;
      }

      pan.setValue(dy);
      // Medio renglon es el cambio: a partir de ahi la fila tapa mas de la mitad de la
      // de al lado, y soltarla ahi es cambiarlas de sitio.
      const to = Math.max(0, Math.min(count - 1, from + Math.round(dy / ROW)));
      if (to !== landing.current) {
        landing.current = to;
        setTarget(to);
      }
    },
    [count, pan, stop],
  );

  const from = held === null ? null : exercises.findIndex((item) => item.exerciseId === held);

  return (
    <View>
      {exercises.map((exercise, index) => (
        <OrderRow
          key={exercise.exerciseId}
          exercise={exercise}
          index={index}
          lifted={exercise.exerciseId === held}
          shift={shiftFor(index, from, target)}
          pan={pan}
          onLift={lift}
          onMove={move}
          onDrop={stop}
          onOverride={onOverride}
        />
      ))}
    </View>
  );
}

export type SessionPlannerProps = {
  routines: TrainingRoutineRow[];
  gyms: GymLocation[];
  /** Lo que habia elegido hoy. Se lee al montar y despues manda lo que toque. */
  draft: PlannerDraft;
  onSaveDraft: (draft: PlannerDraft) => Promise<void>;
  /** Spec 5.2: una lectura sola al entrar, y otra cada vez que toca la flecha. */
  onLocate: (mode: LocateMode) => Promise<LocationOutcome>;
  /** La pestana enfrente y la app abierta: solo asi se lee sola. */
  visible: boolean;
  onLoadPlan: (routineId: string, budget: TimeBudget, gymId: string | null) => Promise<RoutinePlan>;
  /** La que le toca por el patron de la semana, que es la que viene puesta. */
  onLoadOwedRoutine: () => Promise<string | null>;
  onStart: (
    routineId: string,
    budget: TimeBudget,
    exercises: PlannedExercise[],
    company?: Company,
    gymId?: string,
  ) => void;
  busy?: boolean;
  startProblem?: ReactNode;
  /** Spec 4.3: un descanso dicho a tiempo no es un entreno fallado. */
  restDay: boolean;
  onRestDay: () => void;
  /** Para que la pantalla no se desplace mientras arrastra una fila del orden. */
  onDragging: (dragging: boolean) => void;
};

/**
 * El gimnasio es obligatorio desde que existe "Otro" (migracion 048): antes no se podia
 * decir la verdad cuando estaba en otro sitio, y una sesion sin gimnasio deja sin
 * explicacion los pesos que no cuadran con los de siempre.
 *
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
  draft,
  onSaveDraft,
  onLocate,
  visible,
  onLoadPlan,
  onLoadOwedRoutine,
  onStart,
  busy = false,
  startProblem,
  restDay,
  onRestDay,
  onDragging,
}: SessionPlannerProps) {
  // Lo guardado, pero sin una rutina o un gimnasio que ya no existen: con ellos el plan
  // no carga, o el entreno empieza en un sitio que no esta en la lista.
  const [saved] = useState(() => {
    const lostRoutine =
      draft.routineId !== null && !routines.some((routine) => routine.id === draft.routineId);
    const lostGym = draft.gymId !== null && !gyms.some((gym) => gym.id === draft.gymId);
    return {
      draft: {
        ...draft,
        routineId: lostRoutine ? null : draft.routineId,
        gymId: lostGym ? null : draft.gymId,
        edits: lostRoutine || lostGym ? null : draft.edits,
      },
      notice: lostRoutine
        ? 'La rutina que habías elegido ya no está: va la que te toca.'
        : lostGym
          ? 'El gimnasio que habías elegido ya no está: elige otro.'
          : null,
    };
  });
  const [routineId, setRoutineId] = useState<string | null>(saved.draft.routineId);
  const [budget, setBudget] = useState<TimeBudget>(saved.draft.budget);
  const [company, setCompany] = useState<Company>(saved.draft.company);
  const [gymId, setGymId] = useState<string | null>(saved.draft.gymId);
  const [locating, setLocating] = useState(false);
  const [whereNote, setWhereNote] = useState<string | null>(null);
  const [plan, setPlan] = useState<RoutinePlan | null>(null);
  const [exercises, setExercises] = useState<PlannedExercise[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [planFor, setPlanFor] = useState<string | null>(null);
  // Si el orden o las series de este plan son suyos y no los que salen solos.
  const [edited, setEdited] = useState(false);
  const [notice, setNotice] = useState<string | null>(saved.notice);
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  // Lo que cambio en el plan antes de cerrar la app, para el primer plan que cargue.
  const restore = useRef(saved.draft.edits);

  // Cada lectura toma un turno, y elegir un gimnasio a mano, irse de la pestana o pasarse
  // del plazo lo cambian: una respuesta que llega despues ya no es de nadie y no pisa nada.
  const turn = useRef(0);
  const locate = useCallback(
    (mode: LocateMode) => {
      const mine = ++turn.current;
      const manual = mode === 'manual';
      // La sola no se ve: busca y, si encuentra, marca el gimnasio. Solo la flecha que el
      // toco se queda hundida mientras espera.
      setLocating(manual);
      if (manual) setWhereNote('Buscando…');
      const deadline = setTimeout(() => {
        if (mine !== turn.current) return;
        turn.current += 1;
        setLocating(false);
        if (manual) setWhereNote('La ubicación no llegó a tiempo: elige a mano.');
      }, LOCATE_DEADLINE_MS);
      onLocate(mode)
        .then((outcome) => {
          if (mine !== turn.current) return;
          if (outcome.kind === 'match') {
            setGymId(outcome.fix.gym.id);
            setWhereNote(`${outcome.fix.gym.name}, a ${Math.round(outcome.fix.distanceM)} m`);
          } else if (manual) {
            // Sin coincidencia el gimnasio elegido se queda, y la sola no dice nada: no la pidio.
            setWhereNote(WHERE_NOTES[outcome.kind]);
          }
        })
        .catch((error: unknown) => {
          console.error(error);
          if (manual && mine === turn.current) {
            setWhereNote(error instanceof Error ? error.message : String(error));
          }
        })
        .finally(() => {
          clearTimeout(deadline);
          if (mine === turn.current) setLocating(false);
        });
    },
    [onLocate],
  );

  // Con la pestana enfrente, una lectura sola, despues de un respiro. Al irse, lo que
  // estuviera en camino ya no cuenta.
  useEffect(() => {
    if (!visible) {
      turn.current += 1;
      return;
    }
    const timer = setTimeout(() => locate('auto'), AUTO_DWELL_MS);
    return () => clearTimeout(timer);
  }, [visible, locate]);

  // La que toca por la semana. Hasta que llega no se elige ninguna, para no cargar el plan
  // de empuje y cambiarlo enseguida.
  const [owed, setOwed] = useState<{ id: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    onLoadOwedRoutine()
      .then((id) => {
        if (!cancelled) setOwed({ id });
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setProblem(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [onLoadOwedRoutine]);

  const selected = routineId ?? (owed === null ? null : (owed.id ?? routines[0]?.id ?? null));
  const requestedPlan = JSON.stringify([selected, budget, gymId]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    // El gimnasio entra en el plan: el mismo hueco se hace con la maquina, la polea o
    // la mancuerna segun lo que haya enfrente.
    onLoadPlan(selected, budget, gymId)
      .then((loaded) => {
        if (cancelled) return;
        const key = JSON.stringify([selected, budget, gymId]);
        const kept = restore.current;
        restore.current = null;
        const mine =
          kept !== null && kept.plan === key
            ? withPlannerEdits(loaded.exercises, kept.exercises)
            : null;
        if (kept !== null && kept.plan === key && mine === null) {
          setNotice('El plan cambió desde que lo ajustaste: va como sale ahora.');
        }
        setPlan(loaded);
        setExercises(mine ?? loaded.exercises);
        setEdited(mine !== null);
        setPlanFor(key);
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

  // Hasta que carga el primer plan, lo que habia cambiado sigue guardado tal cual.
  const choices = useMemo<PlannerDraft>(
    () => ({
      date: saved.draft.date,
      routineId,
      gymId,
      company,
      budget,
      edits: planFor === null ? saved.draft.edits : edited ? { plan: planFor, exercises } : null,
    }),
    [saved, routineId, gymId, company, budget, planFor, edited, exercises],
  );

  // Se escribe solo lo que cambio: cargar un plan sin tocarlo no escribe nada.
  const written = useRef(serializePlannerDraft(saved.draft));
  const writes = useRef(0);
  useEffect(() => {
    const text = serializePlannerDraft(choices);
    if (text === written.current) return;
    written.current = text;
    const write = ++writes.current;
    onSaveDraft(choices).then(
      () => {
        if (write === writes.current) setSaveProblem(null);
      },
      (error: unknown) => {
        console.error(error);
        if (write === writes.current) {
          setSaveProblem(
            `No se guardó lo elegido: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    );
  }, [choices, onSaveDraft]);

  // Spec 8.3 rule 6: the estimate follows the overrides, not the untouched plan.
  const starting = toStart(exercises);
  const seconds = estimateSeconds(starting);

  const override = (exerciseId: string, direction: 1 | -1) => {
    setEdited(true);
    setExercises((current) => overrideSets(current, exerciseId, direction));
  };

  const reorder = (from: number, to: number) => {
    setEdited(true);
    setExercises((current) => {
      const moved = current.slice();
      const [taken] = moved.splice(from, 1);
      moved.splice(to, 0, taken);
      // La posicion que se guarda es la del orden nuevo: es la que lee la sesion para
      // saber cual abrir primero y cual sigue.
      return moved.map((exercise, index) => ({ ...exercise, position: index + 1 }));
    });
  };

  return (
    <View style={styles.wrapper}>
      <Card title="Entreno de hoy">
        <Field label="Dónde *" icon={MapPin} first>
          <View style={styles.where}>
            <View style={[styles.chips, styles.whereChips]}>
              {gyms.map((gym) => (
                <Chip
                  key={gym.id}
                  label={gymLabel(gym, gyms)}
                  accessibilityLabel={`Gimnasio ${gym.name}`}
                  selected={gym.id === gymId}
                  onPress={() => {
                    turn.current += 1;
                    setLocating(false);
                    setGymId(gym.id);
                    setWhereNote(null);
                  }}
                />
              ))}
            </View>
            <IconButton
              icon={Navigation}
              accessibilityLabel="Usar mi ubicación"
              onPress={() => locate('manual')}
              style={[styles.locate, locating && styles.locating]}
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
                onPress={() => setCompany(id)}
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
      {saveProblem && <Text style={styles.problem}>{saveProblem}</Text>}
      {notice && <Text style={styles.note}>{notice}</Text>}

      {exercises.length > 0 && (
        <Card title="El orden de hoy">
          <Order
            exercises={exercises}
            onReorder={reorder}
            onOverride={override}
            onDragging={onDragging}
          />

          {plan && (
            <Text style={styles.estimate}>
              {starting.length} ejercicios · {clockFace(seconds / 60)} de plan
              {/* Y lo que tarda de verdad, cuando hay con que decirlo: el plan suma
                  series y descansos, y el no es una suma de series y descansos. */}
              {plan.usualMinutes === null ? '' : ` · sueles tardar ${clockFace(plan.usualMinutes)}`}
            </Text>
          )}
        </Card>
      )}

      {startProblem}
      <Button
        label={startProblem ? 'Reintentar inicio' : 'Empezar entreno'}
        icon={Play}
        variant="primary"
        size="large"
        block
        disabled={
          busy || !selected || gymId === null || starting.length === 0 || planFor !== requestedPlan
        }
        loading={busy}
        accessibilityLabel={startProblem ? 'Reintentar inicio del entreno' : 'Empezar entreno'}
        onPress={() => {
          if (
            busy ||
            !selected ||
            gymId === null ||
            starting.length === 0 ||
            planFor !== requestedPlan
          )
            return;
          onStart(selected, budget, starting, company, gymId);
        }}
      />

      {restDay ? (
        <Card tone="ok">
          <Text style={styles.restNote}>
            Hoy es descanso. Cuenta como día planeado, así que no penaliza nada.
          </Text>
        </Card>
      ) : (
        <ConfirmAction
          label="Hoy descanso"
          icon={Moon}
          block
          question="¿Marcar hoy como descanso? Cuenta como día planeado y no penaliza."
          yes="Sí, descanso"
          accessibilityLabel="Hoy descanso"
          onConfirm={onRestDay}
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
  // La flecha tiene su sitio fijo a la derecha: si los gimnasios no caben, bajan ellos.
  where: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  whereChips: {
    flex: 1,
  },
  // Centrada con la primera fila de chips, que miden 38 y ella 34.
  locate: {
    marginTop: 2,
  },
  // Hundida en su sombra, como mientras se aprieta, hasta que contesta la ubicacion.
  locating: pressedInto(3),
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
    width: 36,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // El numero es el orden de verdad, no un adorno: es el que sigue el selector.
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
