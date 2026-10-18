// What sits behind each screen, chosen by the owner in Ajustes (2026-10-18). One setting,
// `backgrounds`, holds a JSON object keyed by screen name, with GENERAL for the one every
// screen without its own uses. A photo is kept whole and framed at draw time, so moving
// or zooming it later never needs a new copy.

export type Direction = 'down' | 'diagonal' | 'across';

export type Photo = {
  kind: 'photo';
  uri: string;
  /** The photo's own size in pixels. */
  width: number;
  height: number;
  /** 1 fills the screen edge to edge; more crops in. */
  zoom: number;
  /** The point of the photo at the centre of the screen, as fractions of its size. */
  x: number;
  y: number;
  /** How much black goes over it, 0 to MAX_DIM. */
  dim: number;
  /** Blur radius in points at full screen size, 0 to MAX_BLUR. */
  blur: number;
};

export type Background =
  | { kind: 'blobs'; colors: string[] }
  | { kind: 'color'; color: string }
  | { kind: 'gradient'; colors: string[]; direction: Direction }
  | Photo;

export type Backgrounds = Readonly<Record<string, Background>>;

export const GENERAL = '*';
export const MAX_ZOOM = 5;
export const MAX_DIM = 0.8;
export const MAX_BLUR = 40;

/** The look the app shipped with on 2026-10-18: amber, rose and blue over warm black. */
export const DEFAULT_BACKGROUND: Background = {
  kind: 'blobs',
  colors: ['#FF9646', '#D65878', '#5484C4'],
};

type Size = { width: number; height: number };

const HEX = /^#[0-9a-fA-F]{6}$/;
const DIRECTIONS = new Set<string>(['down', 'diagonal', 'across']);

function colorsProblem(colors: unknown, min: number, max: number): string | null {
  if (!Array.isArray(colors) || colors.length < min || colors.length > max) {
    return `se esperaban de ${min} a ${max} colores`;
  }
  return colors.every((color) => typeof color === 'string' && HEX.test(color))
    ? null
    : 'un color no es válido';
}

function between(value: unknown, low: number, high: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
}

export function backgroundProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'el fondo no es válido';
  const background = value as Record<string, unknown>;
  switch (background.kind) {
    case 'blobs':
      return colorsProblem(background.colors, 3, 3);
    case 'color':
      return typeof background.color === 'string' && HEX.test(background.color)
        ? null
        : 'el color no es válido';
    case 'gradient':
      return (
        colorsProblem(background.colors, 2, 3) ??
        (DIRECTIONS.has(String(background.direction)) ? null : 'la dirección no es válida')
      );
    case 'photo':
      if (typeof background.uri !== 'string' || background.uri === '') return 'falta la foto';
      if (!between(background.width, 1, 100000) || !between(background.height, 1, 100000)) {
        return 'la foto no tiene tamaño';
      }
      if (!between(background.zoom, 1, MAX_ZOOM)) return 'el acercamiento no es válido';
      if (!between(background.x, 0, 1) || !between(background.y, 0, 1)) {
        return 'el encuadre no es válido';
      }
      if (!between(background.dim, 0, MAX_DIM)) return 'el oscurecido no es válido';
      return between(background.blur, 0, MAX_BLUR) ? null : 'el desenfoque no es válido';
    default:
      return 'el tipo de fondo no es válido';
  }
}

export function backgroundsProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'los fondos no son válidos';
  }
  for (const [screen, background] of Object.entries(value)) {
    const problem = backgroundProblem(background);
    if (problem) return `${screen === GENERAL ? 'General' : screen}: ${problem}`;
  }
  return null;
}

/** Throws on a stored value that does not parse: a broken setting should be seen, not skipped. */
export function backgroundsFrom(raw: string | undefined): Backgrounds {
  if (raw === undefined) return {};
  const value: unknown = JSON.parse(raw);
  const problem = backgroundsProblem(value);
  if (problem) throw new Error(`setting backgrounds: ${problem}`);
  return value as Backgrounds;
}

export function backgroundFor(all: Backgrounds, screen: string): Background {
  return all[screen] ?? all[GENERAL] ?? DEFAULT_BACKGROUND;
}

/** How big the photo is drawn: at zoom 1, just enough to cover the view with no gaps. */
function drawnSize(photo: Photo, view: Size): Size {
  const cover = Math.max(view.width / photo.width, view.height / photo.height);
  return { width: photo.width * cover * photo.zoom, height: photo.height * cover * photo.zoom };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** Keeps the zoom in range and the centre where the photo still covers the whole view. */
export function clampPhoto(photo: Photo, view: Size): Photo {
  const zoom = clamp(photo.zoom, 1, MAX_ZOOM);
  const size = drawnSize({ ...photo, zoom }, view);
  const halfX = view.width / 2 / size.width;
  const halfY = view.height / 2 / size.height;
  return {
    ...photo,
    zoom,
    x: clamp(photo.x, halfX, 1 - halfX),
    y: clamp(photo.y, halfY, 1 - halfY),
  };
}

/** Where the photo goes inside a view of this size, in points from the view's corner. */
export function photoFrame(photo: Photo, view: Size) {
  const framed = clampPhoto(photo, view);
  const size = drawnSize(framed, view);
  return {
    left: view.width / 2 - framed.x * size.width,
    top: view.height / 2 - framed.y * size.height,
    width: size.width,
    height: size.height,
  };
}

/** Dragging the photo by (dx, dy) points moves what is under the finger with it. */
export function movePhoto(photo: Photo, view: Size, dx: number, dy: number): Photo {
  const size = drawnSize(clampPhoto(photo, view), view);
  return clampPhoto(
    { ...photo, x: photo.x - dx / size.width, y: photo.y - dy / size.height },
    view,
  );
}
