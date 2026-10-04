import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nodes, renderModule } from '../test-render.ts';

test('the body weight chart retains tenths in readings and averages even with gym pounds', async () => {
  const weight = [{ date: '2026-10-01', value: 73.4 }];
  const data = {
    weight,
    weightAverage: [{ date: '2026-10-01', value: 73.6 }],
    trends: [],
    score: [],
    protein: [],
    kcal: [],
    sleep: [],
    steps: [],
    muscles: [],
    creatine: [],
    creatineReading: null,
    gymMinutes: [],
  };
  const screen = renderModule('src/ui/screens/ChartsScreen.tsx', {
    '@react-navigation/native': { useNavigation: () => ({ navigate() {} }) },
    '../../shell/AppData.tsx': {
      useAppData: () => ({
        state: { phase: 'ready', loaded: { unit: 'lb' } },
        loadCharts: async () => data,
      }),
    },
    '../Card.tsx': { Card: 'Card' },
    '../Chip.tsx': { Chip: 'Chip' },
    '../Combobox.tsx': { Combobox: 'Combobox' },
    './Screen.tsx': { Screen: 'Screen' },
    '../charts/LineChart.tsx': { LineChart: 'LineChart' },
    '../charts/DayBars.tsx': { DayBars: 'DayBars' },
    '../charts/MuscleBars.tsx': { MuscleBars: 'MuscleBars' },
  }).mount('ChartsScreen');
  const chart = nodes(await screen.settle()).find(
    (node) => node.type === 'LineChart' && node.props.series[0].points === weight,
  );
  assert.ok(chart);
  assert.equal(chart.props.format(73.4), '73.4 kg');
  assert.equal(chart.props.format(73.6), '73.6 kg');
});
