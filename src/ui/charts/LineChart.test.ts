import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nodes, renderModule, textOf } from '../test-render.ts';

const dates = await import('../../core/dates.ts');

function line(props: Record<string, unknown>) {
  return renderModule('src/ui/charts/LineChart.tsx', {
    'react-native-svg': { __esModule: true, default: 'Svg', Circle: 'Circle', Path: 'Path' },
    './Bubble.tsx': { Bubble: 'Bubble', BUBBLE_WIDTH: 120 },
    '../../core/dates.ts': { ...dates, shortDate: (date: string) => date.slice(5) },
  }).mount('LineChart', { width: 280, days: 7, format: String, onSelect() {}, ...props });
}

test('weigh-ins sit on their own days and the line opens on today', async () => {
  const view = line({
    to: '2026-10-10',
    series: [
      {
        points: [
          { date: '2026-09-21', value: 73 },
          { date: '2026-10-05', value: 72.4 },
        ],
        color: 'grey',
        dots: true,
      },
    ],
  });
  let tree = await view.settle();
  const texts = () =>
    nodes(tree)
      .filter((node) => node.type === 'Text')
      .map(textOf);
  // Twenty days, seven at a time, opening on the last seven.
  assert.deepEqual(texts(), ['10-04', '72.4 a 73', '10-10']);
  const scroll = nodes(tree).find((node) => node.type === 'ScrollView')!.props;
  assert.deepEqual(scroll.contentOffset, { x: 13 * 40, y: 0 });
  // The 5th sits fourteen days of 40 points after the 21st: the gap keeps its width.
  const firstPage = nodes(tree).find((node) => node.type === 'Svg')!;
  assert.deepEqual(
    nodes(firstPage)
      .filter((node) => node.type === 'Circle')
      .map((node) => node.props.cx),
    [20, 20 + 14 * 40],
  );
  // Only the two days with a weigh-in can be touched.
  const touch = nodes(tree).filter((node) => node.props.accessibilityLabel?.startsWith('Ver el'));
  assert.equal(touch.length, 2);

  scroll.onScroll({ nativeEvent: { contentOffset: { x: 0 } } });
  tree = await view.settle();
  assert.deepEqual(texts(), ['09-21', '72.4 a 73', '09-27']);
});
