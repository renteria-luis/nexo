import { useEffect, useMemo, useState } from 'react';

import { REALTIME_FRESH_MS } from '../transit/realtime-contract.ts';
import type { ReportedBus } from './TransitMap.types.ts';

const empty: ReportedBus[] = [];

export function useReportedBuses(buses: ReportedBus[] = empty) {
  const [checkedAt, setCheckedAt] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const now = Date.now();
      setCheckedAt(now);
      const nextExpiry = Math.min(
        ...buses.flatMap((bus) =>
          !bus.stale &&
          (bus.freshnessAt ?? bus.measuredAt) !== null &&
          (bus.freshnessAt ?? bus.measuredAt)! + REALTIME_FRESH_MS + 1 > now
            ? [(bus.freshnessAt ?? bus.measuredAt)! + REALTIME_FRESH_MS + 1]
            : [],
        ),
      );
      if (Number.isFinite(nextExpiry)) timer = setTimeout(check, Math.max(1, nextExpiry - now));
    };
    check();
    return () => clearTimeout(timer);
  }, [buses]);
  return useMemo(
    () =>
      buses.map((bus) => ({
        ...bus,
        stale:
          bus.stale ||
          bus.measuredAt === null ||
          checkedAt - (bus.freshnessAt ?? bus.measuredAt) > REALTIME_FRESH_MS,
      })),
    [buses, checkedAt],
  );
}
