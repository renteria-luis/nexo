// Cuanto suele tardar en el gym, y a que hora va a salir hoy.
//
// Solo cuentan las sesiones cuya duracion marco como buena (migracion 050): un dia que
// cerro en casa dos horas despues no dice nada de lo que tarda, y mezclado con los demas
// se lleva el promedio por delante.
//
// Y cuentan solo las del mismo tipo de dia: el mismo gimnasio, la misma rutina y el mismo
// recorte de tiempo. Pull en Fanshawe al completo no dura lo que push en Fit4Less al 50%,
// y un numero que los promedia no vale para ninguno de los dos.

export type PastSession = {
  gymId: string | null;
  routineId: string | null;
  budget: string;
  minutes: number;
  trusted: boolean;
};

export type SessionKind = {
  gymId: string | null;
  routineId: string | null;
  budget: string;
};

function sameKind(session: PastSession, kind: SessionKind): boolean {
  return (
    session.gymId === kind.gymId &&
    session.routineId === kind.routineId &&
    session.budget === kind.budget
  );
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Lo que suele tardar un dia de este tipo, o null si no hay ninguno con el que decirlo.
 *
 * La mediana y no la media: con cuatro sesiones, el dia que se quedo charlando una hora
 * mueve la media veinte minutos y la mediana nada. Es la misma regla con la que la app
 * aprende sus horas de comer (spec 18.2 regla 5).
 */
export function usualMinutes(sessions: readonly PastSession[], kind: SessionKind): number | null {
  const times = sessions
    .filter((session) => session.trusted && session.minutes > 0 && sameKind(session, kind))
    .map((session) => session.minutes);

  if (times.length === 0) return null;
  const value = median(times)!;
  return times.length % 2 === 1 ? value : Math.round(value);
}

/** "01h21m", que es como lo lee de un vistazo. Por debajo de la hora, "48m". */
export function clockFace(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return hours === 0
    ? `${rest}m`
    : `${String(hours).padStart(2, '0')}h${String(rest).padStart(2, '0')}m`;
}

/** La hora del reloj, en 24 h, a la que llegaria si tarda lo de siempre. */
export function finishingAt(startedAt: number, minutes: number): string {
  const end = new Date(startedAt + minutes * 60_000);
  return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
}
