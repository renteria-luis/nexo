// What the missed training penalty in spec 4.3 needs to know: which days had a
// session. The rule is deliberately rolling rather than pinned to weekdays, so a
// day pushed by a busy afternoon fixes itself instead of counting as a miss.

import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays, daysBetween, weekStart, type DateRange, type IsoDate } from '../core/dates.ts';
import { trainingDebt, WEEKLY_SESSION_TARGET } from '../core/discipline.ts';

/**
 * Los dias en que entreno: con una sesion que tiene al menos una serie de trabajo (spec
 * 5.5, los calentamientos no cuentan). Una sesion abierta y dejada vacia, porque el gym
 * estaba lleno o cambio el plan, contaba como entreno: le daba a un descanso cercano sus
 * 22 puntos y borraba las faltas de los dias siguientes.
 */
export async function listSessionDates(db: SQLiteDatabase, range: DateRange): Promise<IsoDate[]> {
  const rows = await db.getAllAsync<{ date: IsoDate }>(
    `SELECT DISTINCT s.date FROM training_session s
      WHERE s.date BETWEEN ? AND ?
        AND EXISTS (
          SELECT 1 FROM training_set_entry e
           WHERE e.session_id = s.id AND e.is_warmup = 0
        )
   ORDER BY s.date;`,
    [range.from, range.to],
  );
  return rows.map((row) => row.date);
}

/** Sessions in the seven days ending on and including the date. */
export function sessionsInTrailingWeek(sessionDates: readonly IsoDate[], onDate: IsoDate): number {
  return sessionDates.filter((date) => {
    const back = daysBetween(date, onDate);
    return back >= 0 && back < 7;
  }).length;
}

/**
 * Spec 4.3. La mejor de las siete ventanas de siete dias que contienen ese dia.
 *
 * La ventana que solo mira hacia atras no puede saber el jueves que va a entrenar
 * viernes, sabado y domingo, asi que juzgaba un descanso de mitad de semana contra
 * una semana que todavia no habia pasado. Mirando cualquier ventana que lo contenga,
 * el dia se resuelve cuando la semana termina de existir, y sigue sin depender de que
 * dia cae: es lo mismo que pide el resto de spec 4.3.
 */
export function sessionsInBestWeekAround(
  sessionDates: readonly IsoDate[],
  onDate: IsoDate,
): number {
  let best = 0;
  for (let ends = 0; ends <= 6; ends += 1) {
    const count = sessionsInTrailingWeek(sessionDates, addDays(onDate, ends));
    if (count > best) best = count;
  }
  return best;
}

/**
 * Spec 4.3. Walks back from the day before, counting scheduled days that went by
 * without a session. A day with no debt was optional, so it neither counts nor
 * clears; only a completed session resets the run.
 */
export function consecutiveMissedBefore(
  sessionDates: readonly IsoDate[],
  date: IsoDate,
  lookBackDays = 60,
): number {
  const trained = new Set(sessionDates);
  let missed = 0;

  for (let back = 1; back <= lookBackDays; back += 1) {
    const day = addDays(date, -back);
    if (trained.has(day)) return missed;

    const debt = trainingDebt(sessionsInTrailingWeek(sessionDates, day));
    if (debt > 0) missed += 1;
  }

  return missed;
}

export function trainedOn(sessionDates: readonly IsoDate[], date: IsoDate): boolean {
  return sessionDates.includes(date);
}

/**
 * Spec 4.4: cuantas semanas seguidas, de lunes a domingo, llego a las cinco sesiones.
 *
 * La semana en curso suma en cuanto llega a cinco y no corta antes, igual que hoy en la
 * racha de dias: el lunes ninguna semana tiene cinco, y contarla rota dejaria la racha en
 * cero al empezar cada semana. Un descanso marcado no es una sesion y no suma.
 */
export function trainingWeekStreak(sessionDates: readonly IsoDate[], today: IsoDate): number {
  const perWeek = new Map<IsoDate, number>();
  for (const date of sessionDates) {
    if (date > today) continue;
    const week = weekStart(date);
    perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
  }
  const full = (week: IsoDate) => (perWeek.get(week) ?? 0) >= WEEKLY_SESSION_TARGET;
  const current = weekStart(today);
  let streak = full(current) ? 1 : 0;
  for (let week = addDays(current, -7); full(week); week = addDays(week, -7)) streak += 1;
  return streak;
}
