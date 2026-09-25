// What the missed training penalty in spec 4.3 needs to know: which days had a
// session. The rule is deliberately rolling rather than pinned to weekdays, so a
// day pushed by a busy afternoon fixes itself instead of counting as a miss.

import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays, daysBetween, type DateRange, type IsoDate } from '../core/dates.ts';
import { WEEKLY_SESSION_TARGET } from '../core/discipline.ts';

export async function listSessionDates(db: SQLiteDatabase, range: DateRange): Promise<IsoDate[]> {
  const rows = await db.getAllAsync<{ date: IsoDate }>(
    `SELECT DISTINCT date FROM training_session
      WHERE date BETWEEN ? AND ?
   ORDER BY date;`,
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

    const debt = WEEKLY_SESSION_TARGET - sessionsInTrailingWeek(sessionDates, day);
    if (debt > 0) missed += 1;
  }

  return missed;
}

export function trainedOn(sessionDates: readonly IsoDate[], date: IsoDate): boolean {
  return sessionDates.includes(date);
}
