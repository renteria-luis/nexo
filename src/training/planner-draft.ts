// Lo que eligio antes de empezar: donde, que rutina, con quien, cuanto tiempo y el orden
// que dejo. Vivia solo en memoria, asi que cerrar la app entre elegirlo y empezar volvia a
// poner la rutina que toca y le quitaba el gimnasio.
//
// Es de un dia. Al siguiente vuelve la rutina del patron y lo demas a lo de siempre; solo
// el gimnasio sigue puesto, porque casi siempre va al mismo. Distinto del borrador de la
// sesion (`core/session-draft.ts`), que es lo que queda a medio teclear ya entrenando.

import type { IsoDate } from '../core/dates.ts';
import type { Company } from '../db/types.ts';
import type { PlannedExercise, TimeBudget } from './routines.ts';

export type PlannerEdit = Pick<PlannedExercise, 'exerciseId' | 'sets' | 'position'>;

export type PlannerDraft = {
  date: IsoDate;
  /** Null cuando no eligio una a mano: entonces va la que toca por el patron. */
  routineId: string | null;
  gymId: string | null;
  company: Company;
  budget: TimeBudget;
  /** El orden y las series que cambio, y el plan al que pertenecen. */
  edits: { plan: string; exercises: PlannerEdit[] } | null;
};

const COMPANIES = new Set<string>(['alone', 'with_someone']);
const BUDGETS = new Set<string>(['completo', 'minus_25', 'minus_50', 'express']);

export function freshPlannerDraft(date: IsoDate, gymId: string | null = null): PlannerDraft {
  return { date, routineId: null, gymId, company: 'alone', budget: 'completo', edits: null };
}

/** Siempre en el mismo orden, para que dos borradores iguales den el mismo texto. */
export function serializePlannerDraft(draft: PlannerDraft): string {
  return JSON.stringify({
    date: draft.date,
    routineId: draft.routineId,
    gymId: draft.gymId,
    company: draft.company,
    budget: draft.budget,
    edits: draft.edits && {
      plan: draft.edits.plan,
      exercises: draft.edits.exercises.map(({ exerciseId, sets, position }) => ({
        exerciseId,
        sets,
        position,
      })),
    },
  });
}

/** El de hoy; de otro dia solo queda el gimnasio. */
export function parsePlannerDraft(stored: string | undefined, today: IsoDate): PlannerDraft {
  if (!stored) return freshPlannerDraft(today);

  let body: unknown;
  try {
    body = JSON.parse(stored);
  } catch {
    // Lo escribe la app y es una preferencia: roto, se empieza de cero sin tumbar el arranque.
    return freshPlannerDraft(today);
  }
  if (typeof body !== 'object' || body === null) return freshPlannerDraft(today);
  const draft = body as Record<string, unknown>;

  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  const gymId = text(draft.gymId);
  if (draft.date !== today) return freshPlannerDraft(today, gymId);

  return {
    date: today,
    routineId: text(draft.routineId),
    gymId,
    company: COMPANIES.has(draft.company as string) ? (draft.company as Company) : 'alone',
    budget: BUDGETS.has(draft.budget as string) ? (draft.budget as TimeBudget) : 'completo',
    edits: editsOf(draft.edits),
  };
}

function editsOf(value: unknown): PlannerDraft['edits'] {
  if (typeof value !== 'object' || value === null) return null;
  const { plan, exercises } = value as Record<string, unknown>;
  if (typeof plan !== 'string' || !Array.isArray(exercises)) return null;
  const valid = exercises.every(
    (item: unknown) =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as PlannerEdit).exerciseId === 'string' &&
      Number.isInteger((item as PlannerEdit).sets) &&
      (item as PlannerEdit).sets >= 0 &&
      Number.isInteger((item as PlannerEdit).position),
  );
  return valid ? { plan, exercises: exercises as PlannerEdit[] } : null;
}

/**
 * El plan recien cargado con el orden y las series que habia dejado.
 *
 * Null si ya no son los mismos ejercicios (cambio el catalogo o la rutina en medio): el
 * plan nuevo va como sale, y no se revive un ejercicio que ya no esta.
 */
export function withPlannerEdits(
  loaded: readonly PlannedExercise[],
  edits: readonly PlannerEdit[],
): PlannedExercise[] | null {
  if (edits.length !== loaded.length) return null;
  const byId = new Map(loaded.map((exercise) => [exercise.exerciseId, exercise]));
  const restored: PlannedExercise[] = [];
  for (const edit of edits) {
    const exercise = byId.get(edit.exerciseId);
    if (!exercise) return null;
    byId.delete(edit.exerciseId);
    restored.push({ ...exercise, sets: edit.sets, position: edit.position });
  }
  return restored;
}
