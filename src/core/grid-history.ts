import {
  addDays,
  daysBetween,
  shortMonth,
  weekStart,
  type DateRange,
  type IsoDate,
} from './dates.ts';

export const GRID_HISTORY_START = '2025-01-01';
export const GRID_VISIBLE_WEEKS = 12;

export function historyWeeks(today: IsoDate): IsoDate[] {
  const first = weekStart(GRID_HISTORY_START);
  if (today < GRID_HISTORY_START) return [];
  const count = Math.floor(daysBetween(first, today) / 7) + 1;
  return Array.from({ length: count }, (_, index) => addDays(first, index * 7));
}

export function historyRange(
  weeks: readonly IsoDate[],
  index: number,
  count: number,
  today: IsoDate,
): DateRange {
  const start = weeks[Math.max(0, Math.min(index, weeks.length - 1))] ?? GRID_HISTORY_START;
  const end = weeks[Math.min(weeks.length - 1, Math.max(0, index) + count - 1)] ?? start;
  return {
    from: start < GRID_HISTORY_START ? GRID_HISTORY_START : start,
    to: addDays(end, 6) > today ? today : addDays(end, 6),
  };
}

export function historyRangeLabel(range: DateRange): string {
  const from = `${shortMonth(range.from)} ${range.from.slice(0, 4)}`;
  const to = `${shortMonth(range.to)} ${range.to.slice(0, 4)}`;
  return from === to ? from : `${from} – ${to}`;
}
