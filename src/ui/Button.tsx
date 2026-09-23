import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { mono, theme } from './theme.ts';

/**
 * El boton de la app, en tres pesos.
 *
 * Existe porque el mismo boton estaba escrito doce veces con doce alturas distintas,
 * y porque con el telefono en una mano y una mancuerna en la otra lo que decide si
 * algo se puede tocar es el area, no el color. Apple pide 44 puntos de alto minimo y
 * los dos tamanos de aqui empiezan ahi.
 */
export type ButtonProps = {
  label: string;
  onPress: () => void;
  /** primary manda la accion de la pantalla, secondary acompana, ghost casi no pesa. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'regular' | 'large';
  icon?: LucideIcon;
  disabled?: boolean;
  /** Ocupa todo el ancho. Lo normal para la accion principal de una pantalla. */
  block?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

const TINT: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: theme.accentInk,
  secondary: theme.text,
  ghost: theme.textFaint,
  danger: theme.danger,
};

export function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 'regular',
  icon: Icon,
  disabled = false,
  block = false,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const tint = disabled ? theme.textGhost : TINT[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === 'large' && styles.large,
        styles[variant],
        block && styles.block,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      <View style={styles.inner}>
        {Icon ? <Icon size={size === 'large' ? 18 : 16} color={tint} strokeWidth={1.75} /> : null}
        <Text style={[styles.label, size === 'large' && styles.labelLarge, { color: tint }]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  large: {
    minHeight: 52,
    paddingHorizontal: 20,
  },
  block: {
    alignSelf: 'stretch',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontFamily: mono,
    textAlign: 'center',
  },
  labelLarge: {
    fontSize: 16,
  },
  primary: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  secondary: {
    backgroundColor: theme.surface,
    borderColor: theme.lineStrong,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    minHeight: 40,
    paddingHorizontal: 8,
  },
  danger: {
    backgroundColor: 'transparent',
    borderColor: theme.danger,
  },
  disabled: {
    backgroundColor: 'transparent',
    borderColor: theme.line,
  },
  pressed: {
    opacity: 0.72,
  },
});
