import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from './icons.ts';

import { font, hardShadow, pressed as pressedInto, sheet, shape, theme } from './theme.ts';

/**
 * Una opcion de una lista corta: la fase, la unidad, los filtros, los avisos.
 *
 * Elegida se levanta del papel y se pinta de amarillo; sin elegir se queda plana. El
 * relieve es la senal, no el color, que es lo mismo que pide la spec 4.5 para los
 * cuadritos y vale igual aqui.
 */
export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function Chip({
  label,
  selected = false,
  onPress,
  icon: Icon,
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
        pressed && !disabled && (selected ? styles.pressed : styles.pressedFlat),
        style,
      ]}
    >
      <View style={styles.inner}>
        {Icon ? <Icon size={14} color={tint} strokeWidth={2.5} /> : null}
        <Text style={[styles.label, { color: tint }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = sheet((theme) => ({
  chip: {
    minHeight: 38,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontFamily: font.bold,
  },
  on: {
    backgroundColor: theme.accent,
    ...hardShadow(theme, 3),
  },
  off: {
    backgroundColor: theme.surface,
  },
  disabled: {
    backgroundColor: 'transparent',
    borderColor: theme.lineSoft,
    shadowOpacity: 0,
  },
  pressed: pressedInto(3),
  pressedFlat: {
    opacity: 0.7,
  },
}));
