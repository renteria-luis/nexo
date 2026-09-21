import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
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
    endSession,
    switchRoutine,
    whereAmI,
  } = useAppData();
  const navigation = useNavigation<{
    navigate: (name: string, params?: { routineId?: string }) => void;
  }>();
  const [changingRoutine, setChangingRoutine] = useState(false);
  if (state.phase !== 'ready') return <Screen title="Entreno">{null}</Screen>;

  const { loaded } = state;
  const session = loaded.today.session;
  const planned = loaded.plan.find((entry) => entry.exerciseId === exerciseId);
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
        />
      ) : (
        <>
          {/* A routine tapped by mistake used to be stuck for the whole session. */}
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
            plannedSets={planned?.sets ?? null}
            planExerciseIds={loaded.plan.map((entry) => entry.exerciseId)}
            crowding={session.crowding}
            onDescribe={describeSession}
            onAddSet={logSet}
            onRemoveSet={removeSet}
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
  routineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  chipSelected: {
    borderColor: theme.accent,
    backgroundColor: theme.accent,
  },
  chipText: {
    fontSize: 11,
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
