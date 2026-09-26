import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { useAppData } from '../../shell/AppData.tsx';
import { Button } from '../Button.tsx';
import { Card } from '../Card.tsx';
import { ChevronRight } from '../icons.ts';
import { nextPendingExercise } from '../../training/routines.ts';
import type { Implement } from '../../training/sessions.ts';
import { Chip } from '../Chip.tsx';
import { SessionLog } from '../SessionLog.tsx';
import { SessionPlanner } from '../SessionPlanner.tsx';
import { useSwipeLock } from '../SwipeLock.tsx';

import { Screen } from './Screen.tsx';
import { font, sheet } from '../theme.ts';

export function TrainingScreen() {
  const {
    state,
    exerciseId,
    selectExercise,
    beginSession,
    loadPlan,
    logSet,
    removeSet,
    describeSession,
    logDay,
    saveSetting,
    saveDraft,
    endSession,
    reopenSession,
    switchRoutine,
    whereAmI,
  } = useAppData();
  const navigation = useNavigation<{
    navigate: (name: string, params?: { routineId?: string }) => void;
  }>();
  const [changingRoutine, setChangingRoutine] = useState(false);
  // Mientras arrastra una fila del orden, ni la pantalla se desplaza ni se pasa de
  // pestana: los dos gestos son nativos y se llevan el toque aunque este tomado.
  const [dragging, setDragging] = useState(false);
  const { setLocked } = useSwipeLock();
  const holdScreen = useCallback(
    (held: boolean) => {
      setDragging(held);
      setLocked(held);
    },
    [setLocked],
  );

  // Todo esto se calcula arriba y una sola vez por cambio de datos, para que el
  // registro del entreno reciba siempre los mismos objetos y pueda saltarse su propio
  // redibujo cuando lo que cambio fue otra cosa de la pantalla.
  const ready = state.phase === 'ready' ? state.loaded : null;
  const sessionSets = ready?.today.sessionSets ?? null;
  const plan = ready?.plan ?? null;
  const openSessionId = ready?.today.session?.id ?? null;

  // Cuantas series lleva cada ejercicio hoy y cuantas aprobo, para que el chip diga
  // de un vistazo que falta sin tener que entrar a cada uno.
  const setsDoneByExercise = useMemo(() => {
    const done = new Map<string, number>();
    for (const set of sessionSets ?? []) {
      done.set(set.exerciseId, (done.get(set.exerciseId) ?? 0) + 1);
    }
    return done;
  }, [sessionSets]);

  const plannedByExercise = useMemo(
    () => new Map((plan ?? []).map((entry) => [entry.exerciseId, entry.sets])),
    [plan],
  );

  const planExerciseIds = useMemo(() => (plan ?? []).map((entry) => entry.exerciseId), [plan]);

  /**
   * Cerrar las series de un ejercicio abre el siguiente del plan.
   *
   * Es solo para ahorrar toques: no escribe nada ni cambia ninguna cuenta, y se puede
   * seguir eligiendo a mano. Salta exactamente en la serie que completa lo planeado
   * (una cuarta serie de un ejercicio de tres no lo mueve), y si se salto uno, al
   * cerrar el que estaba haciendo la vuelta lo recoge.
   */
  const closed = useRef<{ id: string | null; done: number }>({ id: null, done: 0 });
  useEffect(() => {
    const before = closed.current;
    const done = exerciseId === null ? 0 : (setsDoneByExercise.get(exerciseId) ?? 0);
    closed.current = { id: exerciseId, done };

    if (exerciseId === null || before.id !== exerciseId) return;
    if (done <= before.done) return;
    if (done !== plannedByExercise.get(exerciseId)) return;

    const next = nextPendingExercise(
      exerciseId,
      planExerciseIds,
      setsDoneByExercise,
      plannedByExercise,
    );
    if (next !== null && next !== exerciseId) selectExercise(next);
  }, [exerciseId, setsDoneByExercise, plannedByExercise, planExerciseIds, selectExercise]);

  const changeUnit = useCallback(
    (next: 'kg' | 'lb') => saveSetting('weight_unit', next),
    [saveSetting],
  );

  const changeDraft = useCallback(
    (next: {
      weight: string | null;
      reps: string | null;
      rpe: string | null;
      implement: Implement | null;
    }) => {
      if (openSessionId === null) return;
      saveDraft({
        sessionId: openSessionId,
        exerciseId,
        weight: next.weight,
        reps: next.reps,
        rpe: next.rpe,
        implement: next.implement,
      });
    },
    [saveDraft, openSessionId, exerciseId],
  );

  // Empezar un entreno y que no haya nada donde escribir es un toque de mas en cada
  // sesion, asi que queda abierto el ejercicio en el que estaba, o el primero del orden
  // que aprobo si es la primera vez que entra hoy.
  //
  // Lo que quedo a medio escribir solo manda si su ejercicio sigue estando en el plan.
  // Sin esa condicion, un borrador de otro dia abria un ejercicio que hoy no toca: le
  // salio remo al empezar un dia de empuje, porque ese era el ejercicio en el que estaba
  // cuando probo el dia de tiron.
  const saved = state.phase === 'ready' ? state.loaded.sessionDraft : null;
  const drafted = saved?.exerciseId ?? null;
  const first =
    drafted !== null && plannedByExercise.has(drafted) ? drafted : (planExerciseIds[0] ?? null);

  // Y se elige una vez por sesion, no una vez por "no hay nada elegido": al empezar otra
  // sesion en la misma sentada seguia puesto el ejercicio de la anterior, y entonces esto
  // no elegia nada.
  const chosen = useRef<string | null>(null);
  useEffect(() => {
    if (openSessionId === null) {
      chosen.current = null;
      return;
    }
    if (chosen.current === openSessionId) return;
    chosen.current = openSessionId;
    if (first !== null) selectExercise(first);
  }, [openSessionId, first, selectExercise]);

  if (state.phase !== 'ready') return <Screen title="Entreno">{null}</Screen>;

  const { loaded } = state;
  const session = loaded.today.session;
  const planned = loaded.plan.find((entry) => entry.exerciseId === exerciseId);
  const routine = loaded.routines.find((item) => item.id === session?.routine_id) ?? null;

  return (
    <Screen title="Entreno" scrollEnabled={!dragging}>
      {session === null ? (
        <SessionPlanner
          routines={loaded.routines}
          gyms={loaded.gyms}
          onLocate={whereAmI}
          onLoadPlan={loadPlan}
          onStart={beginSession}
          restDay={loaded.today.log?.rest_day === 1}
          onRestDay={() => logDay({ restDay: true })}
          onDragging={holdScreen}
        />
      ) : (
        <>
          {/* La rutina y el gentio: dos cosas que se miran al llegar y ninguna
              despues, asi que comparten la cartilla de arriba y no gastan alto en el
              medio de la pantalla. */}
          <Card>
            <View style={styles.topRow}>
              <View style={styles.routineSide}>
                <Text style={styles.label}>RUTINA DE HOY</Text>
                <Text style={styles.routineText}>{routine ? routine.name : 'Sin rutina'}</Text>
              </View>
              <Button
                label={changingRoutine ? 'Dejar así' : 'Cambiar'}
                accessibilityLabel="Cambiar la rutina de hoy"
                variant="ghost"
                onPress={() => setChangingRoutine((open) => !open)}
              />
            </View>

            {changingRoutine && (
              <View style={styles.chips}>
                {loaded.routines.map((item) => (
                  <Chip
                    key={item.id}
                    label={item.name}
                    accessibilityLabel={`Cambiar a ${item.name}`}
                    selected={item.id === session.routine_id}
                    onPress={() => {
                      switchRoutine(item.id);
                      setChangingRoutine(false);
                    }}
                  />
                ))}
              </View>
            )}

            {/* Spec 8.5: se pregunta al llegar y aparte de empezar, asi que no esta en
                el camino critico. Spec 5.4 la deja fuera de una sesion escrita despues. */}
            <View style={styles.crowdRow}>
              <Text style={styles.label}>GENTÍO</Text>
              <View style={styles.chips}>
                {(
                  [
                    ['empty', 'vacío'],
                    ['normal', 'normal'],
                    ['full', 'lleno'],
                  ] as const
                ).map(([id, label]) => (
                  <Chip
                    key={id}
                    label={label}
                    accessibilityLabel={`Gimnasio ${label}`}
                    selected={session.crowding === id}
                    onPress={() => describeSession({ crowding: id })}
                  />
                ))}
              </View>
            </View>
          </Card>

          <SessionLog
            exercises={loaded.exercise.exercises}
            selectedExerciseId={exerciseId}
            onSelectExercise={selectExercise}
            todaySets={loaded.exercise.todaySets}
            lastSets={loaded.exercise.lastSets}
            marks={loaded.exercise.marks}
            sessionVolume={loaded.today.sessionVolume}
            unit={loaded.unit}
            onChangeUnit={changeUnit}
            plannedSets={planned?.sets ?? null}
            planExerciseIds={planExerciseIds}
            setsDoneByExercise={setsDoneByExercise}
            plannedByExercise={plannedByExercise}
            onAddSet={logSet}
            onRemoveSet={removeSet}
            startedAt={session.start_time}
            draft={loaded.sessionDraft}
            onDraftChange={changeDraft}
            finishedAt={session.end_time}
            onFinish={endSession}
            onReopen={reopenSession}
          />
        </>
      )}

      {/* Al final: material de consulta, no parte de anotar una serie. */}
      <Button
        label="Recomendaciones de rutina"
        accessibilityLabel="Ver recomendaciones de rutina"
        icon={ChevronRight}
        onPress={() =>
          navigation.navigate('Recomendaciones', { routineId: session?.routine_id ?? undefined })
        }
        style={styles.notesLink}
      />
    </Screen>
  );
}

const styles = sheet((theme) => ({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  routineSide: {
    flexShrink: 1,
  },
  label: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 1,
    color: theme.textFaint,
  },
  routineText: {
    fontSize: 18,
    fontFamily: font.black,
    color: theme.text,
  },
  crowdRow: {
    gap: 8,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  notesLink: {
    marginTop: 4,
  },
}));
