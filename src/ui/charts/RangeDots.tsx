import { Pressable, Text, View } from 'react-native';

import { Eye, EyeOff } from '../icons.ts';
import { font, sheet, shape, theme } from '../theme.ts';

/** Los rangos de una grafica, cada uno con su letra: semanal, mensual, trimestral y anual. */
export const CHART_RANGES = [
  { days: 7, letter: 'S', name: 'semanal' },
  { days: 30, letter: 'M', name: 'mensual' },
  { days: 90, letter: 'T', name: 'trimestral' },
  { days: 365, letter: 'A', name: 'anual' },
] as const;

/**
 * Cuatro circulitos al lado del titulo: cada grafica elige su propio rango, porque unas se
 * miran por semana y otras por mes o por anio.
 */
export function RangeDots({
  chart,
  days,
  onChange,
}: {
  /** El nombre de la grafica, para que VoiceOver diga de cual es cada circulo. */
  chart: string;
  days: number;
  onChange: (days: number) => void;
}) {
  return (
    <View style={styles.row}>
      {CHART_RANGES.map((range) => {
        const selected = range.days === days;
        return (
          <Pressable
            key={range.days}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${chart}, vista ${range.name}`}
            hitSlop={6}
            onPress={() => onChange(range.days)}
            style={[styles.dot, selected && styles.selected]}
          >
            <Text style={[styles.letter, selected && styles.letterSelected]}>{range.letter}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * El ojo junto a los circulitos, del mismo tamano. Abierto, cada dia tiene su hueco
 * aunque no haya dato; cerrado, quedan solo los dias con dato, uno detras de otro.
 */
export function GapsEye({
  chart,
  shown,
  onChange,
}: {
  chart: string;
  /** Si se ven los dias sin datos. */
  shown: boolean;
  onChange: (shown: boolean) => void;
}) {
  const Icon = shown ? Eye : EyeOff;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: shown }}
      accessibilityLabel={`${chart}, días sin datos`}
      hitSlop={6}
      onPress={() => onChange(!shown)}
      style={styles.dot}
    >
      <Icon size={13} color={theme.textDim} strokeWidth={2.5} />
    </Pressable>
  );
}

const styles = sheet((theme) => ({
  row: {
    flexDirection: 'row',
    gap: 4,
  },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: shape.border,
    borderColor: theme.line,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: {
    backgroundColor: theme.accent,
  },
  letter: {
    fontSize: 11,
    fontFamily: font.black,
    color: theme.textDim,
  },
  letterSelected: {
    color: theme.accentInk,
  },
}));
