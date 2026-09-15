import { useAppData } from '../../shell/AppData.tsx';
import { proteinBand } from '../../core/targets.ts';
import { useNavigation } from '@react-navigation/native';
import { Pressable, StyleSheet, Text } from 'react-native';

import { BatchPanel } from '../BatchPanel.tsx';
import { FoodLog } from '../FoodLog.tsx';

import { Screen } from './Screen.tsx';

export function NutritionScreen() {
  const { state, addFood, removeFood, startBatch, eatBatchPortion } = useAppData();
  const navigation = useNavigation<{ navigate: (name: string) => void }>();
  if (state.phase !== 'ready') return <Screen title="Comida">{null}</Screen>;

  const { loaded } = state;
  const targets = loaded.today.targets;

  return (
    <Screen title="Comida">
      <FoodLog
        foods={loaded.foods}
        portions={loaded.today.portions}
        totals={loaded.today.nutrition}
        proteinBand={targets ? proteinBand(targets) : null}
        kcalTarget={targets?.kcal ?? null}
        onAdd={addFood}
        onRemove={removeFood}
      />

      <BatchPanel
        batches={loaded.batches}
        foods={loaded.foods}
        onStart={startBatch}
        onEat={eatBatchPortion}
      />

      {/* Spec 7.5 point 3: the dairy question is his to answer on his own skin. */}
      <Pressable
        accessibilityLabel="Ver experimentos"
        onPress={() => navigation.navigate('Experimentos')}
        style={styles.link}
      >
        <Text style={styles.linkText}>Experimentos ›</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: {
    alignSelf: 'flex-start',
    marginTop: 16,
    paddingVertical: 6,
  },
  linkText: {
    fontSize: 12,
    color: '#777',
  },
});
