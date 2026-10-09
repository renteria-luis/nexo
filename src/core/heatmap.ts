// Spec 4.5 and 17.2. Takes any series of (date, score, has data) and lays it out in
// Monday to Sunday weeks. Nothing here belongs to Training: a Finance module scoring
// a weekly grocery budget would render through exactly this.

import {
  addDays,
  daysBetween,
  shortMonth,
  weekStart,
  type DateRange,
  type IsoDate,
} from './dates.ts';
import { colorForScore, DEFAULT_SCORE_SCALE, type ScoreScaleOptions } from './palettes.ts';

export type ScoredDay = {
  date: IsoDate;
  /** Null when spec 6.6 could not score the day. */
  score: number | null;
  hasData: boolean;
};

export type GridCell = {
  date: IsoDate;
  score: number | null;
  hasData: boolean;
  color: string;
  inRange: boolean;
};

export type GridWeek = {
  /** The Monday the row starts on. */
  startsOn: IsoDate;
  month: string | null;
  /** Seven cells, Monday through Sunday. */
  cells: GridCell[];
};

function cellFor(
  day: ScoredDay | undefined,
  date: IsoDate,
  inRange: boolean,
  scale: ScoreScaleOptions,
): GridCell {
  const hasData = inRange && (day?.hasData ?? false);
  const score = hasData ? (day?.score ?? null) : null;

  return {
    date,
    score,
    hasData,
    color: colorForScore(score, scale),
    inRange,
  };
}

/**
 * Whole weeks keep weekday alignment at both edges. Padding days remain in the
 * layout but cannot expose records or open a day outside the requested range.
 */
export function buildGrid(
  days: readonly ScoredDay[],
  range: DateRange,
  scale = DEFAULT_SCORE_SCALE,
): GridWeek[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const firstMonday = weekStart(range.from);
  const totalDays = daysBetween(firstMonday, range.to) + 1;
  if (totalDays <= 0) throw new Error(`the range ends on ${range.to}, before it starts`);

  const weeks: GridWeek[] = [];
  let previousMonth: string | null = null;
  for (let offset = 0; offset < totalDays; offset += 7) {
    const startsOn = addDays(firstMonday, offset);
    const cells = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(startsOn, index);
      return cellFor(byDate.get(date), date, date >= range.from && date <= range.to, scale);
    });
    const firstDate = cells.find((cell) => cell.inRange)?.date;
    const monthKey = firstDate?.slice(0, 7) ?? null;
    const month = firstDate && monthKey !== previousMonth ? shortMonth(firstDate) : null;
    weeks.push({ startsOn, month, cells });
    previousMonth = monthKey;
  }
  return weeks;
}

/** Spec 4.5: days without data are left out of averages, not counted as zero. */
export function averageScore(days: readonly ScoredDay[]): number | null {
  const scored = days.filter((day) => day.hasData && day.score !== null);
  if (scored.length === 0) return null;
  return scored.reduce((total, day) => total + (day.score as number), 0) / scored.length;
}
