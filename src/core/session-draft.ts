// Lo que estaba escribiendo cuando cerro la app.
//
// Las series ya anotadas viven en la base, pero lo que queda a medio escribir en los
// campos vive en memoria y se perdia al cerrar. En medio de un entreno eso es peor
// de lo que suena: vuelve a abrir y no sabe si llego a guardar la serie o no.
//
// Se guarda como un ajuste mas, en texto, y se descarta solo si es de otra sesion:
// el entreno de ayer no tiene por que dejar numeros puestos en el de hoy.

export type SessionDraft = {
  sessionId: string;
  exerciseId: string | null;
  weight: string | null;
  reps: string | null;
  rpe: string | null;
  implement: string | null;
};

export function serializeDraft(draft: SessionDraft): string {
  return JSON.stringify(draft);
}

/** Null cuando no hay nada guardado, esta roto, o es de otra sesion. */
export function parseDraft(
  stored: string | undefined,
  sessionId: string | null,
): SessionDraft | null {
  if (!stored || sessionId === null) return null;

  let body: unknown;
  try {
    body = JSON.parse(stored);
  } catch {
    // Un ajuste corrupto no puede tumbar el arranque de la app.
    return null;
  }

  if (typeof body !== 'object' || body === null) return null;
  const draft = body as Record<string, unknown>;
  if (draft.sessionId !== sessionId) return null;

  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

  return {
    sessionId,
    exerciseId: text(draft.exerciseId),
    weight: text(draft.weight),
    reps: text(draft.reps),
    rpe: text(draft.rpe),
    implement: text(draft.implement),
  };
}
