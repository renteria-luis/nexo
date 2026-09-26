import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from './icons.ts';

import { font, hardShadow, pressed as pressedInto, sheet, shape, theme } from './theme.ts';

/**
 * El boton de la app, en tres pesos.
 *
 * Existe porque el mismo boton estaba escrito doce veces con doce alturas distintas,
 * y porque con el telefono en una mano y una mancuerna en la otra lo que decide si
 * algo se puede tocar es el area, no el color. Apple pide 44 puntos de alto minimo y
 * los dos tamanos de aqui empiezan ahi.
 *
 * Al presionarlo se mete dentro de su propia sombra en vez de aclararse: se nota con
 * el rabillo del ojo y sin mirar la pantalla, que es el punto en el gimnasio.
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

/** La tinta se lee al pintar, no al cargar el archivo: la paleta cambia en caliente. */
function tintFor(variant: NonNullable<ButtonProps['variant']>): string {
  switch (variant) {
    case 'primary':
      return theme.accentInk;
    case 'danger':
      return theme.accentInk;
    case 'ghost':
      return theme.textFaint;
    case 'secondary':
      return theme.text;
  }
}

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
  const tint = disabled ? theme.textGhost : tintFor(variant);

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
        pressed && !disabled && variant !== 'ghost' && styles.pressed,
        pressed && variant === 'ghost' && styles.pressedGhost,
        style,
      ]}
    >
      <View style={styles.inner}>
        {Icon ? <Icon size={size === 'large' ? 18 : 16} color={tint} strokeWidth={2.25} /> : null}
        <Text style={[styles.label, size === 'large' && styles.labelLarge, { color: tint }]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = sheet((theme) => ({
  base: {
    minHeight: 44,
    borderRadius: shape.radius,
    borderWidth: shape.border,
    borderColor: theme.line,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...hardShadow(theme),
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
    fontSize: 15,
    fontFamily: font.black,
    textAlign: 'center',
  },
  labelLarge: {
    fontSize: 17,
  },
  primary: {
    backgroundColor: theme.accent,
  },
  secondary: {
    backgroundColor: theme.surface,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    minHeight: 40,
    paddingHorizontal: 8,
    shadowOpacity: 0,
  },
  danger: {
    backgroundColor: theme.danger,
  },
  disabled: {
    backgroundColor: 'transparent',
    borderColor: theme.lineSoft,
    shadowOpacity: 0,
  },
  pressed: pressedInto(),
  pressedGhost: {
    opacity: 0.6,
  },
}));
