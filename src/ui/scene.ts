import { createContext, type RefObject } from 'react';
import type { Animated, View } from 'react-native';

import type { Background } from '../core/backgrounds.ts';

/**
 * Lo que una tarjeta necesita para dibujar detras de si el pedazo de fondo que tapa: el
 * fondo de su pantalla, cuanto se ha desplazado la pantalla y desde donde medirse. Solo
 * existe dentro de lo que se desplaza en una pantalla; fuera (hojas, globos) es null.
 */
export type Scene = {
  background: Background;
  /** Lo desplazado, animado por el hilo nativo: mueve el pedazo de fondo sin pasar por JS. */
  scrollY: Animated.Value;
  /** Lo desplazado al momento, para convertir lo medido en la ventana a la pantalla quieta. */
  offset: RefObject<number>;
  /** El marco de la pantalla: lo medido contra el no cambia al deslizar entre pestanas. */
  frame: RefObject<View | null>;
  /** Cambia cuando el contenido cambia de alto, para que las tarjetas se vuelvan a medir. */
  epoch: number;
};

export const SceneContext = createContext<Scene | null>(null);
