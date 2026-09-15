// Spec 4.5. The owner has pronounced red-green deuteranopia, so the default scale
// cannot lean on hue. Three palettes ship and he picks one on first run from a live
// preview.
//
// Every palette also gets a fill level proportional to the score, so colour is
// never the only thing carrying the meaning. A no-data day is neutral grey, which
// has to read as different from both ends rather than as a bad day.

export type PaletteId = 'deutan' | 'standard' | 'tritan';

export type Rgb = {
  r: number;
  g: number;
  b: number;
};

type Stop = {
  /** Score this colour belongs to, 0 to 100. */
  at: number;
  rgb: Rgb;
};

/**
 * Palette A, the default. Anchors sampled from the cividis colormap, reversed so a
 * high score is the dark blue end and a low score the yellow end, as spec 4.5 sets
 * out. Cividis is built so deutan observers see approximately what everyone else
 * does, and its luminance rises monotonically, so the scale still reads with hue
 * removed entirely.
 */
const DEUTAN: Stop[] = [
  { at: 0, rgb: { r: 255, g: 234, b: 70 } },
  { at: 20, rgb: { r: 202, g: 178, b: 101 } },
  { at: 40, rgb: { r: 152, g: 138, b: 136 } },
  { at: 60, rgb: { r: 105, g: 104, b: 132 } },
  { at: 80, rgb: { r: 57, g: 70, b: 114 } },
  { at: 100, rgb: { r: 0, g: 32, b: 76 } },
];

/** Palette B, the conventional one, for when he wants what everyone else sees. */
const STANDARD: Stop[] = [
  { at: 0, rgb: { r: 192, g: 57, b: 43 } },
  { at: 50, rgb: { r: 241, g: 196, b: 15 } },
  { at: 100, rgb: { r: 39, g: 174, b: 96 } },
];

/**
 * Palette C, for completeness. A single hue with monotonic luminance, which stays
 * readable under blue-yellow confusion and in fact under any of them.
 */
const TRITAN: Stop[] = [
  { at: 0, rgb: { r: 255, g: 245, b: 240 } },
  { at: 50, rgb: { r: 251, g: 106, b: 74 } },
  { at: 100, rgb: { r: 103, g: 0, b: 13 } },
];

const PALETTES: Record<PaletteId, Stop[]> = {
  deutan: DEUTAN,
  standard: STANDARD,
  tritan: TRITAN,
};

export const PALETTE_NAMES: Record<PaletteId, string> = {
  deutan: 'Deutan',
  standard: 'Estandar',
  tritan: 'Tritan',
};

/** Spec 4.5: distinct from both ends of every palette, and never read as a bad day. */
export const NO_DATA_COLOR = '#d4d4d4';

function toHex({ r, g, b }: Rgb): string {
  const pair = (value: number) => Math.round(value).toString(16).padStart(2, '0');
  return `#${pair(r)}${pair(g)}${pair(b)}`;
}

function interpolate(from: Rgb, to: Rgb, ratio: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * ratio,
    g: from.g + (to.g - from.g) * ratio,
    b: from.b + (to.b - from.b) * ratio,
  };
}

export function colorForScore(score: number | null, palette: PaletteId): string {
  if (score === null) return NO_DATA_COLOR;
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error(`a day score of ${score} is outside 0 to 100`);
  }

  const stops = PALETTES[palette];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const lower = stops[i];
    const upper = stops[i + 1];
    if (score <= upper.at) {
      const span = upper.at - lower.at;
      const ratio = span === 0 ? 0 : (score - lower.at) / span;
      return toHex(interpolate(lower.rgb, upper.rgb, ratio));
    }
  }
  return toHex(stops[stops.length - 1].rgb);
}

/**
 * Spec 4.5: how much of the cell is filled, proportional to the score. This is the
 * second carrier of the meaning, so the grid still works if the colours fail.
 */
export function fillForScore(score: number | null): number {
  if (score === null) return 0;
  return Math.min(1, Math.max(0, score / 100));
}

/** The sample row spec 4.5 shows on first run, so he can compare palettes on real steps. */
export const PREVIEW_SCORES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
