import type { RefObject } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import type { Background } from '../core/backgrounds.ts';

/** Lo que se desenfoca la pantalla detras de una hoja, en puntos a tamano de pantalla. */
export const BLUR = 20;

export type ScreenBlurProps = {
  /** Lo que se fotografia: el contenido, sin la hoja. */
  target: RefObject<ScrollView | null>;
  /** El marco donde va la hoja, para saber donde cae en la ventana. */
  frame: RefObject<View | null>;
  background: Background;
};

/**
 * La pantalla desenfocada detras de una hoja, en el navegador: ahi lo hace el propio
 * navegador. La captura que usa el telefono (ScreenBlur.native.tsx) en la web pinta de
 * blanco lo transparente, y detras de la hoja se veia un velo blanco.
 */
export function ScreenBlur(_: ScreenBlurProps) {
  return <View pointerEvents="none" style={styles.blur} />;
}

const styles = StyleSheet.create({
  // React Native no lo declara, pero react-native-web lo pasa tal cual al CSS.
  blur: { ...StyleSheet.absoluteFill, backdropFilter: `blur(${BLUR}px)` } as ViewStyle,
});
