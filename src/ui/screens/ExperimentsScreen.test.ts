import assert from 'node:assert/strict';
import { test } from 'node:test';

import { todayIso } from '../../core/dates.ts';
import { nodes, renderModule } from '../test-render.ts';

test('experiments expose their stated scale and highlight the saved reading', async () => {
  for (const [metric, value, scale] of [
    ['Cómo amanezco del 1 al 10', 8, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    ['Piel de 0 a 5, una vez por semana', 4, [0, 1, 2, 3, 4, 5]],
  ] as const) {
    let written = -1;
    let finished = 0;
    const item = {
      experiment: {
        id: 'test',
        name: 'Test',
        start_date: todayIso(),
        end_date: null,
        outcome_metric: metric,
      },
      readings: [{ date: todayIso(), value }],
      weeksRunning: 0,
      halves: null,
    };
    const screen = renderModule('src/ui/screens/ExperimentsScreen.tsx', {
      '../../shell/AppData.tsx': {
        useAppData: () => ({
          loadExperiments: async () => [item],
        logExperimentReading: async (_id: string, _day: string, next: number) => {
          written = next;
        },
        finishExperiment: async () => { finished += 1; },
        }),
      },
      '../Card.tsx': { Card: 'Card' },
      '../Chip.tsx': { Chip: 'Chip' },
      '../Button.tsx': { Button: 'Button' },
      '../TextField.tsx': { TextField: 'TextField' },
      '../icons.ts': { Plus: 'Plus' },
      './Screen.tsx': { Screen: 'Screen' },
      '../InfoBubble.tsx': { ConfirmAction: 'ConfirmAction' },
    }).mount('ExperimentsScreen');
    const chips = nodes(await screen.settle()).filter((node) => node.type === 'Chip');
    assert.deepEqual(
      chips.map((node) => Number(node.props.label)),
      [...scale],
    );
    assert.equal(chips.find((node) => Number(node.props.label) === value)?.props.selected, true);
    chips.find((node) => Number(node.props.label) === value)!.props.onPress();
    await screen.settle();
    assert.equal(written, value);
    const finish = nodes(screen.render()).find(
      (node) => node.props.accessibilityLabel === 'Terminar Test',
    );
    assert.equal(finish?.type, 'ConfirmAction');
    assert.match(finish.props.question, /Terminar/);
    assert.equal(finished, 0);
    await finish.props.onConfirm();
    await screen.settle();
    assert.equal(finished, 1);
  }
});
