import type { ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { font, hardShadow, pressed as pressedInto, sheet, shape } from './theme.ts';

/**
 * La cartilla: una hoja de papel con borde de tinta y sombra dura debajo.
 *
 * Todo lo que en la app es "un bloque de informacion" pasa por aqui, porque la unica
 * forma de que el relieve se lea es que todos los bloques lo tengan igual. Una que se
 * toca se mete dentro de su propia sombra, lo mismo que un boton: si se hunde, se
 * puede tocar.
 */
export type CardTone = 'paper' | 'accent' | 'ok' | 'warn' | 'info' | 'danger';

export type CardProps = {
  children: ReactNode;
  title?: string;
  /** El color de la hoja. El color dice de que va la cartilla antes de leerla. */
  tone?: CardTone;
  /** Sin relieve, para lo que esta apagado o solo acompana. */
  raised?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function Card({
  children,
  title,
  tone = 'paper',
  raised = true,
  onPress,
  accessibilityLabel,
  style,
}: CardProps) {
  const inside = (
    <>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </>
  );

  if (!onPress) {
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        style={[styles.card, styles[tone], !raised && styles.flat, style]}
      >
        {inside}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        styles[tone],
        !raised && styles.flat,
        pressed && raised && styles.pressed,
        pressed && !raised && styles.pressedFlat,
        style,
      ]}
    >
      {inside}
    </Pressable>
  );
}

const styles = sheet((theme) => ({
  card: {
    alignSelf: 'stretch',
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radius,
    padding: 14,
    gap: 8,
    ...hardShadow(theme),
  },
  flat: {
    shadowOpacity: 0,
  },
  pressed: pressedInto(),
  pressedFlat: {
    opacity: 0.75,
  },
  title: {
    fontSize: 16,
    fontFamily: font.black,
    color: theme.text,
  },
  paper: {
    backgroundColor: theme.surface,
  },
  accent: {
    backgroundColor: theme.accent,
  },
  ok: {
    backgroundColor: theme.okBg,
  },
  warn: {
    backgroundColor: theme.warnBg,
  },
  info: {
    backgroundColor: theme.infoBg,
  },
  danger: {
    backgroundColor: theme.danger,
  },
}));
