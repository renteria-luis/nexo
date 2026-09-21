import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { NutritionFoodRow } from '../db/types.ts';
import {
  MEAL_SLOTS,
  portionLabel,
  quickAmounts,
  roundAmount,
  unitLabel,
  type LoggedPortion,
  type NewFoodEntry,
  type NutritionTotals,
} from '../nutrition/index.ts';
import { mono, theme } from './theme.ts';

function Total({
  label,
  value,
  unit,
  band,
  missing,
}: {
  label: string;
  value: number;
  unit: string;
  band?: string;
  missing?: boolean;
}) {
  return (
    <View style={styles.total}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={styles.totalValue}>
        {roundAmount(value)}
        {unit}
        {/* Spec 16.3 rule 5: a gap is shown, never filled in. */}
        {missing ? ' +' : ''}
      </Text>
      {band ? <Text style={styles.totalBand}>{band}</Text> : null}
    </View>
  );
}

export type FoodLogProps = {
  foods: NutritionFoodRow[];
  portions: LoggedPortion[];
  totals: NutritionTotals | null;
  proteinBand: { from: number; to: number } | null;
  kcalTarget: number | null;
  onAdd: (entry: Omit<NewFoodEntry, 'date'>) => void;
  onRemove: (entryId: string) => void;
};

export function FoodLog({
  foods,
  portions,
  totals,
  proteinBand,
  kcalTarget,
  onAdd,
  onRemove,
}: FoodLogProps) {
  const [foodId, setFoodId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [slot, setSlot] = useState(MEAL_SLOTS[0]);

  const selected = foods.find((food) => food.id === foodId) ?? null;
  const parsed = Number(quantity);
  const canAdd = selected !== null && Number.isFinite(parsed) && parsed > 0;

  const missingFor = (nutrient: string) =>
    totals?.missing.some((gap) => gap.nutrient === nutrient) ?? false;

  return (
    <View style={styles.wrapper}>
      {/* The targets card above also says "Calorías" and "Proteína"; this heading is
          what keeps the eaten figures from being read as the target ones. */}
      <Text style={styles.heading}>Comida de hoy</Text>

      {totals && (
        <View style={styles.totals}>
          <Total
            label="Calorías"
            value={totals.kcal}
            unit=""
            band={kcalTarget === null ? undefined : `de ${kcalTarget}`}
            missing={missingFor('kcal')}
          />
          <Total
            label="Proteína"
            value={totals.proteinG}
            unit=" g"
            band={proteinBand === null ? undefined : `${proteinBand.from} a ${proteinBand.to}`}
            missing={missingFor('protein_g')}
          />
          <Total label="Carbos" value={totals.carbsG} unit=" g" missing={missingFor('carbs_g')} />
          {/* Spec 7.5: dairy is shown and never subtracted, and the glycemic load
              only appears once something eaten carries an index. */}
          {totals.dairy.portions > 0 && (
            <Total
              label="Lácteos"
              value={
                totals.dairy.millilitresG > 0 ? totals.dairy.millilitresG : totals.dairy.portions
              }
              unit={totals.dairy.millilitresG > 0 ? ' ml' : ' porciones'}
            />
          )}
          {totals.glycemicLoad !== null && (
            <Total
              label="Carga glucémica"
              value={totals.glycemicLoad}
              unit=""
              missing={missingFor('glycemic_index')}
            />
          )}
          <Total label="Grasa" value={totals.fatG} unit=" g" missing={missingFor('fat_g')} />
          <Total
            label="Sodio"
            value={totals.sodiumMg}
            unit=" mg"
            band={totals.sodiumOverLimit ? 'sobre 2300' : undefined}
            missing={missingFor('sodium_mg')}
          />
        </View>
      )}

      {totals && totals.missing.length > 0 && (
        <Text style={styles.gap}>
          El signo + marca totales incompletos:{' '}
          {[...new Set(totals.missing.map((entry) => entry.foodName))].join(', ')} no traen todos
          los datos en la spec.
        </Text>
      )}

      {portions.map((portion) => (
        <View key={portion.entryId} style={styles.entry}>
          <View style={styles.entryText}>
            <Text style={styles.entryName}>{portionLabel(portion.food, portion.quantity)}</Text>
            <Text style={styles.entryMeta}>{portion.mealSlot}</Text>
          </View>
          <Pressable
            accessibilityLabel={`Quitar ${portion.food.name}`}
            onPress={() => onRemove(portion.entryId)}
            style={styles.remove}
          >
            <Text style={styles.removeText}>quitar</Text>
          </Pressable>
        </View>
      ))}

      <View style={styles.picker}>
        <View style={styles.chips}>
          {foods.map((food) => (
            <Pressable
              key={food.id}
              onPress={() => setFoodId(food.id)}
              style={[styles.chip, food.id === foodId && styles.chipSelected]}
            >
              <Text style={styles.chipText}>{food.name}</Text>
            </Pressable>
          ))}
        </View>

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

        {selected && (
          <View style={styles.chips}>
            {quickAmounts(selected.unit_kind).map((amount) => (
              <Pressable
                key={amount}
                onPress={() => setQuantity(String(amount))}
                style={[styles.chip, quantity === String(amount) && styles.chipSelected]}
              >
                <Text style={styles.chipText}>
                  {amount} {unitLabel(selected, amount)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.addRow}>
          <TextInput
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
            accessibilityLabel="Cantidad"
            style={styles.input}
          />
          <Text style={styles.unit}>
            {selected ? unitLabel(selected, parsed) : 'elige un alimento'}
          </Text>
          <Pressable
            accessibilityLabel="Agregar comida"
            disabled={!canAdd}
            onPress={() => {
              if (!canAdd || !selected) return;
              onAdd({
                foodId: selected.id,
                quantity: parsed,
                unit: selected.base_unit,
                mealSlot: slot,
              });
            }}
            style={[styles.add, !canAdd && styles.addDisabled]}
          >
            <Text style={styles.addText}>Agregar</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'stretch',
    gap: 10,
  },
  heading: {
    fontSize: 14,
    fontFamily: mono,
    color: theme.text,
  },
  totals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  total: {
    minWidth: 72,
  },
  totalLabel: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  totalValue: {
    fontSize: 15,
    fontFamily: mono,
    color: theme.text,
  },
  totalBand: {
    fontSize: 10,
    color: theme.textGhost,
    fontFamily: mono,
  },
  gap: {
    fontSize: 11,
    color: theme.warn,
    fontFamily: mono,
  },
  entry: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 6,
  },
  entryText: {
    flexShrink: 1,
  },
  entryName: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  entryMeta: {
    fontSize: 10,
    color: theme.textGhost,
    fontFamily: mono,
  },
  remove: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  removeText: {
    fontSize: 11,
    color: theme.danger,
    fontFamily: mono,
  },
  picker: {
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 8,
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
    borderColor: theme.lineStrong,
    backgroundColor: theme.surfaceHigh,
  },
  chipText: {
    fontSize: 11,
    fontFamily: mono,
    color: theme.text,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.lineSoft,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
    width: 70,
    fontFamily: mono,
    color: theme.text,
  },
  unit: {
    fontSize: 11,
    color: theme.textGhost,
    flexShrink: 1,
    fontFamily: mono,
  },
  add: {
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addDisabled: {
    borderColor: theme.lineSoft,
  },
  addText: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.text,
  },
});
