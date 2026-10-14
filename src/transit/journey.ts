import type { WorkoutFinish } from '../training/read.ts';
import { agencyClock } from './schedule.ts';
import { BOARD_MARGIN_MIN, ARRIVE_EARLY_MIN, type PlanMode, type PlanOption } from './planner.ts';

export type TravelPreferences = {
  preparationMinutes: number;
  prepare: boolean;
  leave: boolean;
  sound: boolean;
  quiet: boolean;
};
export const DEFAULT_TRAVEL_PREFERENCES: TravelPreferences = {
  preparationMinutes: 5,
  prepare: true,
  leave: true,
  sound: true,
  quiet: false,
};
export type NextTrip = {
  id: string;
  originId: string;
  destinationId: string;
  mode: PlanMode;
  at: number;
  workoutId: string | null;
  selectedKey: string | null;
  selectedAt: number | null;
  reminders: boolean;
};
export type JourneyState = { preferences: TravelPreferences; next: NextTrip | null };

export function travelPreferencesProblem(value: TravelPreferences): string | null {
  if (
    !Number.isInteger(value.preparationMinutes) ||
    value.preparationMinutes < 1 ||
    value.preparationMinutes > 60
  )
    return 'La preparación debe durar de 1 a 60 minutos.';
  if (
    ['prepare', 'leave', 'sound', 'quiet'].some(
      (key) => typeof value[key as keyof TravelPreferences] !== 'boolean',
    )
  )
    return 'Revisa los interruptores de los avisos de viaje.';
  return null;
}

export function parseJourneyState(content: string): JourneyState {
  const value = JSON.parse(content) as JourneyState;
  if (!value?.preferences || travelPreferencesProblem(value.preferences))
    throw new Error('No se pudieron leer los ajustes de Transit.');
  const trip = value.next;
  if (
    trip !== null &&
    (!trip ||
      typeof trip.id !== 'string' ||
      !trip.id ||
      typeof trip.originId !== 'string' ||
      typeof trip.destinationId !== 'string' ||
      !trip.originId ||
      !trip.destinationId ||
      trip.originId === trip.destinationId ||
      !['now', 'depart', 'arrive'].includes(trip.mode) ||
      !Number.isFinite(trip.at) ||
      !(trip.workoutId === null || typeof trip.workoutId === 'string') ||
      !(trip.selectedKey === null || typeof trip.selectedKey === 'string') ||
      !(trip.selectedAt === null || Number.isFinite(trip.selectedAt)) ||
      typeof trip.reminders !== 'boolean')
  )
    throw new Error('No se pudo leer el próximo viaje guardado.');
  return value;
}

export type TravelAdvice = {
  option: PlanOption;
  finishBy: number;
  leaveAt: number;
  boardAt: number | null;
  reachStopBy: number | null;
  preparationMinutes: number;
  walkMinutes: number;
  boardingMinutes: number;
  feasible: boolean;
  reason: string | null;
  source: string;
};

export function departureReadyAt(
  preparationMinutes: number,
  workout: WorkoutFinish | null,
  now: number,
  selectedAt: number | null = null,
): number {
  const completedAt =
    workout?.evidence === 'complete' ? (workout.endedAt ?? workout.finishAt) : null;
  return completedAt !== null
    ? Math.max(now, completedAt + preparationMinutes * 60_000)
    : !workout && selectedAt !== null
      ? Math.max(now, selectedAt + preparationMinutes * 60_000)
      : Math.max(now, workout?.finishAt ?? now) + preparationMinutes * 60_000;
}

export function travelAdvice(
  option: PlanOption,
  preparationMinutes: number,
  workout: WorkoutFinish | null,
  now: number,
  arrivalDeadline?: number,
  selectedAt: number | null = null,
): TravelAdvice {
  const board = option.live[0]?.board;
  const finishBy = option.leaveAt - preparationMinutes * 60_000;
  const preparationStarted =
    selectedAt === null ? null : Math.max(selectedAt, Math.min(now, finishBy));
  const ready = departureReadyAt(preparationMinutes, workout, now, preparationStarted);
  const reason =
    option.problem === 'canceled'
      ? 'LTC canceló este viaje.'
      : option.problem === 'skipped'
        ? 'Este bus no para donde lo necesitas.'
        : option.problem
          ? 'Ya no alcanza el transbordo.'
          : arrivalDeadline !== undefined &&
              option.arriveAt > arrivalDeadline - ARRIVE_EARLY_MIN * 60_000
            ? 'Ya no llegas con el margen de 3 min antes de tu hora límite.'
            : workout && workout.finishAt === null
              ? 'Entreno todavía no puede estimar cuándo terminas.'
              : option.leaveAt < now
                ? 'La hora de salir ya pasó.'
                : ready > option.leaveAt
                  ? 'Con la preparación y lo que falta, este bus ya no se alcanza con margen.'
                  : null;
  const source = !board
    ? 'Caminata estimada'
    : option.live.some(
          (ride) => ride.board.status === 'estimated' || ride.alight.status === 'estimated',
        )
      ? 'Estimación con el retraso LTC'
      : board.status === 'live'
        ? 'Predicción LTC en vivo'
        : option.reportedOutsideCalendar
          ? 'Bus reportado por LTC · hora de horario'
          : board.status === 'stale'
            ? 'Última predicción · sin datos frescos'
            : board.status === 'unassigned'
              ? 'Horario · sin bus asignado'
              : 'Horario programado';
  return {
    option,
    finishBy,
    leaveAt: option.leaveAt,
    boardAt: board?.at ?? null,
    reachStopBy: board ? board.at - BOARD_MARGIN_MIN * 60_000 : null,
    preparationMinutes,
    walkMinutes: option.itinerary.access.minutes,
    boardingMinutes: board ? BOARD_MARGIN_MIN : 0,
    feasible: reason === null,
    reason,
    source,
  };
}

export type TravelReminder = {
  id: string;
  journeyId: string;
  kind: 'prepare' | 'leave';
  firesAt: number;
  expiresAt: number;
  title: string;
  body: string;
  sound: boolean;
};

export function travelReminders(
  trip: NextTrip | null,
  advice: TravelAdvice | null,
  preferences: TravelPreferences,
  destination: string,
  now: number,
): TravelReminder[] {
  if (!trip?.reminders || !trip.selectedKey || !advice?.feasible) return [];
  const route = advice.option.itinerary.rides.map((ride) => ride.route[1]).join(' → ');
  const times = `Sal ${agencyClock(advice.leaveAt)}${advice.boardAt === null ? '' : ` · bus ${route} ${agencyClock(advice.boardAt)}`}.`;
  return (['prepare', 'leave'] as const).flatMap((kind) => {
    const firesAt =
      Math.floor((kind === 'prepare' ? advice.finishBy : advice.leaveAt) / 1000) * 1000;
    const local = new Date(firesAt);
    const minute = local.getHours() * 60 + local.getMinutes();
    if (
      !preferences[kind] ||
      firesAt <= now ||
      (preferences.quiet && (minute >= 1290 || minute < 450))
    )
      return [];
    return [
      {
        id: `transit:${trip.id}:${kind}`,
        journeyId: trip.id,
        kind,
        firesAt,
        expiresAt: advice.leaveAt,
        title:
          kind === 'prepare'
            ? trip.workoutId
              ? 'Termina y prepárate para salir'
              : 'Prepárate para salir'
            : 'Es hora de salir',
        body: `${destination}. ${times} ${advice.source}. Último cálculo; abre para comprobar cambios.`,
        sound: preferences.sound,
      },
    ];
  });
}
