// Retained for reading settings and backups made before score_scale.
export type PaletteId = 'deutan' | 'standard' | 'tritan';

export const SCORE_PALETTES = {
  green: { name: 'Verde', colors: ['#A7D9B0', '#70BB84', '#36985B', '#17683A'] },
  pink: { name: 'Rosa', colors: ['#F4BDD5', '#E989B2', '#D34E90', '#9D2360'] },
  red: { name: 'Roja', colors: ['#F3B7B4', '#E9837D', '#C74942', '#8F2722'] },
  blue: { name: 'Azul', colors: ['#B8D4F3', '#7AADE0', '#387DBB', '#185087'] },
  black: { name: 'Negra', colors: ['#BDBDBD', '#929292', '#555555', '#171717'] },
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
export const ZERO_SCORE_COLOR = '#D1D5DB';

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
