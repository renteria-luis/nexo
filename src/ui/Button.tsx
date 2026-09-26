import { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { LoaderCircle, type LucideIcon } from './icons.ts';
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
  /** Mientras la accion tarda: gira en el sitio del icono y no acepta otro toque. */
  loading?: boolean;
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
  loading = false,
  disabled = false,
  block = false,
  accessibilityLabel,
  style,
}: ButtonProps) {
  const tint = disabled ? theme.textGhost : tintFor(variant);
  const large = size === 'large';
  const glyph = large ? 18 : 16;
  const [spin] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!loading) return;
    spin.setValue(0);
    const turning = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        // Por el hilo nativo: gira aunque el hilo de JavaScript este ocupado con lo
        // que se esta esperando, que es justo cuando se ve el giro. En el navegador se
        // queda quieto, porque react-native-web no lleva rotaciones por ese hilo.
        useNativeDriver: true,
      }),
    );
    turning.start();
    return () => turning.stop();
  }, [loading, spin]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        large && styles.large,
        styles[variant],
        block && styles.block,
        disabled && styles.disabled,
        pressed && !disabled && !loading && variant !== 'ghost' && styles.pressed,
        pressed && !loading && variant === 'ghost' && styles.pressedGhost,
        style,
      ]}
    >
      <View style={styles.inner}>
        {loading ? (
          <Animated.View
            style={{
              transform: [
                {
                  rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
                },
              ],
            }}
          >
            <LoaderCircle size={glyph} color={tint} strokeWidth={2.5} />
          </Animated.View>
        ) : Icon ? (
          <Icon size={glyph} color={tint} strokeWidth={2.25} />
        ) : null}
        <Text style={[styles.label, large && styles.labelLarge, { color: tint }]}>{label}</Text>
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
