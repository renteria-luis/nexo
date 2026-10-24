import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';

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
import { OrderList, type OrderItem } from './OrderList.tsx';
import {
  Dumbbell,
  MapPin,
  Moon,
  Navigation,
  Play,
  Timer,
  Users,
  type LucideIcon,
} from './icons.ts';
import { font, pressed as pressedInto, sheet, shape, theme } from './theme.ts';

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

  const orderItems = useMemo<OrderItem[]>(
    () =>
      exercises.map((exercise) => ({
        id: exercise.exerciseId,
        name: exercise.name,
        detail: `${exercise.sets} × ${reps(exercise)} · ${TIER_ES[exercise.tier]} · ${clock(exercise.restSeconds)}${exercise.unilateral ? ' · por brazo' : ''}`,
      })),
    [exercises],
  );

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
          <OrderList
            items={orderItems}
            onReorder={reorder}
            onNudge={override}
            onDragging={onDragging}
          />

          {plan && (
            <Text style={styles.estimate}>
              {starting.length} {starting.length === 1 ? 'ejercicio' : 'ejercicios'} ·{' '}
              {clockFace(seconds / 60)} de plan
              {/* Y lo que tarda de verdad, cuando hay con que decirlo: el plan suma
                  series y descansos, y el no es una suma de series y descansos. */}
              {plan.usualMinutes === null ? '' : ` · sueles tardar ${clockFace(plan.usualMinutes)}`}
            </Text>
          )}
        </Card>
      )}

      {startProblem}
      <Button
        // Apagado sin decir por que, lo unico que lo explicaba era el asterisco de
        // "Dónde", dos pantallas mas arriba.
        label={
          startProblem
            ? 'Reintentar inicio'
            : gymId === null
              ? 'Elige dónde entrenas'
              : 'Empezar entreno'
        }
        icon={Play}
        variant="primary"
        size="large"
        block
        disabled={
          busy || !selected || gymId === null || starting.length === 0 || planFor !== requestedPlan
        }
        loading={busy}
        accessibilityLabel={
          startProblem
            ? 'Reintentar inicio del entreno'
            : gymId === null
              ? 'Elige dónde entrenas'
              : 'Empezar entreno'
        }
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
  locating: pressedInto(),
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
