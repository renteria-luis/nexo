import type { SQLiteDatabase } from 'expo-sqlite';
import { listDailyLogs } from '../core/daily-log.ts';
import type { DateRange } from '../core/dates.ts';
import type { ScoredDay } from '../core/heatmap.ts';
import type { CoreDailyLogRow } from '../db/types.ts';
import { listSessionDates } from '../training/history.ts';

export async function loadScorePeriod(
  db: SQLiteDatabase,
  range: DateRange,
): Promise<{ days: ScoredDay[]; logs: CoreDailyLogRow[] }> {
  const [logs, trained] = await Promise.all([
    listDailyLogs(db, range),
    listSessionDates(db, range),
  ]);
  const byDate = new Map(logs.map((log) => [log.date, log]));
  const trainedDates = new Set(trained);
  const days = [...new Set([...byDate.keys(), ...trained])].sort().map((date) => {
    const log = byDate.get(date);
    return {
      date,
      score: log?.score ?? null,
      hasData: log?.score != null || log?.has_data === 1 || trainedDates.has(date),
    };
  });
  return { days, logs };
}
