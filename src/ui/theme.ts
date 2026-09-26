// Un solo lugar donde vive el color, la tipografia y la forma de toda la app.
//
// La direccion es neobrutalismo: fondo crema, borde negro grueso en todo lo que se
// toca, sombra dura sin difuminar desplazada abajo y a la derecha, y colores planos
// muy saturados. Al presionar, el elemento se mete dentro de su propia sombra. Esa
// ultima regla es la que hace que un boton se sienta pulsado sin animar nada.
//
// El modo oscuro es el mismo lenguaje con la tinta al reves: el borde pasa a ser
// claro y la sombra sigue siendo negra, asi que el relieve se mantiene.
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

  ok: LIME,
  okBg: '#eaf8cf',
  warn: ORANGE,
  warnBg: '#ffe9d2',
  danger: CORAL,
  info: BLUE,
  infoBg: '#e3ebff',
  infoLine: '#121212',
};

export const DARK: Palette = {
  bg: '#1c1c1a',
  surface: '#272725',
  surfaceHigh: '#3a3733',
  line: '#f5f1e8',
  lineSoft: '#4a4641',
  lineStrong: '#f5f1e8',
  shadow: '#000000',

  text: '#f5f1e8',
  textDim: '#ded9cd',
  textFaint: '#b4ae9f',
  textGhost: '#918b7d',

  accent: YELLOW,
  accentInk: '#121212',

  ok: LIME,
  okBg: '#2b3a17',
  warn: ORANGE,
  warnBg: '#3d2a15',
  danger: CORAL,
  info: BLUE,
  infoBg: '#1e2740',
  infoLine: '#f5f1e8',
};

/** Las medidas que hacen el estilo: borde grueso, esquina poca y sombra desplazada. */
export const shape = {
  border: 2,
  radius: 10,
  radiusSmall: 7,
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
} as const;

/** Nombre viejo de la fuente de datos. Ahora todo es Nunito, con cifras tabulares. */
export const mono = font.bold;

/**
 * La paleta viva. Se lee directamente donde hace falta un color suelto dentro del
 * JSX, y las hojas de estilo se rehacen solas cuando cambia.
 */
export let theme: Palette = LIGHT;

type Named = Record<string, unknown>;

const registered: { target: Named; make: (palette: Palette) => Named }[] = [];

/**
 * Una hoja de estilos que sabe rehacerse al cambiar de modo.
 *
 * Se usa igual que StyleSheet.create, pero recibiendo la paleta. Guarda el mismo
 * objeto y lo vuelve a llenar cuando el modo cambia, asi que ninguna pantalla tiene
 * que enterarse ni pasar nada por props.
 */
export function sheet<T extends StyleSheet.NamedStyles<T>>(
  // La misma forma que StyleSheet.create, para que un estilo mal escrito siga
  // fallando aqui y no en el telefono.
  make: (palette: Palette) => T,
): T {
  const target = { ...StyleSheet.create(make(theme)) } as T;
  registered.push({
    target: target as unknown as Named,
    make: make as unknown as (palette: Palette) => Named,
  });
  return target;
}

export function applyPalette(next: Palette): void {
  if (next === theme) return;
  theme = next;
  for (const entry of registered) {
    const fresh = entry.make(theme) as Named;
    for (const key of Object.keys(entry.target)) delete entry.target[key];
    Object.assign(entry.target, StyleSheet.create(fresh as never));
  }
}
