import { Text, View } from 'react-native';

import type { NutritionFoodRow } from '../db/types.ts';
import { referenceAmount, roundAmount, unitLabel } from '../nutrition/index.ts';

import { font, sheet } from './theme.ts';

/**
 * Lo que aporta una porcion, sin repetir el nombre del alimento.
 *
 * Dos numeros por fila: lo que dice la ficha y, entre parentesis, lo que suman los
 * que se comio. Asi la misma burbuja responde "cuanto trae uno" y "cuanto me meti",
 * que son las dos preguntas y hasta ahora habia que hacer la cuenta a mano.
 *
 * Sin borde ni fondo propios: esto va dentro del globo de la (i) (`InfoBubble`), que ya
 * los pone.
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
  const reference = food.unit_kind === 'count' ? `1 ${food.base_unit}` : `${per} ${food.base_unit}`;

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

const styles = sheet((theme) => ({
  bubble: {
    gap: 3,
    alignSelf: 'stretch',
  },
  head: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 0.6,
    color: theme.textFaint,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  label: {
    fontSize: 13,
    color: theme.text,
    fontFamily: font.bold,
  },
  value: {
    fontSize: 13,
    color: theme.text,
    fontFamily: font.black,
    fontVariant: ['tabular-nums'],
  },
  missing: {
    fontSize: 13,
    color: theme.textFaint,
    fontFamily: font.regular,
  },
}));
