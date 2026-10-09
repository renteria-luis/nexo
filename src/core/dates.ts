// Day boundaries and week windows. Spec 17.2 names this as shared core precisely
// because every module needs it and every module gets it wrong on its own.
//
// A day here is a local calendar fact written 'YYYY-MM-DD', never an instant.
// Arithmetic runs at UTC midnight so a daylight saving change cannot shift a day,
// and only todayIso reads the device clock, in local time, on purpose.

/** Local calendar day, 'YYYY-MM-DD'. */
export type IsoDate = string;

const DAY_MS = 86_400_000;
const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

function toUtcMs(date: IsoDate): number {
  if (!SHAPE.test(date)) throw new Error(`not a YYYY-MM-DD date: ${date}`);
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) throw new Error(`not a date that exists: ${date}`);
  // Date.parse accepts '2026-02-31' on some engines by rolling over, which would
  // silently move the day. Round tripping catches it.
  const roundTrip = new Date(ms).toISOString().slice(0, 10);
  if (roundTrip !== date) throw new Error(`not a date that exists: ${date}`);
  return ms;
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Si es un dia que existe en el calendario. La forma AAAA-MM-DD no basta: 1990-15-01
 * la cumple y no es ninguna fecha, y hasta ahora eso se guardaba y reventaba al
 * arrancar, con la app entera bloqueada en la pantalla de error.
 */
export function isRealDate(date: string): boolean {
  try {
    toUtcMs(date);
    return true;
  } catch {
    return false;
  }
}

/** The device's current local day. The only function here that reads the clock. */
export function todayIso(now: Date = new Date()): IsoDate {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function millisecondsToLocalMidnight(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1, next.getTime() - now.getTime());
}

/** Los tres primeros meses en espanol, que es como los lee de un vistazo. */
const MONTHS_ES = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

const MONTH_NAMES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'setiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const WEEKDAYS_ES = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

const WEEKDAY_NAMES_ES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export function shortMonth(date: IsoDate): string {
  const month = MONTHS_ES[Number(date.split('-')[1]) - 1];
  if (!month) throw new Error(`${date} is not a date`);
  return month[0].toUpperCase() + month.slice(1);
}

/**
 * 2026-08-08 se lee "sáb, 08-ago-2026": sin ambiguedad entre dia y mes, y con el dia de
 * la semana, que es lo que de verdad usa para ubicarse ("el martes no entrene").
 */
export function shortDate(date: IsoDate): string {
  const [year, month, day] = date.split('-');
  const index = Number(month) - 1;
  if (!MONTHS_ES[index]) throw new Error(`${date} is not a date`);
  return `${WEEKDAYS_ES[weekday(date) - 1]}, ${day}-${MONTHS_ES[index]}-${year}`;
}

/** "dom 28-sep", para una lista de dias donde el ano se da por supuesto. */
export function shortDay(date: IsoDate): string {
  const [, month, day] = date.split('-');
  const index = Number(month) - 1;
  if (!MONTHS_ES[index]) throw new Error(`${date} is not a date`);
  return `${WEEKDAYS_ES[weekday(date) - 1]} ${day}-${MONTHS_ES[index]}`;
}

/** "viernes, 30 de setiembre", que es como se dice un dia en voz alta. */
export function longDate(date: IsoDate): string {
  const [, month, day] = date.split('-');
  const index = Number(month) - 1;
  if (!MONTH_NAMES_ES[index]) throw new Error(`${date} is not a date`);
  return `${WEEKDAY_NAMES_ES[weekday(date) - 1]}, ${Number(day)} de ${MONTH_NAMES_ES[index]}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** 1 Monday through 7 Sunday. */
export function weekday(date: IsoDate): number {
  const sundayFirst = new Date(toUtcMs(date)).getUTCDay();
  return sundayFirst === 0 ? 7 : sundayFirst;
}

/** Monday of the week containing the date. Weeks run Monday to Sunday (spec 6.1). */
export function weekStart(date: IsoDate): IsoDate {
  return addDays(date, -(weekday(date) - 1));
}

/** Sunday of the week containing the date. */
export function weekEnd(date: IsoDate): IsoDate {
  return addDays(weekStart(date), 6);
}

export type DateRange = {
  from: IsoDate;
  to: IsoDate;
};

/** The window of `days` days ending on and including `date`. */
export function trailingDays(date: IsoDate, days: number): DateRange {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`a trailing window needs at least one whole day, got ${days}`);
  }
  return { from: addDays(date, -(days - 1)), to: date };
}

/** The week containing the date, Monday to Sunday. */
export function weekRange(date: IsoDate): DateRange {
  return { from: weekStart(date), to: weekEnd(date) };
}

export function isWithin(date: IsoDate, range: DateRange): boolean {
  return daysBetween(range.from, date) >= 0 && daysBetween(date, range.to) >= 0;
}
