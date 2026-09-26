import { StyleSheet, Text, View } from 'react-native';

import type { NutritionFoodRow } from '../db/types.ts';
import { referenceAmount, roundAmount, unitLabel } from '../nutrition/index.ts';

import { mono, theme } from './theme.ts';

/**
 * Lo que aporta una porcion, sin repetir el nombre del alimento.
 *
 * Dos numeros por fila: lo que dice la ficha y, entre parentesis, lo que suman los
 * que se comio. Asi la misma burbuja responde "cuanto trae uno" y "cuanto me meti",
 * que son las dos preguntas y hasta ahora habia que hacer la cuenta a mano.
 */
export type PortionMacrosProps = {
  food: NutritionFoodRow;
  quantity: number;
};

type Row = {
  label: string;
  /** Por unidad base, que es como esta guardado. */
  perUnit: number | null;
  unit: string;
};

export function PortionMacros({ food, quantity }: PortionMacrosProps) {
  const per = referenceAmount(food);
  const reference =
    food.unit_kind === 'count' ? `1 ${food.base_unit}` : `${per} ${food.base_unit}`;

  const rows: Row[] = [
    { label: 'kcal', perUnit: food.kcal, unit: '' },
    { label: 'proteína', perUnit: food.protein_g, unit: 'g' },
    { label: 'carbos', perUnit: food.carbs_g, unit: 'g' },
    { label: 'grasa', perUnit: food.fat_g, unit: 'g' },
    { label: 'azúcar', perUnit: food.sugar_g, unit: 'g' },
    { label: 'sodio', perUnit: food.sodium_mg, unit: 'mg' },
  ];

  const round = (value: number) => roundAmount(Math.round(value * 100) / 100);

  return (
    <View style={styles.bubble}>
      <Text style={styles.head}>
        por {reference} ({roundAmount(quantity)} {unitLabel(food, quantity)})
      </Text>
      {rows.map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={styles.label}>{row.label}</Text>
          {row.perUnit === null ? (
            <Text style={styles.missing}>sin dato</Text>
          ) : (
            <Text style={styles.value}>
              {round(row.perUnit * per)} ({round(row.perUnit * quantity)}) {row.unit}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: 8,
    backgroundColor: theme.bg,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
    gap: 2,
    alignSelf: 'flex-start',
    minWidth: 200,
  },
  head: {
    fontSize: 10,
    color: theme.textGhost,
    fontFamily: mono,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  label: {
    fontSize: 11,
    color: theme.textFaint,
    fontFamily: mono,
  },
  value: {
    fontSize: 11,
    color: theme.text,
    fontFamily: mono,
  },
  missing: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
});
