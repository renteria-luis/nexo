import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addDays } from '../../core/dates.ts';
import { nodes, renderModule, textOf } from '../test-render.ts';

function bars(props: Record<string, unknown>) {
  return renderModule('src/ui/charts/DayBars.tsx', {
    'react-native-svg': { __esModule: true, default: 'Svg', Rect: 'Rect' },
    './Bubble.tsx': { Bubble: 'Bubble', BUBBLE_WIDTH: 120 },
    '../../core/dates.ts': { ...dates, shortDate: (date: string) => date.slice(5) },
  }).mount('DayBars', { width: 280, days: 7, format: String, onSelect() {}, ...props });
}

// Real date maths, with the axis written as month-day so the tests can read it.
const dates = await import('../../core/dates.ts');

/** One point a day, from `from` for `count` days. */
const daily = (from: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({ date: addDays(from, index), value: 5 }));

const scroller = (tree: unknown) => nodes(tree).find((node) => node.type === 'ScrollView')!;
/** The dates at both ends of the axis, the edges of what is on screen. */
const axis = (tree: unknown) => {
  const texts = nodes(tree)
    .filter((node) => node.type === 'Text')
    .map(textOf);
  return [texts[0], texts.at(-1)];
};

test('a day without data keeps its slot, empty and not a zero', async () => {
  const tree = await bars({
    to: '2026-10-11',
    points: [
      { date: '2026-10-05', value: 5 },
      { date: '2026-10-06', value: 6 },
      { date: '2026-10-07', value: 7 },
    ],
  }).settle();
  const drawn = nodes(tree).filter((node) => node.type === 'Rect');
  // Seven slots of 40: the bars sit where their days are.
  assert.deepEqual(
    drawn.map((node) => node.props.x),
    [1.5, 41.5, 81.5],
  );
  const touch = nodes(tree).filter((node) => node.props.accessibilityLabel?.startsWith('Ver el'));
  assert.equal(touch.length, 3);
});

test('it opens on the days that end today and slides back through the rest', async () => {
  const view = bars({ to: '2026-10-10', points: daily('2026-08-12', 60) });
  let tree = await view.settle();
  const scroll = scroller(tree).props;
  // Sixty days, seven at a time: it opens on the last seven, one 40-point day per snap.
  assert.deepEqual(scroll.contentOffset, { x: 53 * 40, y: 0 });
  assert.equal(scroll.snapToInterval, 40);
  assert.deepEqual(axis(tree), ['10-04', '10-10']);
  // Only the pages near the window are drawn: a year of weeks does not fit in memory.
  assert.equal(nodes(tree).filter((node) => node.type === 'Svg').length, 3);

  scroll.onScroll({ nativeEvent: { contentOffset: { x: 3 * 40 + 19 } } });
  tree = await view.settle();
  // More than half of a day still showing keeps it in the window; less drops it.
  assert.deepEqual(axis(tree), ['08-15', '08-21']);
  scroll.onScroll({ nativeEvent: { contentOffset: { x: 3 * 40 + 21 } } });
  tree = await view.settle();
  assert.deepEqual(axis(tree), ['08-16', '08-22']);
});

test('the estimate waits to the right of today', async () => {
  const tree = await bars({
    to: '2026-10-10',
    points: daily('2026-10-01', 9),
    projected: daily('2026-10-10', 5),
  }).settle();
  // Today is not logged, so its slot is the first estimate, at the right edge.
  assert.deepEqual(axis(tree), ['10-04', '10-10']);
  const dashed = nodes(tree).filter((node) => node.props.strokeDasharray === '3,2');
  assert.equal(dashed.length, 5);
});

test('a swipe closes the bubble, and a short history only bounces', async () => {
  const closed: unknown[] = [];
  const tree = await bars({
    to: '2026-10-10',
    points: daily('2026-10-08', 3),
    selected: 1,
    onSelect: (index: unknown) => closed.push(index),
  }).settle();
  const scroll = scroller(tree).props;
  // Nothing to snap to, but one pixel wider than the card, so iOS 26 leaves the swipe to
  // the chart instead of going back.
  assert.equal(scroll.snapToInterval, undefined);
  assert.equal(scroll.children.at(-1).props.style.width, 1 / 3);
  assert.ok(nodes(tree).some((node) => node.type === 'Bubble'));
  scroll.onScrollBeginDrag();
  assert.deepEqual(closed, [null]);
});

test('without gaps only the days with data remain, as many as the range holds', async () => {
  const tree = await bars({
    to: '2026-10-10',
    gaps: false,
    points: [
      { date: '2026-09-20', value: 5 },
      { date: '2026-10-05', value: 5 },
      { date: '2026-10-07', value: 5 },
      { date: '2026-10-09', value: 5 },
    ],
  }).settle();
  // Three of them fall in the last seven days: three bars wide, opening on them.
  assert.deepEqual(axis(tree), ['10-05', '10-09']);
  assert.deepEqual(scroller(tree).props.contentOffset, { x: 280 / 3, y: 0 });
  assert.equal(nodes(tree).filter((node) => node.type === 'Rect').length, 4);
  const touch = nodes(tree).filter((node) => node.props.accessibilityLabel?.startsWith('Ver el'));
  assert.equal(touch.length, 4);
});
