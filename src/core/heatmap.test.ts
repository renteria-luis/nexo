import assert from 'node:assert/strict';
import { test } from 'node:test';

import { averageScore, buildGrid, type ScoredDay } from './heatmap.ts';
import { NO_DATA_COLOR, colorForScore } from './palettes.ts';

test('score buckets honor exact boundaries without rounding up completion', () => {
  const examples: [number, string][] = [
    [0, '#D1D5DB'],
    [0.1, '#A7D9B0'],
    [25, '#A7D9B0'],
    [25.1, '#70BB84'],
    [50, '#70BB84'],
    [50.1, '#36985B'],
    [75, '#36985B'],
    [99.9, '#36985B'],
    [100, '#17683A'],
  ];
  for (const [score, color] of examples) assert.equal(colorForScore(score), color);
  assert.equal(colorForScore(null), NO_DATA_COLOR);
  assert.notEqual(colorForScore(null), colorForScore(0));
});

test('invalid scores cannot silently produce a valid completion color', () => {
  for (const score of [-1, 100.1, NaN, Infinity]) {
    assert.throws(() => colorForScore(score), /outside 0 to 100/);
  }
});

test('the grid lays days out in Monday to Sunday rows', () => {
  // 2026-09-07 is a Monday, 2026-09-13 the Sunday that closes the week.
  const weeks = buildGrid([], { from: '2026-09-07', to: '2026-09-20' });

  assert.equal(weeks.length, 2);
  assert.deepEqual(
    weeks.map((week) => week.startsOn),
    ['2026-09-07', '2026-09-14'],
  );
  assert.equal(weeks[0].cells.length, 7);
  assert.equal(weeks[0].cells[0].date, '2026-09-07');
  assert.equal(weeks[0].cells[6].date, '2026-09-13');
});

test('a range starting mid week still begins on the Monday', () => {
  const weeks = buildGrid([], { from: '2026-09-10', to: '2026-09-13' });
  assert.equal(weeks[0].startsOn, '2026-09-07');
  assert.equal(weeks.length, 1);
});

test('a day with no entry renders without a score color', () => {
  const weeks = buildGrid([], { from: '2026-09-07', to: '2026-09-13' });
  const cell = weeks[0].cells[0];

  assert.equal(cell.hasData, false);
  assert.equal(cell.score, null);
  assert.equal(cell.color, NO_DATA_COLOR);
  assert.equal(cell.inRange, true);
});

test('a recorded zero uses solid grey, distinct from no data', () => {
  const days: ScoredDay[] = [{ date: '2026-09-07', score: 0, hasData: true }];
  const cell = buildGrid(days, { from: '2026-09-07', to: '2026-09-13' })[0].cells[0];

  assert.equal(cell.score, 0);
  assert.equal(cell.color, '#D1D5DB');
  assert.notEqual(cell.color, NO_DATA_COLOR);
});

test('a day flagged as having no data stays uncolored even if a score is sitting there', () => {
  const days: ScoredDay[] = [{ date: '2026-09-07', score: 90, hasData: false }];
  const cell = buildGrid(days, { from: '2026-09-07', to: '2026-09-13' })[0].cells[0];

  assert.equal(cell.score, null);
  assert.equal(cell.color, NO_DATA_COLOR);
});

test('scores land on the right weekday', () => {
  const days: ScoredDay[] = [
    { date: '2026-09-07', score: 90, hasData: true },
    { date: '2026-09-13', score: 40, hasData: true },
  ];
  const week = buildGrid(days, { from: '2026-09-07', to: '2026-09-13' })[0];

  assert.equal(week.cells[0].score, 90);
  assert.equal(week.cells[6].score, 40);
  assert.equal(week.cells[3].score, null);
});

test('averages leave out the days without data instead of counting them as zero', () => {
  const days: ScoredDay[] = [
    { date: '2026-09-07', score: 80, hasData: true },
    { date: '2026-09-08', score: 60, hasData: true },
    { date: '2026-09-09', score: null, hasData: false },
    { date: '2026-09-10', score: null, hasData: true },
  ];

  assert.equal(averageScore(days), 70);
  assert.equal(averageScore([]), null);
  assert.equal(averageScore([{ date: '2026-09-07', score: null, hasData: false }]), null);
});

test('a range that ends before it starts is a mistake', () => {
  assert.throws(() => buildGrid([], { from: '2026-09-13', to: '2026-09-01' }), /before it starts/);
});

test('month headings cross years without duplicating January after a partial week', () => {
  const weeks = buildGrid([], { from: '2024-12-23', to: '2025-02-09' });
  assert.deepEqual(
    weeks.map((week) => week.month),
    ['Dic', null, 'Ene', null, null, null, 'Feb'],
  );
  const january = buildGrid([], { from: '2025-01-01', to: '2025-01-12' });
  assert.deepEqual(
    january.map((week) => week.month),
    ['Ene', null],
  );
});

test('padding days cannot expose out-of-range records as selectable scores', () => {
  const days: ScoredDay[] = [
    { date: '2024-12-30', score: 100, hasData: true },
    { date: '2025-01-05', score: 100, hasData: true },
  ];
  const cells = buildGrid(days, { from: '2025-01-01', to: '2025-01-04' })[0].cells;
  assert.deepEqual(
    cells.map((cell) => cell.inRange),
    [false, false, true, true, true, true, false],
  );
  for (const cell of [cells[0], cells[6]]) {
    assert.equal(cell.score, null);
    assert.equal(cell.hasData, false);
    assert.equal(cell.color, NO_DATA_COLOR);
  }
});
