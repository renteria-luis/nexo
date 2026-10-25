// Un solo lugar donde vive el color, la tipografia y la forma de toda la app.
//
// La direccion es vidrio oscuro (2026-10-18, la version D que eligio): un fondo calido
// con manchas de color, tarjetas translucidas con un filo de luz, letra clara y un solo
// acento ambar. El vidrio de verdad de iOS 26 va solo en lo que flota encima del
// contenido (src/ui/Glass.tsx); las tarjetas son translucidas sin desenfoque, porque
// sobre un fondo suave se ven igual y no le cuestan nada al telefono.
//
// Antes fue neobrutalismo (borde negro, sombra dura, pastel plano) y antes de eso hubo
// un modo oscuro que se quito el 2026-09-26. Sigue habiendo una sola paleta.
//
// The fixed contribution scale lives in core/palettes.ts, independently of this theme.

import { StyleSheet, type ViewStyle } from 'react-native';

export type Palette = {
  /** Debajo del fondo: lo que se ve mientras el fondo carga o donde no llega. */
  bg: string;
  /** La tarjeta: translucida, deja ver el fondo. */
  surface: string;
  surfaceHigh: string;
  surfaceWarm: string;
  /**
   * Lo que flota encima de otro contenido (hojas, globos, menus). Tiene que ser opaco:
   * una hoja translucida encima de una lista deja leer las dos a la vez.
   */
  surfaceSolid: string;
  /** El relleno del vidrio donde iOS no lo dibuja: el navegador y los iOS viejos. */
  glass: string;
  /** El filo de luz de las tarjetas y los campos. */
  line: string;
  lineSoft: string;

  text: string;
  textDim: string;
  textFaint: string;
  textGhost: string;

  accent: string;
  /** La tinta oscura que va encima de cualquier color lleno (acento, ok, aviso...). */
  accentInk: string;
  accentInkSoft: string;

  ok: string;
  okBg: string;
  warn: string;
  warnBg: string;
  danger: string;
  info: string;
  /**
   * La proteina en Comida y en el dia. Su propio color y no el de peligro, que la pintaba
   * de error aun con el piso cumplido (2026-10-23).
   */
  protein: string;
};

export const DARK: Palette = {
  bg: '#17110d',
  surface: 'rgba(255, 255, 255, 0.07)',
  surfaceHigh: 'rgba(255, 255, 255, 0.12)',
  surfaceWarm: 'rgba(255, 255, 255, 0.16)',
  surfaceSolid: '#271e18',
  glass: 'rgba(0, 0, 0, 0.22)',
  line: 'rgba(255, 255, 255, 0.14)',
  lineSoft: 'rgba(255, 255, 255, 0.09)',

  text: '#fbf7f3',
  textDim: 'rgba(255, 245, 235, 0.84)',
  textFaint: 'rgba(255, 245, 235, 0.66)',
  textGhost: 'rgba(255, 245, 235, 0.42)',

  accent: '#ffb36b',
  accentInk: '#1d1510',
  accentInkSoft: 'rgba(29, 21, 16, 0.68)',

  // Llenos claros con tinta oscura encima, como el acento: sobre el fondo oscuro se
  // distinguen por claridad ademas de por tono, que es lo que lee con su daltonismo.
  ok: '#8fdca6',
  okBg: 'rgba(143, 220, 166, 0.16)',
  warn: '#ffe08a',
  warnBg: 'rgba(255, 224, 138, 0.16)',
  danger: '#ff9f9a',
  info: '#a9c4ff',
  protein: '#76dbda',
};

/** Filo fino, esquinas redondas y continuas como las de iOS. */
export const shape = {
  border: 1,
  radius: 22,
  radiusSmall: 14,
  /** La barra flotante de abajo y la bola: capsulas enteras. */
  radiusLarge: 31,
  /** El relleno de una tarjeta. */
  cardPadding: 16,
} as const;

/**
 * Lo que se toca dentro de una tarjeta llega hasta su borde: el relleno de la tarjeta era
 * una orilla muerta alrededor de cada fila y de cada encabezado plegable, y el toque solo
 * entraba si caia en el texto (2026-10-25). `rowBleed` para las filas de una lista, a lo
 * ancho; `headBleed` para lo que ocupa la tarjeta entera, tambien por arriba y por abajo.
 */
export const rowBleed = {
  marginHorizontal: -shape.cardPadding,
  paddingHorizontal: shape.cardPadding,
} as const;
export const headBleed = { margin: -shape.cardPadding, padding: shape.cardPadding } as const;

/**
 * Lo que hace que algo se lea como vidrio y no como un recorte mate (2026-10-18, a
 * peticion suya, con su kit de referencia): una luz que entra por arriba a la izquierda
 * y se apaga hacia abajo, un filo claro arriba y oscuro abajo, y una sombra suave debajo
 * que le da cuerpo. Sin desenfoque: el fondo ya es suave, y desenfocarlo detras de cada
 * tarjeta costaria mucho sin cambiar lo que se ve.
 *
 * `panel` es para las tarjetas; `control` para lo que se toca (botones, opciones,
 * campos), un poco mas claro y con menos sombra porque va encima de una tarjeta.
 */
export const glass = {
  panel: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    experimental_backgroundImage:
      'linear-gradient(150deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.05) 50%, rgba(255, 255, 255, 0.02) 100%)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    boxShadow:
      '0 10px 28px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.28), inset 0 -1px 0 rgba(0, 0, 0, 0.22)',
  },
  control: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    experimental_backgroundImage:
      'linear-gradient(170deg, rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0.07) 55%, rgba(255, 255, 255, 0.04) 100%)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    boxShadow:
      '0 4px 12px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.35), inset 0 -1px 0 rgba(0, 0, 0, 0.25)',
  },
  /** Para quitarle el vidrio a algo apagado: sin luz y sin sombra. */
  none: {
    experimental_backgroundImage: [],
    boxShadow: [],
  },
} satisfies Record<string, ViewStyle>;

/**
 * Un color lleno que brilla como una gota de vidrio de color: luz fuerte arriba que se
 * apaga a la mitad, un filo blanco por dentro y una sombra debajo. La tinta oscura de
 * encima se sigue leyendo porque el brillo no pasa de la mitad.
 */
export function gloss(color: string): ViewStyle {
  return {
    backgroundColor: color,
    experimental_backgroundImage:
      'linear-gradient(180deg, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.08) 50%, rgba(0, 0, 0, 0.06) 100%)',
    borderColor: 'rgba(255, 255, 255, 0.55)',
    boxShadow:
      '0 6px 16px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.85), inset 0 -2px 4px rgba(0, 0, 0, 0.12)',
  };
}

/** Lo que hace un elemento al presionarlo: se apaga un poco y se encoge apenas. */
export function pressed() {
  return { opacity: 0.72, transform: [{ scale: 0.98 }] };
}

export const font = {
  regular: 'PlusJakartaSans_400Regular',
  bold: 'PlusJakartaSans_700Bold',
  black: 'PlusJakartaSans_800ExtraBold',
  /** El titulo de una pantalla y el numero grande de la nota. */
  display: 'PlusJakartaSans_800ExtraBold',
} as const;

/** Nombre viejo de la fuente de datos. Ahora todo es Plus Jakarta Sans. */
export const mono = font.bold;

export const theme: Palette = DARK;

/**
 * Una hoja de estilos que recibe la paleta.
 *
 * Se usa igual que StyleSheet.create. Existia para poder rehacer las hojas al cambiar
 * de modo; con una sola paleta se queda porque es como estan escritas las cuarenta
 * hojas de la app.
 */
export function sheet<T extends StyleSheet.NamedStyles<T>>(
  // La misma forma que StyleSheet.create, para que un estilo mal escrito siga
  // fallando aqui y no en el telefono.
  make: (palette: Palette) => T,
): T {
  return StyleSheet.create(make(theme));
}
