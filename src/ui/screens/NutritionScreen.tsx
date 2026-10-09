import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { fatBand, kcalBand, proteinBand } from '../../core/targets.ts';
import { currentSlot } from '../../nutrition/index.ts';
import { useAppData } from '../../shell/AppData.tsx';

import { BatchPanel } from '../BatchPanel.tsx';
import { Button } from '../Button.tsx';
import { FoodLog } from '../FoodLog.tsx';
import { ChevronRight } from '../icons.ts';

import { Screen } from './Screen.tsx';

export function NutritionScreen() {
  const { state, addFood, repeatMeal, removeFood, startBatch, eatBatchPortion, throwAwayBatch } =
    useAppData();
  const navigation = useNavigation<{ navigate: (name: string) => void }>();
  // Una sola fila de espacios para anotar y para las tandas. Lo elegido a mano dura hasta
  // que anota algo; si no, manda el reloj, que se vuelve a mirar al volver a la app (la
  // pestana se queda montada y sin esto seguia en el espacio de cuando se abrio).
  const [chosen, setChosen] = useState<string | null>(null);
  const [, setWoke] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      setChosen(null);
      setWoke(Date.now());
    });
    return () => subscription.remove();
  }, []);

  if (state.phase !== 'ready') return <Screen title="Comida">{null}</Screen>;
  const slot = currentSlot(chosen, new Date());

  const { loaded } = state;
  const targets = loaded.today.targets;

  return (
    <Screen title="Comida" refreshable>
      <FoodLog
        foods={loaded.foods}
        portions={loaded.today.portions}
        totals={loaded.today.nutrition}
        proteinBand={targets ? proteinBand(targets) : null}
        kcalBand={targets ? kcalBand(targets) : null}
        fatBand={targets ? fatBand(targets) : null}
        onAdd={addFood}
        onRemove={removeFood}
        onOpenCatalogue={() => navigation.navigate('Alimentos')}
        history={loaded.foodHistory}
        onRepeatMeal={repeatMeal}
        slot={slot}
        onPickSlot={setChosen}
      />

      <BatchPanel
        batches={loaded.batches}
        foods={loaded.foods}
        onStart={startBatch}
        onEat={(batchId, mealSlot) =>
          eatBatchPortion(batchId, mealSlot).then(() => setChosen(null))
        }
        onThrowAway={throwAwayBatch}
        slot={slot}
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
