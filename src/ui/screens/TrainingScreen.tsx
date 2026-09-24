import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppData } from '../../shell/AppData.tsx';
import { SessionLog } from '../SessionLog.tsx';
import { SessionPlanner } from '../SessionPlanner.tsx';

import { Screen } from './Screen.tsx';
import { mono, theme } from '../theme.ts';

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
    switchRoutine,
    whereAmI,
  } = useAppData();
  const navigation = useNavigation<{
    navigate: (name: string, params?: { routineId?: string }) => void;
  }>();
  const [changingRoutine, setChangingRoutine] = useState(false);

  // Empezar un entreno y que no haya nada donde escribir es un toque de mas en cada
  // sesion, asi que queda abierto el ejercicio en el que estaba, o el primero del
  // plan si es la primera vez que entra hoy.
  const saved = state.phase === 'ready' ? state.loaded.sessionDraft : null;
  const first =
    state.phase === 'ready'
      ? (saved?.exerciseId ?? state.loaded.plan[0]?.exerciseId ?? null)
      : null;
  const hasSession = state.phase === 'ready' && state.loaded.today.session !== null;
  useEffect(() => {
    if (hasSession && exerciseId === null && first !== null) selectExercise(first);
  }, [hasSession, exerciseId, first, selectExercise]);

  if (state.phase !== 'ready') return <Screen title="Entreno">{null}</Screen>;

  const { loaded } = state;
  const session = loaded.today.session;
  const planned = loaded.plan.find((entry) => entry.exerciseId === exerciseId);

  // Cuantas series lleva cada ejercicio hoy y cuantas aprobo, para que el chip diga
  // de un vistazo que falta sin tener que entrar a cada uno.
  const setsDoneByExercise = new Map<string, number>();
  for (const set of loaded.today.sessionSets) {
    setsDoneByExercise.set(set.exerciseId, (setsDoneByExercise.get(set.exerciseId) ?? 0) + 1);
  }
  const plannedByExercise = new Map(loaded.plan.map((entry) => [entry.exerciseId, entry.sets]));
  const routine = loaded.routines.find((item) => item.id === session?.routine_id) ?? null;

  return (
    <Screen title="Entreno">
      {session === null ? (
        <SessionPlanner
          routines={loaded.routines}
          gyms={loaded.gyms}
          onLocate={whereAmI}
          onLoadPlan={loadPlan}
          onStart={beginSession}
          restDay={loaded.today.log?.rest_day === 1}
          onRestDay={() => logDay({ restDay: true })}
        />
      ) : (
        <>
          {/* La rutina a la izquierda y el gentio arriba a la derecha: dos cosas que
              se miran al llegar y ninguna despues, asi que comparten el renglon de
              arriba y no gastan alto en el medio de la pantalla. */}
          <View style={styles.topRow}>
            <View style={styles.routineRow}>
              <Text style={styles.routineText}>{routine ? routine.name : 'Sin rutina'}</Text>
              <Pressable
                accessibilityLabel="Cambiar la rutina de hoy"
                onPress={() => setChangingRoutine((open) => !open)}
                style={styles.change}
              >
                <Text style={styles.changeText}>{changingRoutine ? 'dejar así' : 'cambiar'}</Text>
              </Pressable>
            </View>

            {/* Spec 8.5: se pregunta al llegar y aparte de empezar, asi que no esta en
                el camino critico. Spec 5.4 la deja fuera de una sesion escrita despues. */}
            <View style={styles.crowdSide}>
              <Text style={styles.crowdLabel}>gym crowd:</Text>
              <View style={styles.crowdChips}>
                {(
                  [
                    ['empty', 'vacío'],
                    ['normal', 'normal'],
                    ['full', 'lleno'],
                  ] as const
                ).map(([id, label]) => (
                  <Pressable
                    key={id}
                    accessibilityLabel={`Gimnasio ${label}`}
                    onPress={() => describeSession({ crowding: id })}
                    style={[styles.crowdChip, session.crowding === id && styles.crowdChipOn]}
                  >
                    <Text
                      style={[
                        styles.crowdChipText,
                        session.crowding === id && styles.crowdChipTextOn,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          {changingRoutine && (
            <View style={styles.chips}>
              {loaded.routines.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityLabel={`Cambiar a ${item.name}`}
                  onPress={() => {
                    switchRoutine(item.id);
                    setChangingRoutine(false);
                  }}
                  style={[styles.chip, item.id === session.routine_id && styles.chipSelected]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      item.id === session.routine_id && styles.chipTextSelected,
                    ]}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          <SessionLog
            exercises={loaded.exercise.exercises}
            selectedExerciseId={exerciseId}
            onSelectExercise={selectExercise}
            todaySets={loaded.exercise.todaySets}
            lastSets={loaded.exercise.lastSets}
            marks={loaded.exercise.marks}
            sessionVolume={loaded.today.sessionVolume}
            unit={loaded.unit}
            onChangeUnit={(next) => saveSetting('weight_unit', next)}
            plannedSets={planned?.sets ?? null}
            planExerciseIds={loaded.plan.map((entry) => entry.exerciseId)}
            setsDoneByExercise={setsDoneByExercise}
            plannedByExercise={plannedByExercise}
            onAddSet={logSet}
            onRemoveSet={removeSet}
            startedAt={session.start_time}
            draft={loaded.sessionDraft}
            onDraftChange={(next) =>
              saveDraft({
                sessionId: session.id,
                exerciseId,
                weight: next.weight,
                reps: next.reps,
                rpe: next.rpe,
                implement: next.implement,
              })
            }
            finishedAt={session.end_time}
            onFinish={endSession}
          />
        </>
      )}

      {/* At the bottom and small: reference material, not part of logging a set. */}
      <Pressable
        accessibilityLabel="Ver recomendaciones de rutina"
        onPress={() =>
          navigation.navigate('Recomendaciones', { routineId: session?.routine_id ?? undefined })
        }
        style={styles.notesLink}
      >
        <Text style={styles.notesLinkText}>Recomendaciones de rutina ›</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  routineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  crowdSide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  crowdLabel: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  crowdChips: {
    flexDirection: 'row',
    gap: 4,
  },
  crowdChip: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  crowdChipOn: {
    borderColor: theme.accent,
    backgroundColor: theme.accent,
  },
  crowdChipText: {
    fontSize: 11,
    color: theme.textDim,
    fontFamily: mono,
  },
  crowdChipTextOn: {
    color: theme.accentInk,
  },
  routineText: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  change: {
    paddingVertical: 4,
  },
  changeText: {
    fontSize: 11,
    color: theme.textFaint,
    textDecorationLine: 'underline',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  chip: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 38,
    justifyContent: 'center',
  },
  chipSelected: {
    borderColor: theme.accent,
    backgroundColor: theme.accent,
  },
  chipText: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.text,
  },
  chipTextSelected: {
    color: theme.accentInk,
  },
  notesLink: {
    alignSelf: 'flex-start',
    marginTop: 16,
    paddingVertical: 6,
  },
  notesLinkText: {
    fontSize: 12,
    color: theme.textFaint,
    fontFamily: mono,
  },
});
