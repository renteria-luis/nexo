import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { NutritionFoodRow } from '../db/types.ts';
import { MEAL_SLOTS, roundAmount } from '../nutrition/index.ts';
import type { BatchStart, OpenBatch } from '../shell/AppData.tsx';

function parse(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={label === 'Nombre' ? 'default' : 'numeric'}
        accessibilityLabel={label}
        placeholder={placeholder}
        style={styles.input}
      />
    </View>
  );
}

function BatchCard({ item, onEat }: { item: OpenBatch; onEat: () => void }) {
  const { batch, food, macros, spoilage } = item;
  const kcal =
    macros.kcal !== null
      ? `${Math.round(macros.kcal)} kcal`
      : macros.kcalRange
        ? `entre ${Math.round(macros.kcalRange.from)} y ${Math.round(macros.kcalRange.to)} kcal, grasa escurrida`
        : macros.fatDrained
          ? 'calorías sin rango: faltan los carbohidratos del alimento'
          : 'calorías sin dato';

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {food.name} · {batch.portions_remaining} de {batch.portions_count} porciones
      </Text>
      <Text style={styles.cardDetail}>
        {roundAmount(macros.proteinG)} g de proteína por porción · {kcal}
      </Text>
      {spoilage && (
        // Spec 7.3 wording.
        <Text style={styles.spoilage}>
          Quedan {spoilage.portionsRemaining} porciones de {food.name} de hace {spoilage.ageDays}{' '}
          días
        </Text>
      )}
      <Pressable
        accessibilityLabel={`Comer una porción de ${food.name}`}
        onPress={onEat}
        style={styles.eat}
      >
        <Text style={styles.eatText}>Comer una porción</Text>
      </Pressable>
    </View>
  );
}

export type BatchPanelProps = {
  batches: OpenBatch[];
  foods: NutritionFoodRow[];
  onStart: (start: BatchStart) => Promise<void>;
  onEat: (batchId: string, mealSlot: string) => void;
};

/**
 * Spec 7.3: weigh the raw pack once, divide it by eye, and every tap after that is
 * one portion. The foods the pattern is really for, chicken breast, ground beef and
 * rice, are not in the seeded catalogue, so a batch can start from a package label.
 */
export function BatchPanel({ batches, foods, onStart, onEat }: BatchPanelProps) {
  const [slot, setSlot] = useState(MEAL_SLOTS[2]);
  const [creating, setCreating] = useState(false);
  const [source, setSource] = useState<'catalog' | 'label'>('label');
  const [foodId, setFoodId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [servingG, setServingG] = useState('100');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [carbs, setCarbs] = useState('');
  const [rawWeight, setRawWeight] = useState('');
  const [portions, setPortions] = useState('');
  const [drained, setDrained] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const batchable = foods.filter((food) => food.base_unit_g !== null);

  // The low end of a drained range is protein and carbs alone (spec 7.3), so a
  // blank carbs figure would leave the range with nothing to stand on.
  const required = drained ? [servingG, kcal, protein, fat, carbs] : [servingG, kcal, protein, fat];
  const labelReady = name.trim() !== '' && required.every((value) => Number.isFinite(parse(value)));
  const batchReady =
    parse(rawWeight) > 0 && Number.isInteger(parse(portions)) && parse(portions) >= 1;
  const canSave = batchReady && (source === 'catalog' ? foodId !== null : labelReady);

  const reset = () => {
    setCreating(false);
    setFoodId(null);
    setName('');
    setServingG('100');
    setKcal('');
    setProtein('');
    setFat('');
    setCarbs('');
    setRawWeight('');
    setPortions('');
    setDrained(false);
    setProblem(null);
  };

  const save = () => {
    if (!canSave) return;
    const food: BatchStart['food'] =
      source === 'catalog' && foodId
        ? { foodId }
        : {
            label: {
              name,
              servingG: parse(servingG),
              kcal: parse(kcal),
              proteinG: parse(protein),
              fatG: parse(fat),
              carbsG: carbs.trim() === '' ? null : parse(carbs),
            },
          };
    onStart({
      food,
      rawWeightG: parse(rawWeight),
      portionsCount: parse(portions),
      fatDrained: drained,
    })
      .then(reset)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(error instanceof Error ? error.message : String(error));
      });
  };

  return (
    <View style={styles.wrapper}>
      <Text style={styles.heading}>Tandas</Text>

      {batches.length > 0 && (
        <View style={styles.chips}>
          {MEAL_SLOTS.map((name) => (
            <Pressable
              key={name}
              onPress={() => setSlot(name)}
              style={[styles.chip, name === slot && styles.chipSelected]}
            >
              <Text style={styles.chipText}>{name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {batches.map((item) => (
        <BatchCard key={item.batch.id} item={item} onEat={() => onEat(item.batch.id, slot)} />
      ))}

      {!creating ? (
        <Pressable
          accessibilityLabel="Nueva tanda"
          onPress={() => setCreating(true)}
          style={styles.newBatch}
        >
          <Text style={styles.newBatchText}>+ Nueva tanda</Text>
        </Pressable>
      ) : (
        <View style={styles.form}>
          <View style={styles.chips}>
            {(['label', 'catalog'] as const).map((option) => (
              <Pressable
                key={option}
                onPress={() => setSource(option)}
                style={[styles.chip, source === option && styles.chipSelected]}
              >
                <Text style={styles.chipText}>
                  {option === 'label' ? 'Desde la etiqueta' : 'Del catálogo'}
                </Text>
              </Pressable>
            ))}
          </View>

          {source === 'catalog' ? (
            <View style={styles.chips}>
              {batchable.map((food) => (
                <Pressable
                  key={food.id}
                  onPress={() => setFoodId(food.id)}
                  style={[styles.chip, food.id === foodId && styles.chipSelected]}
                >
                  <Text style={styles.chipText}>{food.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <>
              <Field
                label="Nombre"
                value={name}
                onChange={setName}
                placeholder="Pechuga de pollo"
              />
              <Text style={styles.hint}>Tal como dice el paquete, crudo.</Text>
              <View style={styles.row}>
                <Field label="Por cada (g)" value={servingG} onChange={setServingG} />
                <Field label="Calorías" value={kcal} onChange={setKcal} />
              </View>
              <View style={styles.row}>
                <Field label="Proteína (g)" value={protein} onChange={setProtein} />
                <Field label="Grasa (g)" value={fat} onChange={setFat} />
                <Field
                  label="Carbohidratos (g)"
                  value={carbs}
                  onChange={setCarbs}
                  placeholder={drained ? '0 si no trae' : 'opcional'}
                />
              </View>
            </>
          )}

          <View style={styles.row}>
            <Field
              label="Peso crudo total (g)"
              value={rawWeight}
              onChange={setRawWeight}
              placeholder="1600"
            />
            <Field label="Porciones" value={portions} onChange={setPortions} placeholder="8" />
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: drained }}
            onPress={() => setDrained((value) => !value)}
            style={[styles.chip, drained && styles.chipSelected, styles.drained]}
          >
            <Text style={styles.chipText}>Grasa escurrida</Text>
          </Pressable>

          {problem && <Text style={styles.problem}>{problem}</Text>}

          <View style={styles.row}>
            <Pressable
              accessibilityLabel="Guardar tanda"
              disabled={!canSave}
              onPress={save}
              style={[styles.save, !canSave && styles.saveDisabled]}
            >
              <Text style={styles.saveText}>Guardar tanda</Text>
            </Pressable>
            <Pressable accessibilityLabel="Cancelar tanda" onPress={reset} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'stretch',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 12,
  },
  heading: {
    fontSize: 14,
  },
  card: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  cardTitle: {
    fontSize: 13,
  },
  cardDetail: {
    fontSize: 11,
    color: '#666',
  },
  spoilage: {
    fontSize: 11,
    color: '#8a6d1f',
  },
  eat: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#555',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 4,
  },
  eatText: {
    fontSize: 12,
  },
  newBatch: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  newBatchText: {
    fontSize: 12,
    color: '#555',
  },
  form: {
    gap: 8,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 10,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#e2e2e2',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  chipSelected: {
    borderColor: '#555',
    backgroundColor: '#f3f3f3',
  },
  chipText: {
    fontSize: 11,
  },
  drained: {
    alignSelf: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  field: {
    gap: 2,
    minWidth: 90,
    flexGrow: 1,
  },
  fieldLabel: {
    fontSize: 10,
    color: '#777',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
  },
  hint: {
    fontSize: 10,
    color: '#999',
  },
  problem: {
    fontSize: 11,
    color: '#8a1f11',
  },
  save: {
    borderWidth: 1,
    borderColor: '#555',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveDisabled: {
    borderColor: '#ddd',
  },
  saveText: {
    fontSize: 12,
  },
  cancel: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 12,
    color: '#777',
  },
});
