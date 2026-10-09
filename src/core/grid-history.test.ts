import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, weekStart } from './dates.ts';
import { buildGrid } from './heatmap.ts';
import {
  GRID_VISIBLE_WEEKS,
  historyRange,
  historyRangeLabel,
  historyToRead,
  historyWeeks,
} from './grid-history.ts';

test('history spans January 2025 through the current week with inert edge padding', () => {
  const today = '2026-10-08';
  const weeks = historyWeeks(today);
  assert.equal(weeks[0], '2024-12-30');
  assert.equal(weeks.at(-1), weekStart(today));
  assert.ok(weeks.every((date, index) => index === 0 || date === addDays(weeks[index - 1], 7)));
  const oldest = historyRange(weeks, 0, GRID_VISIBLE_WEEKS, today);
  assert.deepEqual(oldest, { from: '2025-01-01', to: '2025-03-23' });
  const first = buildGrid([], oldest).flatMap((week) => week.cells);
  assert.deepEqual(
    first.filter((cell) => !cell.inRange).map((cell) => cell.date),
    ['2024-12-30', '2024-12-31'],
  );
  const latest = historyRange(weeks, weeks.length - GRID_VISIBLE_WEEKS, GRID_VISIBLE_WEEKS, today);
  const grid = buildGrid([], latest);
  assert.equal(grid.length, 12);
  assert.equal(latest.to, today);
  assert.deepEqual(
    grid
      .at(-1)!
      .cells.filter((cell) => cell.inRange)
      .map((cell) => cell.date),
    ['2026-10-05', '2026-10-06', '2026-10-07', today],
  );
});

test('the history grows at Monday and supports leap years and year labels', () => {
  assert.equal(historyWeeks('2026-10-12').length, historyWeeks('2026-10-11').length + 1);
  const weeks = historyWeeks('2028-02-29');
  assert.equal(weeks.at(-1), '2028-02-28');
  assert.deepEqual(historyRange(weeks, weeks.length - 1, 12, '2028-02-29'), {
    from: '2028-02-28',
    to: '2028-02-29',
  });
  assert.deepEqual(historyRange(historyWeeks('2025-01-01'), 0, 12, '2025-01-01'), {
    from: '2025-01-01',
    to: '2025-01-01',
  });
  assert.equal(historyRangeLabel({ from: '2025-12-29', to: '2026-01-04' }), 'Dic 2025 – Ene 2026');
});

test('history is read whenever the visible weeks are not covered, not only on a new page', () => {
  const today = '2026-10-08';
  const weeks = historyWeeks(today);
  const page = 4;
  const start = page * GRID_VISIBLE_WEEKS;

  // Read while two pages back, then come forward to the start of this page: still covered.
  const twoBack = historyToRead(weeks, start - 2 * GRID_VISIBLE_WEEKS, today, null, 1)!;
  const read = { range: twoBack, revision: 1 };
  assert.equal(historyToRead(weeks, start - GRID_VISIBLE_WEEKS, today, read, 1), null);

  // Further right on that same page the window leaves the earlier read: it must load.
  const wanted = historyToRead(weeks, start - 1, today, read, 1);
  assert.ok(wanted);
  assert.ok(wanted.to >= historyRange(weeks, start - 1, GRID_VISIBLE_WEEKS, today).to);
  const reread = { range: wanted, revision: 1 };
  for (let index = start - GRID_VISIBLE_WEEKS; index < start; index++) {
    assert.equal(historyToRead(weeks, index, today, reread, 1), null, `week ${index}`);
  }

  // New data makes an earlier read stale; the latest weeks never need one.
  assert.ok(historyToRead(weeks, start - 1, today, reread, 2));
  assert.equal(historyToRead(weeks, weeks.length - GRID_VISIBLE_WEEKS, today, null, 1), null);
});
