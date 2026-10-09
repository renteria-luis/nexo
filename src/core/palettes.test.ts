import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  colorForScore,
  DEFAULT_SCORE_SCALE,
  levelForScore,
  NO_DATA_COLOR,
  SCORE_PALETTES,
  scoreScaleFrom,
  scoreScaleProblem,
  ZERO_SCORE_COLOR,
} from './palettes.ts';
import type { ScorePalette } from './palettes.ts';
import { settingProblem } from './settings.ts';
import { buildGrid } from './heatmap.ts';

test('all five palettes share neutral states and respect exact custom limits without rounding', () => {
  for (const palette of Object.keys(SCORE_PALETTES) as ScorePalette[]) {
    const scale = { palette, lowMax: 20.5, mediumMax: 60, topMin: 90 };
    const colors = SCORE_PALETTES[palette].colors;
    assert.equal(colorForScore(null, scale), NO_DATA_COLOR);
    assert.equal(colorForScore(0, scale), ZERO_SCORE_COLOR);
    const examples = [
      [0.01, 0],
      [20.5, 0],
      [20.51, 1],
      [60, 1],
      [60.01, 2],
      [89.99, 2],
      [90, 3],
      [100, 3],
    ];
    for (const [score, index] of examples) assert.equal(colorForScore(score, scale), colors[index]);
    assert.equal(levelForScore(90, scale).label, 'Muy alto');
  }
  assert.equal(levelForScore(99.99).label, 'Alto');
  assert.equal(levelForScore(100).label, 'Completo');
});

test('invalid, overlapping and reversed color limits cannot be saved', () => {
  for (const bad of [
    null,
    {},
    { ...DEFAULT_SCORE_SCALE, palette: 'unknown' },
    ...[0, -1, 50, NaN, Infinity, '10'].map((lowMax) => ({ ...DEFAULT_SCORE_SCALE, lowMax })),
    { ...DEFAULT_SCORE_SCALE, mediumMax: 100 },
    { ...DEFAULT_SCORE_SCALE, topMin: 101 },
  ]) {
    assert.ok(scoreScaleProblem(bad));
    assert.ok(settingProblem('score_scale', JSON.stringify(bad)));
    assert.throws(() => scoreScaleFrom(JSON.stringify(bad)));
  }
  assert.deepEqual(scoreScaleFrom(), DEFAULT_SCORE_SCALE);
  assert.equal(settingProblem('score_scale', '{broken'), 'La escala no es válida.');
  assert.equal(settingProblem('score_scale', JSON.stringify(DEFAULT_SCORE_SCALE)), null);
});

test('changing a palette recolors history without rewriting scores or data presence', () => {
  const days = [{ date: '2025-01-01', score: 80, hasData: true }];
  const range = { from: '2025-01-01', to: '2025-01-02' };
  const before = buildGrid(days, range).flatMap((week) => week.cells);
  const after = buildGrid(days, range, {
    ...DEFAULT_SCORE_SCALE,
    palette: 'pink',
    topMin: 75,
  }).flatMap((week) => week.cells);
  assert.deepEqual(
    before.map(({ color, ...cell }) => cell),
    after.map(({ color, ...cell }) => cell),
  );
  assert.notEqual(before[2].color, after[2].color);
  assert.equal(after[3].color, NO_DATA_COLOR);
  assert.deepEqual(days, [{ date: '2025-01-01', score: 80, hasData: true }]);
});
