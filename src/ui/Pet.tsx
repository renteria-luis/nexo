import type { ComponentProps } from 'react';
import { Animated, View } from 'react-native';

import { Glass } from './Glass.tsx';
import { sheet } from './theme.ts';

/**
 * La bola: por ahora solo es eso, una bola. Sera el asistente, y su cara se decide
 * despues.
 *
 * Solo el dibujo. Donde esta, a donde va y que la arrastra es cosa de `Assistant`, que
 * es quien lleva a la vez la bola y la ventana que cuelga de ella.
 *
 * De vidrio mientras flota sobre la app, para no tapar del todo lo que hay debajo, y
 * encendida en ambar cuando se la agarra o cuando hay chat abierto: ahi es quien habla,
 * no un adorno. Encendida no es bajarle la opacidad al vidrio, que con menos de uno
 * deja de dibujarse.
 */
export const PET_SIZE = 56;

export function Ball({
  pos,
  scale,
  lit,
  handlers,
}: {
  pos: Animated.ValueXY;
  /** Chica cuando esta guardada en la barra de arriba. */
  scale: Animated.Value;
  lit: boolean;
  handlers: ComponentProps<typeof Animated.View>;
}) {
  return (
    <Animated.View
      accessibilityRole="button"
      accessibilityLabel="Asistente"
      style={[styles.ball, { transform: [...pos.getTranslateTransform(), { scale }] }]}
      {...handlers}
    >
      {lit ? (
        <View style={[styles.round, styles.lit]} />
      ) : (
        <Glass style={[styles.round, styles.resting]}>
          <View style={styles.core} />
        </Glass>
      )}
    </Animated.View>
  );
}

const styles = sheet((theme) => ({
  ball: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: PET_SIZE,
    height: PET_SIZE,
  },
  round: {
    width: PET_SIZE,
    height: PET_SIZE,
    borderRadius: PET_SIZE / 2,
  },
  lit: {
    backgroundColor: theme.accent,
  },
  resting: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.accent,
  },
}));
