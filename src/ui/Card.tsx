import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { CardFrost } from './CardFrost.tsx';
import { font, glass, gloss, pressed as pressedInto, sheet, shape } from './theme.ts';

/**
 * La cartilla: un panel de vidrio con su brillo y su sombra, encima del fondo de la app.
 *
 * Todo lo que en la app es "un bloque de informacion" pasa por aqui, para que todos los
 * bloques se vean iguales. Una que se toca se apaga y se encoge un poco al presionarla,
 * lo mismo que un boton.
 */
export type CardTone = 'paper' | 'accent' | 'ok' | 'warn' | 'info' | 'danger';

export type CardProps = {
  children: ReactNode;
  title?: string;
  /** Algo pequeno pegado a la derecha del titulo, como el rango de una grafica. */
  action?: ReactNode;
  /** Un color lleno para lo que tiene que llamar la atencion. Encima va tinta oscura. */
  tone?: CardTone;
  /** Con el filo apagado, para lo que esta apagado o solo acompana. */
  raised?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function Card({
  children,
  title,
  action,
  tone = 'paper',
  raised = true,
  onPress,
  accessibilityLabel,
  style,
}: CardProps) {
  // El panel de vidrio desenfoca y oscurece un poco lo que tiene detras, sea cual sea el
  // fondo elegido (2026-10-18, a peticion suya): sobre una foto, la tarjeta se separa de
  // ella y lo de encima se lee. Un color lleno ya tapa lo de detras y no lo necesita.
  const frost = tone === 'paper';
  const inside = (
    <>
      {/* Capas propias y no el fondo de la tarjeta: si la tarjeta recortara, se comeria
          su sombra. La luz del vidrio va encima del esmerilado, que si no la apagaria. */}
      {frost && <CardFrost radius={shape.radius - shape.border} />}
      {frost && <View pointerEvents="none" style={styles.frostLight} />}
      {title && action ? (
        <View style={styles.head}>
          <Text style={[styles.title, styles.grow, tone !== 'paper' && styles.titleOnColor]}>
            {title}
          </Text>
          {action}
        </View>
      ) : title ? (
        <Text style={[styles.title, tone !== 'paper' && styles.titleOnColor]}>{title}</Text>
      ) : null}
      {children}
    </>
  );

  if (!onPress) {
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        style={[styles.card, styles[tone], !raised && styles.flat, frost && styles.frosted, style]}
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
        frost && styles.frosted,
        pressed && styles.pressed,
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
    borderCurve: 'continuous',
    padding: 16,
    gap: 8,
  },
  flat: {
    borderColor: theme.lineSoft,
  },
  frosted: {
    backgroundColor: 'transparent',
    experimental_backgroundImage: [],
  },
  frostLight: {
    ...StyleSheet.absoluteFill,
    borderRadius: shape.radius,
    borderCurve: 'continuous',
    experimental_backgroundImage: glass.panel.experimental_backgroundImage,
  },
  pressed: pressedInto(),
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  grow: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontFamily: font.black,
    color: theme.text,
  },
  titleOnColor: {
    color: theme.accentInk,
  },
  paper: glass.panel,
  accent: gloss(theme.accent),
  ok: gloss(theme.ok),
  warn: gloss(theme.warn),
  info: gloss(theme.info),
  danger: gloss(theme.danger),
}));
