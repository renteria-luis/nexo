import { useNavigation } from '@react-navigation/native';

import { proteinBand } from '../../core/targets.ts';
import { useAppData } from '../../shell/AppData.tsx';

import { BatchPanel } from '../BatchPanel.tsx';
import { Button } from '../Button.tsx';
import { FoodLog } from '../FoodLog.tsx';
import { ChevronRight } from '../icons.ts';

import { Screen } from './Screen.tsx';

export function NutritionScreen() {
  const { state, addFood, repeatMeal, removeFood, startBatch, eatBatchPortion } = useAppData();
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
        onOpenCatalogue={() => navigation.navigate('Alimentos')}
        history={loaded.foodHistory}
        onRepeatMeal={repeatMeal}
      />

      <BatchPanel
        batches={loaded.batches}
        foods={loaded.foods}
        onStart={startBatch}
        onEat={eatBatchPortion}
      />

      {/* Spec 7.5 punto 3: la pregunta de los lacteos se contesta en su propia piel. */}
      <Button
        label="Experimentos"
        accessibilityLabel="Ver experimentos"
        icon={ChevronRight}
        onPress={() => navigation.navigate('Experimentos')}
      />
    </Screen>
  );
}
