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
  /** El papel calido de la isla de abajo, que no es blanco ni es el fondo. */
  surfaceWarm: string;
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

/**
 * Los colores planos del estilo, en su version pastel (2026-09-30, a peticion suya).
 *
 * Son los mismos cinco tonos de siempre, con la saturacion bajada y el brillo subido:
 * el amarillo sigue siendo el amarillo y el coral sigue leyendose como alarma, pero la
 * pantalla deja de gritar. La tinta sigue siendo negra encima de todos ellos, que es lo
 * que mantiene el contraste donde importa.
 */
const YELLOW = '#ffe9a8';
const LIME = '#cfeda6';
const BLUE = '#bccdf4';
const CORAL = '#ffb3b3';
const ORANGE = '#ffd0a3';

export const LIGHT: Palette = {
  bg: '#fff4e0',
  surface: '#fffdf7',
  surfaceHigh: '#ffeccb',
  surfaceWarm: '#f7e7c8',
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
  okBg: '#eef8de',
  warn: ORANGE,
  warnBg: '#ffeedd',
  danger: CORAL,
  info: BLUE,
  infoBg: '#eaf0ff',
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
 * Lo que se encogieron las sombras el 2026-09-30, a peticion suya: el relieve seguia
 * diciendo lo mismo mucho mas fino. Los botones conservan algo mas que el resto porque
 * ahi la sombra es lo que dice "esto se aprieta", y en una cartilla solo es el papel.
 *
 * Se aplica aqui y en ningun otro sitio para que la sombra y lo que se hunde un boton al
 * presionarlo no se puedan separar nunca.
 */
const SHRINK = { paper: 0.3, button: 0.4 } as const;

export type Relief = keyof typeof SHRINK;

function shift(offset: number, relief: Relief): number {
  return Math.round(offset * SHRINK[relief] * 10) / 10;
}

/**
 * La sombra dura del neobrutalismo: sin difuminar y opaca del todo, para que se lea
 * como un recorte de papel y no como una sombra de verdad.
 */
export function hardShadow(
  palette: Palette,
  offset: number = shape.shadowOffset,
  relief: Relief = 'paper',
) {
  return {
    shadowColor: palette.shadow,
    shadowOffset: { width: shift(offset, relief), height: shift(offset, relief) },
    shadowOpacity: 1,
    shadowRadius: 0,
    // Android no tiene sombras sin difuminar, asi que alli se cae con elegancia a
    // ninguna sombra en vez de a una mancha gris.
    elevation: 0,
  };
}

/** Lo que se mueve un elemento al presionarlo, que es justo lo que mide su sombra. */
export function pressed(offset: number = shape.shadowOffset, relief: Relief = 'button') {
  return {
    transform: [{ translateX: shift(offset, relief) }, { translateY: shift(offset, relief) }],
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
