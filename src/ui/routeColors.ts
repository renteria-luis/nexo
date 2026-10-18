// LTC's own line colours are pale pastels, and he is colour-blind: the hue stays LTC's, while
// saturation goes up and lightness down so neighbouring lines differ in depth as well as hue.
// The number always rides inside the badge, so a colour is never the only way to tell lines.

const FALLBACK = '#121212';

// The stops he can board at, nearest first. Each also carries its number, and a closed one a
// cross, so the colour is never the only way to tell them apart.
export const STOP_CHOICE_COLORS = ['#17683A', '#3977A5', '#A16B16'];
export const STOP_CLOSED_COLOR = '#8A8A8A';
export const stopChoiceColor = (rank: number | null) =>
  rank === null ? STOP_CLOSED_COLOR : (STOP_CHOICE_COLORS[rank - 1] ?? FALLBACK);

function hsl(hex: string): [number, number, number] {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  if (max === min) return [0, 0, light];
  const delta = max - min;
  const saturation = delta / (1 - Math.abs(2 * light - 1));
  const hue =
    max === r
      ? ((g - b) / delta + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / delta + 2) * 60
        : ((r - g) / delta + 4) * 60;
  return [hue, saturation, light];
}

function hex([hue, saturation, light]: [number, number, number]): string {
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - chroma / 2;
  const [r, g, b] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return `#${[r, g, b]
    .map((v) =>
      Math.round((v + m) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

/** The colour a line is drawn with: LTC's hue, deepened for contrast. */
export function routeColor(color: string): string {
  if (!/^[0-9A-F]{6}$/i.test(color)) return FALLBACK;
  const [hue, saturation, light] = hsl(color);
  return hex([
    hue,
    saturation < 0.15 ? saturation : Math.max(saturation, 0.85),
    Math.min(light, 0.4),
  ]);
}

/** The line at its most vivid, for the stretch he rides: LTC's hue at full strength and bright. */
export function rideGlow(color: string): string {
  if (!/^[0-9A-F]{6}$/i.test(color)) return FALLBACK;
  const [hue, saturation] = hsl(color);
  return hex([hue, saturation < 0.15 ? saturation : 1, 0.55]);
}

/** Black or white, whichever reads better on the line's colour. */
export function routeInk(color: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(color.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.25 ? '#121212' : '#FFFFFF';
}
