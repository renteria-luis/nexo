// Spec 4.5 and 17.2. Takes any series of (date, score, has data) and lays it out in
// Monday to Sunday weeks. Nothing here belongs to Training: a Finance module scoring
// a weekly grocery budget would render through exactly this.

import { addDays, daysBetween, weekStart, type DateRange, type IsoDate } from './dates.ts';
import { NO_DATA_COLOR, colorForScore, fillForScore, type PaletteId } from './palettes.ts';

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
  /** 0 to 1, the share of the cell that is filled. */
  fill: number;
};

export type GridWeek = {
  /** The Monday the row starts on. */
  startsOn: IsoDate;
  /** Seven cells, Monday through Sunday. */
  cells: GridCell[];
};

function cellFor(day: ScoredDay | undefined, date: IsoDate, palette: PaletteId): GridCell {
  const hasData = day?.hasData ?? false;
  const score = hasData ? (day?.score ?? null) : null;

  // A day with no data fills completely in neutral grey, so it reads as absent
  // rather than as a bad day. A day that scored zero leaves the cell empty, which
  // is the honest picture of having earned nothing.
  if (score === null) {
    return { date, score: null, hasData, color: NO_DATA_COLOR, fill: 1 };
  }

  return {
    date,
    score,
    hasData,
    color: colorForScore(score, palette),
    fill: fillForScore(score),
  };
}

/**
 * Whole weeks covering the range, so a row is always seven cells wide. Days outside
 * the range at either edge render as no-data rather than being left out, because a
 * ragged row reads as missing information that is not actually missing.
 */
export function buildGrid(
  days: readonly ScoredDay[],
  range: DateRange,
  palette: PaletteId,
): GridWeek[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const firstMonday = weekStart(range.from);
  const totalDays = daysBetween(firstMonday, range.to) + 1;
  if (totalDays <= 0) throw new Error(`the range ends on ${range.to}, before it starts`);

  const weeks: GridWeek[] = [];
  for (let offset = 0; offset < totalDays; offset += 7) {
    const startsOn = addDays(firstMonday, offset);
    const cells = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(startsOn, index);
      return cellFor(byDate.get(date), date, palette);
    });
    weeks.push({ startsOn, cells });
  }
  return weeks;
}

/** Spec 4.5: days without data are left out of averages, not counted as zero. */
export function averageScore(days: readonly ScoredDay[]): number | null {
  const scored = days.filter((day) => day.hasData && day.score !== null);
  if (scored.length === 0) return null;
  return scored.reduce((total, day) => total + (day.score as number), 0) / scored.length;
}
