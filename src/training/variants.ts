import type { EquipmentType } from '../db/types.ts';
import type { CatalogExercise } from './queries.ts';
import type { PlannedSet } from './routines.ts';

export const EQUIPMENT_NAMES: Record<EquipmentType, string> = {
  machine: 'Máquina',
  barbell: 'Barra',
  ez_bar: 'Barra Z',
  dumbbell: 'Mancuernas',
  cable: 'Polea',
  bodyweight: 'Peso corporal',
};

export function familyOf(exercise: Pick<CatalogExercise, 'id' | 'familyId'>): string {
  return exercise.familyId ?? exercise.id;
}

export function variantLabel(
  exercise: Pick<CatalogExercise, 'equipment_type' | 'unilateral'>,
): string {
  return `${EQUIPMENT_NAMES[exercise.equipment_type]}${exercise.unilateral ? ' · unilateral' : ''}`;
}

export function replacePendingSets(
  entries: readonly PlannedSet[],
  done: ReadonlyMap<string, number>,
  from: string | null,
  target: { id: string; default_rest_seconds: number },
): PlannedSet[] {
  if (from === target.id) return [...entries];
  const old = entries.find((entry) => entry.exerciseId === from);
  const remaining = from === null ? 3 : Math.max(0, (old?.sets ?? 0) - (done.get(from) ?? 0));
  if (!remaining) return [...entries];
  const next = entries.flatMap((entry) =>
    entry.exerciseId === from
      ? (done.get(entry.exerciseId) ?? 0) > 0
        ? [{ ...entry, sets: done.get(entry.exerciseId)! }]
        : []
      : [{ ...entry }],
  );
  const existing = next.find((entry) => entry.exerciseId === target.id);
  if (existing) existing.sets += remaining;
  else {
    const at =
      from === null
        ? next.length
        : Math.max(
            0,
            entries.findIndex((entry) => entry.exerciseId === from) +
              ((done.get(from) ?? 0) > 0 ? 1 : 0),
          );
    next.splice(at, 0, {
      exerciseId: target.id,
      sets: remaining,
      position: 1,
      restSeconds: target.default_rest_seconds,
    });
  }
  return next.map((entry, index) => ({ ...entry, position: index + 1 }));
}
