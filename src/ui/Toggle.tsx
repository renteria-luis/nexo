import { useEffect, useState } from 'react';
import { Animated, Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { sheet, shape } from './theme.ts';

/**
 * El interruptor: una sola cosa que se prende y se apaga.
 *
 * Misma receta que la de la referencia del estilo: pastilla con borde de tinta, blanca
 * apagada y amarilla prendida, y una bolita con su propio borde que se corre de un lado
 * al otro. Se mueve en 130 ms porque un interruptor que salta de golpe se lee como un
 * error de dibujo; la bolita y el color van los dos por el hilo de animacion nativo,
 * asi que no cuesta nada.
 *
 * Para elegir entre tres cosas o mas, esto no sirve: eso son chips. Y para un dato que
 * puede estar sin anotar, tampoco, porque apagado y sin anotar se verian igual.
 */
const TRACK_WIDTH = 56;
const TRACK_HEIGHT = 30;
const THUMB = 22;
/** Lo que se corre la bolita: el ancho menos los bordes, el aire y ella misma. */
const TRAVEL = TRACK_WIDTH - shape.border * 2 - 4 - THUMB;

export type ToggleProps = {
  value: boolean;
  onChange: (next: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Toggle({
  value,
  onChange,
  accessibilityLabel,
  disabled = false,
  style,
}: ToggleProps) {
  const [slide] = useState(() => new Animated.Value(value ? 1 : 0));

  useEffect(() => {
    Animated.timing(slide, {
      toValue: value ? 1 : 0,
      duration: 130,
      useNativeDriver: true,
    }).start();
  }, [value, slide]);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      // El interruptor mide 30 de alto y el dedo pide 44: el resto lo pone el toque.
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      style={[styles.track, disabled && styles.trackOff, style]}
    >
      <Animated.View style={[styles.fill, { opacity: slide }]} />
      <Animated.View
        style={[
          styles.thumb,
          disabled && styles.thumbOff,
          {
            transform: [
              { translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] }) },
            ],
          },
        ]}
      />
    </Pressable>
  );
}

const styles = sheet((theme) => ({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: shape.border,
    borderColor: theme.line,
    backgroundColor: theme.surface,
    justifyContent: 'center',
    paddingHorizontal: 2,
    // La capa de color va dentro de la pastilla, asi que se recorta con ella.
    overflow: 'hidden',
  },
  trackOff: {
    borderColor: theme.lineSoft,
    backgroundColor: 'transparent',
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.accent,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: shape.border,
    borderColor: theme.line,
    backgroundColor: theme.surface,
  },
  thumbOff: {
    borderColor: theme.lineSoft,
    backgroundColor: theme.lineSoft,
  },
}));
