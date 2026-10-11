import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nodes, renderModule } from '../test-render.ts';

function chartsFixture(extra: Record<string, unknown> = {}, settings = new Map<string, string>()) {
  const saved: [string, string][] = [];
  const data = {
    from: '2025-10-11',
    to: '2026-10-10',
    weight: [{ date: '2026-10-01', value: 73.4 }],
    weightAverage: [{ date: '2026-10-01', value: 73.6 }],
    trends: [],
    score: [
      { date: '2026-06-01', value: 60 },
      { date: '2026-10-01', value: 80 },
      { date: '2026-10-09', value: 90 },
    ],
    protein: [],
    kcal: [],
    sleep: [],
    steps: [],
    muscles: [],
    creatine: [],
    creatineReading: null,
    creatineProjection: [],
    gymMinutes: [
      { date: '2026-10-05', value: 70, routine: 'Push' },
      { date: '2026-10-07', value: 80, routine: 'Pull' },
      { date: '2026-10-09', value: 65, routine: 'Push' },
    ],
    ...extra,
  };
  const screen = renderModule('src/ui/screens/ChartsScreen.tsx', {
    '@react-navigation/native': { useNavigation: () => ({ navigate() {} }) },
    '../../shell/AppData.tsx': {
      useAppData: () => ({
        state: { phase: 'ready', loaded: { unit: 'lb', settings } },
        loadCharts: async () => data,
        saveSetting: (key: string, value: string) => {
          saved.push([key, value]);
          settings.set(key, value);
        },
      }),
    },
    '../Card.tsx': { Card: 'Card' },
    '../Combobox.tsx': { Combobox: 'Combobox' },
    './Screen.tsx': { Screen: 'Screen' },
    '../charts/LineChart.tsx': { LineChart: 'LineChart' },
    '../charts/DayBars.tsx': { DayBars: 'DayBars' },
    '../charts/MuscleBars.tsx': { MuscleBars: 'MuscleBars' },
    '../charts/RangeDots.tsx': { RangeDots: 'RangeDots', GapsEye: 'GapsEye' },
  }).mount('ChartsScreen');
  return { screen, saved };
}

const card = (tree: unknown, title: string) =>
  nodes(tree).find((node) => node.type === 'Card' && node.props.title === title)!;

test('the body weight chart retains tenths in readings and averages even with gym pounds', async () => {
  const tree = await chartsFixture().screen.settle();
  const chart = nodes(tree).find((node) => node.type === 'LineChart');
  assert.ok(chart);
  assert.deepEqual(
    chart.props.series[0].points.map((point: { value: number }) => point.value),
    [73.4],
  );
  assert.equal(chart.props.format(73.4), '73.4 kg');
  assert.equal(chart.props.format(73.6), '73.6 kg');
});

test('each chart keeps its own range, saved, and starts on the quarter', async () => {
  const { screen, saved } = chartsFixture(
    {},
    new Map([['chart_ranges', JSON.stringify({ score: 7 })]]),
  );
  let tree = await screen.settle();
  const score = () => nodes(card(tree, 'Nota del día')).find((node) => node.type === 'DayBars')!;
  // The whole history goes in; the chart shows a week of it and opens on today.
  assert.equal(score().props.points.length, 3);
  assert.equal(score().props.days, 7);
  assert.equal(score().props.to, '2026-10-10');
  const opened = (score() as unknown as { key: string }).key;
  const dots = card(tree, 'Nota del día').props.action.props;
  assert.equal(dots.days, 7);
  dots.onChange(365);
  tree = await screen.settle();
  assert.deepEqual(saved.at(-1), ['chart_ranges', JSON.stringify({ score: 365 })]);
  assert.equal(score().props.days, 365);
  // Another range is another chart: it opens on today again instead of where it was.
  assert.notEqual((score() as unknown as { key: string }).key, opened);
  // Another chart never chosen shows the quarter.
  const gymDots = nodes(card(tree, 'Tiempo en el gym').props.action).find(
    (node) => node.type === 'RangeDots',
  )!;
  assert.equal(gymDots.props.days, 90);
});

test('gym time can show one routine, starting with all of them', async () => {
  const { screen } = chartsFixture();
  let tree = await screen.settle();
  const gym = () => card(tree, 'Tiempo en el gym');
  const filter = nodes(gym()).find((node) => node.type === 'Combobox')!.props;
  assert.equal(filter.value, 'Todo');
  assert.deepEqual(
    filter.options.map((option: { id: string }) => option.id),
    ['Todo', 'Push', 'Pull'],
  );
  assert.equal(nodes(gym()).find((node) => node.type === 'DayBars')!.props.points.length, 3);
  filter.onChange('Push');
  tree = await screen.settle();
  assert.deepEqual(
    nodes(gym())
      .find((node) => node.type === 'DayBars')!
      .props.points.map((point: { date: string }) => point.date),
    ['2026-10-05', '2026-10-09'],
  );
});

test('touching a creatine bar tells whether it was taken, not the percentage', async () => {
  const { screen } = chartsFixture({
    creatine: [{ date: '2026-10-09', value: 40, note: 'Creatina tomada' }],
    creatineReading: { level: 0.4, fullOn: '2026-10-20' },
  });
  const tree = await screen.settle();
  const bars = nodes(card(tree, 'Creatina')).find((node) => node.type === 'DayBars')!.props;
  assert.equal(bars.format(40), '');
  assert.equal(bars.points[0].note, 'Creatina tomada');
});

test('the eye hides the empty days of gym time and exercise progress only, and is saved', async () => {
  const { screen, saved } = chartsFixture({
    trends: [
      {
        exerciseId: 'peck-deck',
        name: 'Peck deck',
        volume: [{ date: '2026-10-05', value: 500 }],
        topWeight: [],
        e1rm: [],
        intensity: [],
        reps: [],
        sets: [],
      },
    ],
  });
  let tree = await screen.settle();
  const eye = (title: string) =>
    nodes(card(tree, title).props.action).find((node) => node.type === 'GapsEye');
  const bars = (title: string) => nodes(card(tree, title)).find((node) => node.type === 'DayBars')!;
  assert.equal(eye('Nota del día'), undefined);
  assert.equal(eye('Tiempo en el gym')!.props.shown, true);
  assert.equal(bars('Tiempo en el gym').props.gaps, true);
  const opened = (bars('Tiempo en el gym') as unknown as { key: string }).key;

  eye('Tiempo en el gym')!.props.onChange(false);
  tree = await screen.settle();
  assert.deepEqual(saved.at(-1), ['chart_gaps_hidden', JSON.stringify(['gym-minutes'])]);
  assert.equal(eye('Tiempo en el gym')!.props.shown, false);
  assert.equal(bars('Tiempo en el gym').props.gaps, false);
  // Fewer slots is another chart: it opens on today again.
  assert.notEqual((bars('Tiempo en el gym') as unknown as { key: string }).key, opened);
  // The other one keeps its own eye.
  assert.equal(bars('Progreso por ejercicio').props.gaps, true);

  eye('Tiempo en el gym')!.props.onChange(true);
  tree = await screen.settle();
  assert.deepEqual(saved.at(-1), ['chart_gaps_hidden', '[]']);
  assert.equal(bars('Tiempo en el gym').props.gaps, true);
});

test('dumbbell weights say they are one dumbbell, and the volume does not', async () => {
  const trend = (exerciseId: string, perSide: boolean) => ({
    exerciseId,
    name: exerciseId,
    perSide,
    volume: [{ date: '2026-10-05', value: 500 }],
    topWeight: [{ date: '2026-10-05', value: 11.34 }],
    e1rm: [],
    intensity: [],
    reps: [],
    sets: [],
  });
  const { screen } = chartsFixture({
    trends: [trend('hammer-curl-variant-dumbbell', true), trend('peck-deck', false)],
  });
  let tree = await screen.settle();
  const progress = () => card(tree, 'Progreso por ejercicio');
  const bars = () => nodes(progress()).find((node) => node.type === 'DayBars')!.props;
  const pick = (label: string) =>
    nodes(progress()).find(
      (node) => node.type === 'Combobox' && node.props.accessibilityLabel === label,
    )!.props.onChange;
  assert.equal(bars().format(453.59237), '1000 lb');
  pick('Elegir qué se mide')('topWeight');
  tree = await screen.settle();
  assert.equal(bars().format(11.34), '25 lb c/u');
  pick('Elegir el ejercicio')('peck-deck');
  tree = await screen.settle();
  assert.equal(bars().format(11.34), '25 lb');
});
