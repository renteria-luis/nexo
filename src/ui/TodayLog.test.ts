import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nodes, renderModule, textOf } from './test-render.ts';

const LOG = {
  date: '2026-10-09',
  water_ml: null,
  creatine_taken: null,
  alcohol_drinks: null,
  alcohol_after_training: null,
  cannabis: null,
  sleep_minutes: 465,
  sleep_source: 'autosleep',
  resting_hr: null,
  hrv_ms: null,
  steps: 8123,
  weight_kg: null,
  score: null,
  has_data: 1,
  rest_day: 0,
};

const ARRIVED = new Date(2026, 9, 9, 22, 5).getTime();

const IMPORTS = [
  {
    date: '2026-10-09',
    metric: 'sleep',
    source: 'autosleep',
    value: 465,
    started_at: null,
    ended_at: null,
    imported_at: ARRIVED,
  },
  {
    date: '2026-10-09',
    metric: 'steps',
    source: 'apple_health',
    value: 7000,
    started_at: null,
    ended_at: null,
    imported_at: ARRIVED,
  },
];

function todayLog(props: Record<string, unknown>) {
  return renderModule('src/ui/TodayLog.tsx', {
    './Button.tsx': { Button: 'Button' },
    './Chip.tsx': { Chip: 'Chip' },
    './NumericField.tsx': { NumericField: 'NumericField' },
    './Toggle.tsx': { Toggle: 'Toggle' },
    './icons.ts': Object.fromEntries(
      ['Droplets', 'Footprints', 'Moon', 'Pill', 'RefreshCw', 'Scale', 'Wine'].map((name) => [
        name,
        name,
      ]),
    ),
  }).mount('TodayLog', {
    log: LOG,
    containers: [],
    waterTargetMl: null,
    lastWeight: null,
    editing: false,
    onLog() {},
    onAdd() {},
    onTapWater() {},
    onUndoWater() {},
    canUndoWater: false,
    ...props,
  });
}

test('the day says whether its sleep and steps came from the Shortcut or by hand', async () => {
  const summary = textOf(await todayLog({ healthImports: IMPORTS }).settle());
  assert.ok(summary.includes('7 h 45 min · AutoSleep, 22:05'), summary);
  assert.ok(summary.includes('8123 · a mano'), summary);

  // A screen that does not know what arrived says nothing rather than guessing.
  const unknown = textOf(await todayLog({}).settle());
  assert.ok(unknown.includes('7 h 45 min'));
  assert.ok(!unknown.includes('AutoSleep') && !unknown.includes('a mano'), unknown);
});

test('writing sleep has no source chips and saves what he types as his own', async () => {
  const logged: unknown[] = [];
  const view = todayLog({
    editing: true,
    healthImports: IMPORTS,
    onLog: (entry: unknown) => logged.push(entry),
  });
  let tree = await view.settle();
  const labels = nodes(tree).map((node) => node.props.label);
  for (const gone of ['AutoSleep', 'Apple Health', 'A mano']) {
    assert.ok(!labels.includes(gone), gone);
  }
  assert.ok(textOf(tree).includes('AutoSleep, 22:05'));
  assert.ok(textOf(tree).includes('a mano'));

  const field = () =>
    nodes(tree).find((node) => node.props.accessibilityLabel === 'Horas de sueño')!.props;
  field().onChange('8');
  tree = await view.settle();
  field().onCommit();
  assert.deepEqual(logged, [{ sleepMinutes: 525, sleepSource: 'manual' }]);
});

test('only Hoy offers to bring sleep and steps, and says when Shortcuts does not open', async (t) => {
  t.mock.method(console, 'error', () => {});
  const pull = (tree: unknown) =>
    nodes(tree).find((node) => node.props.label === 'Traer de Salud')?.props;
  assert.equal(pull(await todayLog({ editing: true }).settle()), undefined);

  let runs = 0;
  const view = todayLog({
    editing: true,
    onPullHealth: async () => {
      runs += 1;
      if (runs === 2) throw new Error('no hay app para shortcuts://');
    },
  });
  let tree = await view.settle();
  pull(tree)!.onPress();
  tree = await view.settle();
  assert.equal(runs, 1);
  assert.ok(!textOf(tree).includes('No se pudo abrir Atajos'));
  pull(tree)!.onPress();
  tree = await view.settle();
  assert.equal(runs, 2);
  assert.ok(textOf(tree).includes('No se pudo abrir Atajos: no hay app para shortcuts://'));
});
