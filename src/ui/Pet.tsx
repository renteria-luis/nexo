import type { ComponentProps } from 'react';
import { Animated } from 'react-native';

import { hardShadow, sheet, shape } from './theme.ts';

/**
 * La bola: por ahora solo es eso, una bola. Sera el asistente, y su cara se decide
 * despues.
 *
 * Solo el dibujo. Donde esta, a donde va y que la arrastra es cosa de `Assistant`, que
 * es quien lleva a la vez la bola y la ventana que cuelga de ella.
 *
 * Semitransparente mientras flota sobre la app, para no tapar del todo lo que hay
 * debajo, y encendida cuando se la agarra o cuando hay chat abierto: ahi es quien
 * habla, no un adorno.
 */
export const PET_SIZE = 56;

export function Ball({
  pos,
  lit,
  handlers,
}: {
  pos: Animated.ValueXY;
  lit: boolean;
  handlers: ComponentProps<typeof Animated.View>;
}) {
  return (
    <Animated.View
      accessibilityRole="button"
      accessibilityLabel="Asistente"
      style={[styles.ball, { opacity: lit ? 1 : 0.8, transform: pos.getTranslateTransform() }]}
      {...handlers}
    />
  );
}

const styles = sheet((theme) => ({
  ball: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: PET_SIZE,
    height: PET_SIZE,
    borderRadius: PET_SIZE / 2,
    backgroundColor: theme.accent,
    borderWidth: shape.border,
    borderColor: theme.line,
    ...hardShadow(theme, 3),
  },
}));
