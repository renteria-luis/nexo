// Retained for reading settings and backups made before score_scale.
export type PaletteId = 'deutan' | 'standard' | 'tritan';

// Spec 4.5, for the dark background: each palette runs from dark to bright so a higher
// score always stands out more, and the zero grey sits below the first intensity. The
// steps are spaced by lightness, not hue, because the owner reads them with deuteranopia.
// The id `black` stays because saved scales and backups name it.
export const SCORE_PALETTES = {
  green: { name: 'Verde', colors: ['#2A6B41', '#3A9659', '#5CC47D', '#A8F0C0'] },
  pink: { name: 'Rosa', colors: ['#8A2E5C', '#B93F7A', '#E46AA3', '#FAC2DC'] },
  red: { name: 'Roja', colors: ['#8C302B', '#BB453E', '#E46C64', '#FBBDB8'] },
  blue: { name: 'Azul', colors: ['#2A5288', '#3A74B5', '#5F9EE3', '#B5D5F8'] },
  black: { name: 'Gris', colors: ['#58585C', '#808085', '#ACACB0', '#EEEEF0'] },
} as const;

export type ScorePalette = keyof typeof SCORE_PALETTES;
export type ScoreScaleOptions = {
  palette: ScorePalette;
  lowMax: number;
  mediumMax: number;
  topMin: number;
};
export const DEFAULT_SCORE_SCALE: ScoreScaleOptions = {
  palette: 'green',
  lowMax: 25,
  mediumMax: 50,
  topMin: 100,
};
export const NO_DATA_COLOR = 'transparent';
export const ZERO_SCORE_COLOR = '#38383C';

export function scoreScaleProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'La escala no es válida.';
  const scale = value as ScoreScaleOptions;
  if (!Object.hasOwn(SCORE_PALETTES, scale.palette)) return 'Elige una paleta disponible.';
  const { lowMax, mediumMax, topMin } = scale;
  if (![lowMax, mediumMax, topMin].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return 'Escribe los tres límites.';
  }
  if (!(0 < lowMax && lowMax < mediumMax && mediumMax < topMin && topMin <= 100)) {
    return 'Los límites deben subir en orden: mayor que 0 y hasta 100, sin repetirse.';
  }
  return null;
}

export function scoreScaleFrom(raw?: string): ScoreScaleOptions {
  if (raw === undefined) return DEFAULT_SCORE_SCALE;
  const value: unknown = JSON.parse(raw);
  const problem = scoreScaleProblem(value);
  if (problem) throw new Error(problem);
  return value as ScoreScaleOptions;
}

export function scoreLevels(scale: ScoreScaleOptions = DEFAULT_SCORE_SCALE) {
  const colors = SCORE_PALETTES[scale.palette].colors;
  return [
    { color: ZERO_SCORE_COLOR, label: 'Sin cumplir', range: '0%' },
    { color: colors[0], label: 'Bajo', range: `Más de 0 hasta ${scale.lowMax}%` },
    { color: colors[1], label: 'Medio', range: `Más de ${scale.lowMax} hasta ${scale.mediumMax}%` },
    {
      color: colors[2],
      label: 'Alto',
      range: `Más de ${scale.mediumMax} y menos de ${scale.topMin}%`,
    },
    {
      color: colors[3],
      label: scale.topMin === 100 ? 'Completo' : 'Muy alto',
      range: scale.topMin === 100 ? '100%' : `Desde ${scale.topMin} hasta 100%`,
    },
  ];
}

export function levelForScore(score: number, scale = DEFAULT_SCORE_SCALE) {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error(`a day score of ${score} is outside 0 to 100`);
  }
  const levels = scoreLevels(scale);
  if (score === 0) return levels[0];
  if (score <= scale.lowMax) return levels[1];
  if (score <= scale.mediumMax) return levels[2];
  if (score < scale.topMin) return levels[3];
  return levels[4];
}

export function colorForScore(score: number | null, scale = DEFAULT_SCORE_SCALE): string {
  return score === null ? NO_DATA_COLOR : levelForScore(score, scale).color;
}
