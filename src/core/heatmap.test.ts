import assert from 'node:assert/strict';
import { test } from 'node:test';

import { averageScore, buildGrid, type ScoredDay } from './heatmap.ts';
import {
  NO_DATA_COLOR,
  PREVIEW_SCORES,
  colorForScore,
  fillForScore,
  type PaletteId,
} from './palettes.ts';

const PALETTES: PaletteId[] = ['deutan', 'standard', 'tritan'];

function luminance(hex: string): number {
  const channel = (at: number) => parseInt(hex.slice(at, at + 2), 16);
  // Rec. 709, which is close enough to judge whether a ramp is monotonic.
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

test('every palette produces a colour across the whole range', () => {
  for (const palette of PALETTES) {
    for (const score of PREVIEW_SCORES) {
      assert.match(colorForScore(score, palette), /^#[0-9a-f]{6}$/);
    }
  }
});

test('a score outside 0 to 100 is a mistake, not a clamped colour', () => {
  assert.throws(() => colorForScore(101, 'deutan'), /outside 0 to 100/);
  assert.throws(() => colorForScore(-1, 'deutan'), /outside 0 to 100/);
});

test('the deutan scale runs dark blue at the top to yellow at the bottom', () => {
  assert.equal(colorForScore(100, 'deutan'), '#00204c');
  assert.equal(colorForScore(0, 'deutan'), '#ffea46');
});

test('the deutan scale survives losing hue entirely', () => {
  // Spec 4.5: luminance has to vary monotonically with the score, so the grid still
  // reads for someone who sees no colour at all.
  const steps = PREVIEW_SCORES.map((score) => luminance(colorForScore(score, 'deutan')));
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(
      steps[i] < steps[i - 1],
      `luminance should keep falling as the score rises, broke at ${PREVIEW_SCORES[i]}`,
    );
  }
});

test('the tritan scale is monotonic too', () => {
  const steps = PREVIEW_SCORES.map((score) => luminance(colorForScore(score, 'tritan')));
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i] < steps[i - 1], `broke at ${PREVIEW_SCORES[i]}`);
  }
});

test('no data has its own colour, distinct from both ends of every palette', () => {
  assert.equal(colorForScore(null, 'deutan'), NO_DATA_COLOR);
  for (const palette of PALETTES) {
    assert.notEqual(colorForScore(0, palette), NO_DATA_COLOR);
    assert.notEqual(colorForScore(100, palette), NO_DATA_COLOR);
  }
});

test('the fill is proportional to the score', () => {
  assert.equal(fillForScore(0), 0);
  assert.equal(fillForScore(50), 0.5);
  assert.equal(fillForScore(100), 1);
});

test('the grid lays days out in Monday to Sunday rows', () => {
  // 2026-09-07 is a Monday, 2026-09-13 the Sunday that closes the week.
  const weeks = buildGrid([], { from: '2026-09-07', to: '2026-09-20' }, 'deutan');

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
  const weeks = buildGrid([], { from: '2026-09-10', to: '2026-09-13' }, 'deutan');
  assert.equal(weeks[0].startsOn, '2026-09-07');
  assert.equal(weeks.length, 1);
});

test('a day with no entry renders as neutral grey, filled', () => {
  const weeks = buildGrid([], { from: '2026-09-07', to: '2026-09-13' }, 'deutan');
  const cell = weeks[0].cells[0];

  assert.equal(cell.hasData, false);
  assert.equal(cell.score, null);
  assert.equal(cell.color, NO_DATA_COLOR);
  // Full grey, so an absent day reads as absent instead of as a day scored zero.
  assert.equal(cell.fill, 1);
});

test('a day scored zero leaves the cell empty, which is not the same picture', () => {
  const days: ScoredDay[] = [{ date: '2026-09-07', score: 0, hasData: true }];
  const cell = buildGrid(days, { from: '2026-09-07', to: '2026-09-13' }, 'deutan')[0].cells[0];

  assert.equal(cell.fill, 0);
  assert.notEqual(cell.color, NO_DATA_COLOR);
});

test('a day flagged as having no data is grey even if a score is sitting there', () => {
  const days: ScoredDay[] = [{ date: '2026-09-07', score: 90, hasData: false }];
  const cell = buildGrid(days, { from: '2026-09-07', to: '2026-09-13' }, 'deutan')[0].cells[0];

  assert.equal(cell.score, null);
  assert.equal(cell.color, NO_DATA_COLOR);
});

test('scores land on the right weekday', () => {
  const days: ScoredDay[] = [
    { date: '2026-09-07', score: 90, hasData: true },
    { date: '2026-09-13', score: 40, hasData: true },
  ];
  const week = buildGrid(days, { from: '2026-09-07', to: '2026-09-13' }, 'standard')[0];

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
  assert.throws(
    () => buildGrid([], { from: '2026-09-13', to: '2026-09-01' }, 'deutan'),
    /before it starts/,
  );
});
