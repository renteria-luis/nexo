import { useNavigation } from '@react-navigation/native';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useAppData } from '../../shell/AppData.tsx';
import { SessionLog } from '../SessionLog.tsx';
import { SessionPlanner } from '../SessionPlanner.tsx';

import { Screen } from './Screen.tsx';

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
  } = useAppData();
  const navigation = useNavigation<{ navigate: (name: string) => void }>();
  if (state.phase !== 'ready') return <Screen title="Entreno">{null}</Screen>;

  const { loaded } = state;
  const planned = loaded.plan.find((entry) => entry.exerciseId === exerciseId);

  return (
    <Screen title="Entreno">
      {loaded.today.session === null ? (
        <SessionPlanner routines={loaded.routines} onLoadPlan={loadPlan} onStart={beginSession} />
      ) : (
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
          crowding={loaded.today.session.crowding}
          onDescribe={describeSession}
          onAddSet={logSet}
          onRemoveSet={removeSet}
        />
      )}

      {/* At the bottom and small: reference material, not part of logging a set. */}
      <Pressable
        accessibilityLabel="Ver recomendaciones de rutina"
        onPress={() => navigation.navigate('Recomendaciones')}
        style={styles.notesLink}
      >
        <Text style={styles.notesLinkText}>Recomendaciones de rutina ›</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  notesLink: {
    alignSelf: 'flex-start',
    marginTop: 16,
    paddingVertical: 6,
  },
  notesLinkText: {
    fontSize: 12,
    color: '#777',
  },
});
