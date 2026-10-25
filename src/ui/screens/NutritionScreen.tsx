import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { fatBand, kcalBand, proteinBand } from '../../core/targets.ts';
import { chooseSlot, currentSlot, type ChosenSlot } from '../../nutrition/index.ts';
import { useAppData } from '../../shell/AppData.tsx';

import { BatchPanel } from '../BatchPanel.tsx';
import { Button } from '../Button.tsx';
import { FoodForm } from '../FoodForm.tsx';
import { FoodLog } from '../FoodLog.tsx';
import { ChevronRight } from '../icons.ts';

import { Screen } from './Screen.tsx';

export function NutritionScreen() {
  const {
    state,
    addFood,
    removeFood,
    createFood,
    editFood,
    deleteFood,
    startBatch,
    eatBatchPortion,
    throwAwayBatch,
    loadLastBatch,
  } = useAppData();
  // La ficha de un alimento nuevo, abierta aqui con lo que busco de nombre. Al cerrarla
  // se le contesta a Anotar con el creado, que lo deja elegido para la cantidad.
  const [newFood, setNewFood] = useState<string | null>(null);
  const answer = useRef<((made: { id: string; counted: boolean } | null) => void) | null>(null);
  const closeNewFood = (made: { id: string; counted: boolean } | null) => {
    answer.current?.(made);
    answer.current = null;
    setNewFood(null);
  };
  const navigation = useNavigation<{ navigate: (name: string) => void }>();
  // Una sola fila de espacios para anotar y para las tandas. Lo elegido a mano dura
  // mientras el reloj siga en el mismo espacio; despues manda el reloj, que se vuelve a
  // mirar al volver a la app (la pestana se queda montada y sin esto seguia en el
  // espacio de cuando se abrio).
  const [chosen, setChosen] = useState<ChosenSlot | null>(null);
  const [, setWoke] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setWoke(Date.now());
    });
    return () => subscription.remove();
  }, []);

  if (state.phase !== 'ready') return <Screen title="Comida">{null}</Screen>;
  const slot = currentSlot(chosen, new Date());

  const { loaded } = state;
  const targets = loaded.today.targets;

  return (
    <Screen
      title="Comida"
      refreshable
      onOverlayDismiss={newFood === null ? undefined : () => closeNewFood(null)}
      overlay={
        newFood === null ? null : (
          <FoodForm
            food={null}
            name={newFood}
            onCancel={() => closeNewFood(null)}
            onCreate={(food) =>
              createFood(food).then((id) => closeNewFood({ id, counted: food.kind === 'count' }))
            }
            onEdit={editFood}
            onDelete={(id) => deleteFood(id).then(() => undefined)}
          />
        )
      }
    >
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
        onNewFood={(name) =>
          new Promise((resolve) => {
            answer.current = resolve;
            setNewFood(name);
          })
        }
        history={loaded.foodHistory}
        slot={slot}
        onPickSlot={(name) => setChosen(chooseSlot(name, new Date()))}
      />

      <BatchPanel
        batches={loaded.batches}
        foods={loaded.foods}
        onStart={startBatch}
        onEat={eatBatchPortion}
        onThrowAway={throwAwayBatch}
        slot={slot}
        onLoadLast={loadLastBatch}
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
