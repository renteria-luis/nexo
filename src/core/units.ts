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
 * Snaps a weight to the nearest real step of the equipment. A stack that moves ten
 * pounds at a time cannot be set to eleven, and spec 5.1 is explicit that the arrows
 * step by that value and never by one.
 */
export function snapToIncrement(kg: number, incrementKg: number): number {
  if (!(incrementKg > 0)) throw new Error(`an increment of ${incrementKg} is not a step`);
  return Math.max(0, Math.round(kg / incrementKg) * incrementKg);
}
