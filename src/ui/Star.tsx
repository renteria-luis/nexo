import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { shape, theme } from './theme.ts';

/**
 * La estrella de golpe del neobrutalismo: el sticker de papel pegado encima.
 *
 * Es lo unico decorativo de la app y por eso hay una sola en cada pantalla, con un
 * numero dentro que significa algo. Una estrella vacia es adorno; con la racha dentro
 * es el dato que mas le importa, puesto donde el ojo cae primero.
 */
export function Star({
  size,
  color,
  points = 12,
  children,
  style,
}: {
  size: number;
  color: string;
  /** Picos. Doce da el sello de oferta; menos de ocho parece una estrella de premio. */
  points?: number;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const center = size / 2;
  // El trazo se dibuja a caballo del contorno, asi que la punta se mete media raya
  // para que no la corte el borde del dibujo.
  const outer = center - shape.border / 2;
  const inner = outer * 0.76;

  const corners: string[] = [];
  for (let corner = 0; corner < points * 2; corner += 1) {
    const radius = corner % 2 === 0 ? outer : inner;
    const angle = (Math.PI * corner) / points - Math.PI / 2;
    corners.push(`${center + radius * Math.cos(angle)},${center + radius * Math.sin(angle)}`);
  }

  return (
    <View style={[{ width: size, height: size }, styles.frame, style]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Polygon
          points={corners.join(' ')}
          fill={color}
          stroke={theme.line}
          strokeWidth={shape.border}
        />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
