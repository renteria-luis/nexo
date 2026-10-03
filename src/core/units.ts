// Weight is stored in kilograms everywhere and converted only at the edges, so a
// number written at one gym still compares against a number written at another.
// What changes is how it is shown and typed, which is a setting.
//
// His main gym is imperial: plates to 45 lb, the V-Squat starts at 54 lb, and
// Atlantis quotes its stacks in pounds. Body weight he thinks of in kilos. Those
// are different questions and the app keeps them apart.

export type WeightUnit = 'lb' | 'kg';

/** The international avoirdupois pound, exactly. */
export const KG_PER_LB = 0.45359237;

export function toKg(value: number, unit: WeightUnit): number {
  if (!Number.isFinite(value)) throw new Error(`${value} is not a weight`);
  return unit === 'kg' ? value : value * KG_PER_LB;
}

export function fromKg(kg: number, unit: WeightUnit): number {
  if (!Number.isFinite(kg)) throw new Error(`${kg} is not a weight`);
  return unit === 'kg' ? kg : kg / KG_PER_LB;
}

/**
 * Rounds away the noise a conversion leaves behind. Ten pounds stored as
 * 4.5359237 kg has to read as "10 lb" and not "10.000000000000002 lb".
 */
export function formatWeight(kg: number, unit: WeightUnit): string {
  const value = fromKg(kg, unit);
  const rounded = Math.round(value * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : String(Number(rounded.toFixed(2)));
}

export function withUnit(kg: number, unit: WeightUnit): string {
  return `${formatWeight(kg, unit)} ${unit}`;
}

/**
 * Lo que dejan las flechas del peso: un salto fijo, 5 lb o 2.5 kg, desde el numero puesto
 * (2026-10-03). Fijo por decision suya: la P156 sube de 15 en 15 y casi todas las torres
 * traen un bloquecito de 5 lb aparte, asi que el salto util es ese.
 *
 * Desde el numero puesto y sin redondear: antes el resultado se ajustaba a una cuadricula
 * de 5 lb que empieza en cero, y desde un peso que no esta en ella saltaba a uno que no
 * existe: de 17.5 a 25 en las mancuernas, de 42.5 a 50 en la polea Matrix, que empieza
 * en 2.5 y sube de 5 en 5, y de 54 a 60 en la V-Squat, que empieza en 54.
 */
export function stepWeight(typed: number, direction: 1 | -1, unit: WeightUnit): string {
  const step = unit === 'lb' ? 5 : 2.5;
  const from = Number.isFinite(typed) && typed > 0 ? typed : 0;
  return formatWeight(toKg(Math.max(0, from + direction * step), unit), unit);
}
