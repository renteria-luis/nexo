// Un solo lugar donde vive el color, la tipografia y la forma de toda la app.
//
// La direccion es neobrutalismo: fondo crema, borde negro grueso en todo lo que se
// toca, sombra dura sin difuminar desplazada abajo y a la derecha, y colores planos
// muy saturados. Al presionar, el elemento se mete dentro de su propia sombra. Esa
// ultima regla es la que hace que un boton se sienta pulsado sin animar nada.
//
// Hubo un modo oscuro y se quito el 2026-09-26: se veia mal y el modo claro es el que
// se esta terminando. Volveria como una segunda Palette y un cambio dentro de este
// archivo, sin tocar ninguna pantalla.
//
// Las paletas del daltonismo (spec 4.5) no viven aqui: son solo para los cuadritos de
// la cuadricula y estan en core/palettes.ts.

import { StyleSheet } from 'react-native';

export type Palette = {
  bg: string;
  surface: string;
  surfaceHigh: string;
  /** El borde de todo lo que se toca, y el color de la sombra dura. */
  line: string;
  lineSoft: string;
  lineStrong: string;
  shadow: string;

  text: string;
  textDim: string;
  textFaint: string;
  textGhost: string;

  accent: string;
  accentInk: string;
  /** La misma tinta negra pero apagada, para lo secundario sobre un color plano. */
  accentInkSoft: string;

  ok: string;
  okBg: string;
  warn: string;
  warnBg: string;
  danger: string;
  info: string;
  infoBg: string;
  infoLine: string;
};

/** Los colores planos del neobrutalismo, los mismos en claro y en oscuro. */
const YELLOW = '#ffdc58';
const LIME = '#a3e636';
const BLUE = '#88aaee';
const CORAL = '#ff6b6b';
const ORANGE = '#ff9f45';

export const LIGHT: Palette = {
  bg: '#fff4e0',
  surface: '#fffdf7',
  surfaceHigh: '#ffe8b8',
  line: '#121212',
  lineSoft: '#c9c2b0',
  lineStrong: '#121212',
  shadow: '#121212',

  text: '#121212',
  textDim: '#2e2a24',
  textFaint: '#5c564b',
  textGhost: '#857e70',

  accent: YELLOW,
  accentInk: '#121212',
  accentInkSoft: 'rgba(18, 18, 18, 0.68)',

  ok: LIME,
  okBg: '#eaf8cf',
  warn: ORANGE,
  warnBg: '#ffe9d2',
  danger: CORAL,
  info: BLUE,
  infoBg: '#e3ebff',
  infoLine: '#121212',
};

/** Las medidas que hacen el estilo: borde grueso, esquina poca y sombra desplazada. */
export const shape = {
  border: 2,
  radius: 10,
  radiusSmall: 7,
  /** Solo para la barra flotante de abajo: una isla suelta pide la esquina mas blanda. */
  radiusLarge: 25,
  shadowOffset: 4,
} as const;

/**
 * La sombra dura del neobrutalismo: sin difuminar y opaca del todo, para que se lea
 * como un recorte de papel y no como una sombra de verdad.
 */
export function hardShadow(palette: Palette, offset: number = shape.shadowOffset) {
  return {
    shadowColor: palette.shadow,
    shadowOffset: { width: offset, height: offset },
    shadowOpacity: 1,
    shadowRadius: 0,
    // Android no tiene sombras sin difuminar, asi que alli se cae con elegancia a
    // ninguna sombra en vez de a una mancha gris.
    elevation: 0,
  };
}

/** Lo que se mueve un elemento al presionarlo, que es justo lo que mide su sombra. */
export function pressed(offset: number = shape.shadowOffset) {
  return {
    transform: [{ translateX: offset }, { translateY: offset }],
    shadowOpacity: 0,
  };
}

export const font = {
  regular: 'Nunito_400Regular',
  bold: 'Nunito_700Bold',
  black: 'Nunito_800ExtraBold',
  /**
   * La voz de la app: solo para el titulo de una pantalla y el numero grande de la
   * nota. Archivo Black no tiene pesos ni cursivas, es una sola losa; usarla en mas
   * sitios que esos dos convierte la pantalla en un cartel ilegible.
   */
  display: 'ArchivoBlack_400Regular',
} as const;

/** Nombre viejo de la fuente de datos. Ahora todo es Nunito, con cifras tabulares. */
export const mono = font.bold;

/** La paleta de la app. Una sola: el modo oscuro se quito el 2026-09-26. */
export const theme: Palette = LIGHT;

/**
 * Una hoja de estilos que recibe la paleta.
 *
 * Se usa igual que StyleSheet.create. Existia para poder rehacer las hojas al cambiar
 * de modo; ahora que hay una sola paleta se queda porque es como estan escritas las
 * cuarenta hojas de la app, y porque el dia que vuelva el modo oscuro el cambio es
 * otra vez de este archivo para dentro.
 */
export function sheet<T extends StyleSheet.NamedStyles<T>>(
  // La misma forma que StyleSheet.create, para que un estilo mal escrito siga
  // fallando aqui y no en el telefono.
  make: (palette: Palette) => T,
): T {
  return StyleSheet.create(make(theme));
}
