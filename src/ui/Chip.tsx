import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from './icons.ts';

import { font, glass, gloss, pressed as pressedInto, sheet, shape, theme } from './theme.ts';

/**
 * Una opcion de una lista corta: la fase, la unidad, los filtros, los avisos.
 *
 * Elegida se llena de ambar con tinta oscura; sin elegir es translucida con letra
 * clara. La senal es la claridad, no el tono, que es lo mismo que pide la spec 4.5 para
 * los cuadritos y vale igual aqui.
 */
export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: LucideIcon;
  /** Un punto de color antes de la palabra, como el de una linea de bus. */
  dot?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function Chip({
  label,
  selected = false,
  onPress,
  icon: Icon,
  dot,
  disabled = false,
  accessibilityLabel,
  style,
}: ChipProps) {
  const tint = disabled ? theme.textGhost : selected ? theme.accentInk : theme.text;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.on : styles.off,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      <View style={styles.inner}>
        {Icon ? <Icon size={14} color={tint} strokeWidth={2.5} /> : null}
        {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
        {/* Un chip que es solo un icono no lleva texto vacio: dejaria el hueco a su lado. */}
        {label !== '' && <Text style={[styles.label, { color: tint }]}>{label}</Text>}
      </View>
    </Pressable>
  );
}

const styles = sheet((theme) => ({
  chip: {
    minHeight: 38,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 19,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: shape.border,
    borderColor: theme.line,
  },
  label: {
    fontSize: 13,
    fontFamily: font.bold,
  },
  on: gloss(theme.accent),
  off: glass.control,
  disabled: {
    ...glass.none,
    backgroundColor: 'transparent',
    borderColor: theme.lineSoft,
  },
  pressed: pressedInto(),
}));
