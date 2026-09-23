// Un solo lugar donde vive el color y la tipografia de toda la app.
//
// La direccion es una terminal: fondo casi negro, texto monoespaciado para lo que
// son datos, y el resto en la fuente del sistema porque un parrafo en espanol se lee
// peor en mono. Lo seleccionado se marca en video inverso, que es lo que hace una
// consola y no deja dudas de que esta activo.
//
// No es negro puro sobre blanco puro a proposito: ese contraste cansa la vista de
// noche, que es cuando mas mira esto. Los grises de texto estan sobre el fondo por
// encima de 4.5 a 1, que es el minimo legible.

import { Platform } from 'react-native';

export const theme = {
  bg: '#0d0d0d',
  surface: '#161616',
  surfaceHigh: '#1f1f1f',
  line: '#2b2b2b',
  lineSoft: '#1d1d1d',
  lineStrong: '#3f3f3f',

  text: '#e6e6e6',
  textDim: '#bdbdbd',
  textFaint: '#9a9a9a',
  textGhost: '#8c8c8c',

  /** El color del prompt y de lo que esta seleccionado. */
  accent: '#7fd1ff',
  /** Texto encima del acento, que es fondo claro. */
  accentInk: '#05202c',

  ok: '#5fd08a',
  okBg: '#12261b',
  warn: '#e0b755',
  warnBg: '#2a2410',
  danger: '#ff6f61',
  info: '#9cc3ef',
  infoBg: '#16202b',
  infoLine: '#2a3d52',
} as const;

/** La mono del sistema: no hay que empaquetar ninguna fuente ni esperar a que cargue. */
export const mono = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'ui-monospace, Menlo, Consolas, monospace',
}) as string;
