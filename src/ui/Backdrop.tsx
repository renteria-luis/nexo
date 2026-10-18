import { createContext, memo, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { Animated, Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import {
  backgroundFor,
  DEFAULT_BACKGROUND,
  photoFrame,
  type Background,
  type Direction,
} from '../core/backgrounds.ts';
import { useBackgrounds } from './background-editing.tsx';

import { theme } from './theme.ts';

/** Where the three blobs sit, as fractions of the view; the radius is a fraction of its width. */
const BLOBS = [
  { x: 0.12, y: 0.08, r: 1, opacity: 0.55 },
  { x: 0.95, y: 0.38, r: 0.7, opacity: 0.42 },
  { x: 0.25, y: 0.88, r: 0.94, opacity: 0.38 },
] as const;

const DIRECTIONS: Record<Direction, { x2: string; y2: string }> = {
  down: { x2: '0', y2: '1' },
  diagonal: { x2: '1', y2: '1' },
  across: { x2: '1', y2: '0' },
};

type Position = Animated.AnimatedInterpolation<number>;

/**
 * Lo que mueve las paginas de las pestanas, para que el fondo de una se funda con el de la
 * siguiente mientras se desliza. Lo publica la barra de abajo, que es quien lo recibe.
 */
export const PagerPosition = createContext<{
  position: Position | null;
  setPosition: (position: Position) => void;
}>({ position: null, setPosition: () => undefined });

export function PagerPositionProvider({ children }: { children: ReactNode }) {
  const [position, setPosition] = useState<Position | null>(null);
  const value = useMemo(() => ({ position, setPosition }), [position]);
  return <PagerPosition.Provider value={value}>{children}</PagerPosition.Provider>;
}

/**
 * Un fondo dibujado a un tamano dado: manchas, color, degradado o foto. Lo usan la app,
 * a tamano de ventana, y la vista previa de Fondos, en chico; `scale` es lo que mide la
 * vista contra la ventana, para que el desenfoque se vea igual en los dos.
 */
export const BackgroundView = memo(function BackgroundView({
  background,
  width,
  height,
  scale = 1,
  onMissing,
}: {
  background: Background;
  width: number;
  height: number;
  scale?: number;
  /** La foto ya no esta en el telefono (un respaldo traido de otro, por ejemplo). */
  onMissing?: () => void;
}) {
  // En el navegador los nombres de los degradados son de toda la pagina.
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [missing, setMissing] = useState<string | null>(null);
  const shown =
    background.kind === 'photo' && missing === background.uri ? DEFAULT_BACKGROUND : background;

  switch (shown.kind) {
    case 'color':
      return <View style={[StyleSheet.absoluteFill, { backgroundColor: shown.color }]} />;
    case 'photo': {
      const frame = photoFrame(shown, { width, height });
      return (
        <View style={[StyleSheet.absoluteFill, styles.base]}>
          <Image
            source={{ uri: shown.uri }}
            blurRadius={shown.blur * scale}
            onError={() => {
              setMissing(shown.uri);
              onMissing?.();
            }}
            style={[styles.photo, frame]}
          />
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0, 0, 0, ${shown.dim})` }]}
          />
        </View>
      );
    }
    case 'gradient':
      return (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={`fill${id}`} x1="0" y1="0" {...DIRECTIONS[shown.direction]}>
              {shown.colors.map((color, index) => (
                <Stop key={index} offset={index / (shown.colors.length - 1)} stopColor={color} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect width={width} height={height} fill={`url(#fill${id})`} />
        </Svg>
      );
    case 'blobs':
      return (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            {BLOBS.map((blob, index) => (
              <RadialGradient
                key={index}
                id={`blob${index}${id}`}
                cx={blob.x * width}
                cy={blob.y * height}
                r={blob.r * width}
                gradientUnits="userSpaceOnUse"
              >
                <Stop offset={0} stopColor={shown.colors[index]} stopOpacity={blob.opacity} />
                <Stop offset={1} stopColor={shown.colors[index]} stopOpacity={0} />
              </RadialGradient>
            ))}
          </Defs>
          <Rect width={width} height={height} fill={theme.bg} />
          {BLOBS.map((_, index) => (
            <Rect key={index} width={width} height={height} fill={`url(#blob${index}${id})`} />
          ))}
        </Svg>
      );
  }
});

/**
 * El fondo de una pantalla, siempre del tamano de la ventana y subido `offset` puntos.
 *
 * Se dibuja dos veces por pantalla: un trozo detras de la barra de arriba y el resto
 * detras del contenido. Cortado asi, cada trozo es la misma ventana corrida, y la union
 * entre los dos no se ve. Uno solo detras de todo no sirve: las pantallas apiladas tienen
 * que ser opacas o durante el deslizamiento se ve la de abajo a traves.
 *
 * Con varias pantallas (las tres pestanas) pinta el fondo de cada una y los funde con lo
 * que mueve las paginas: al deslizar de Hoy a Entreno, el de Entreno aparece encima.
 */
export function Backdrop({ screens, offset = 0 }: { screens: readonly string[]; offset?: number }) {
  const { width, height } = useWindowDimensions();
  const { position } = useContext(PagerPosition);
  // Mientras se prueba un fondo, esa pantalla dibuja el borrador en vez de lo guardado.
  const all = useBackgrounds();
  const layers = useMemo(() => screens.map((screen) => backgroundFor(all, screen)), [all, screens]);
  // Tres veces el mismo fondo no se funde: se dibuja una vez.
  const same = layers.every((layer) => layer === layers[0]);

  return (
    <View pointerEvents="none" style={styles.clip}>
      {(same || position === null ? layers.slice(0, 1) : layers).map((layer, index) => (
        <Animated.View
          key={index}
          style={[
            styles.layer,
            { top: -offset, width, height },
            index > 0 &&
              position !== null && {
                opacity: position.interpolate({
                  inputRange: [index - 1, index],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
              },
          ]}
        >
          <BackgroundView background={layer} width={width} height={height} />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
    backgroundColor: theme.bg,
  },
  layer: {
    position: 'absolute',
    left: 0,
  },
  base: {
    backgroundColor: theme.bg,
    overflow: 'hidden',
  },
  photo: {
    position: 'absolute',
  },
});
