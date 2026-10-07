import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TrainingSessionRow } from '../db/types.ts';
import { analyzeTiming, type SessionTiming, type TimingSet } from '../training/timing.ts';
import type { TimingCorrection } from '../training/timing-store.ts';
import { nodes, renderModule, textOf } from './test-render.ts';

function fixture(fail = false) {
  const start = new Date(2026, 9, 7, 12).getTime();
  const session: TrainingSessionRow = {
    id: 'session',
    date: '2026-10-07',
    start_time: start,
    end_time: start + 3600000,
    gym_id: 'fanshawe',
    routine_id: 'push',
    alone_or_partner: 'alone',
    time_budget: 'completo',
    crowding: null,
    is_retroactive: 0,
    notes: null,
    duration_trusted: 1,
  };
  let sets: TimingSet[] = [1, 2, 3].map((n) => ({
    id: `set-${n}`,
    exerciseId: 'press',
    implement: 'dumbbell',
    setIndex: n,
    timestamp: start + n * 200000,
    warmup: false,
    eligible: true,
    review: 'auto',
    correctedSeconds: null,
  }));
  const calls: { id: string; correction: TimingCorrection }[] = [];
  const history = [
    {
      sessionId: 'past',
      date: '2026-10-06',
      exerciseId: 'press',
      implement: 'dumbbell',
      sets: 3,
      samples: 2,
      flagged: 0,
      minutes: 8,
    },
  ];
  const timing = (): SessionTiming => ({
    session,
    sets,
    history,
    exercises: analyzeTiming(session, sets, history),
  });
  const actions = {
    loadSessionTiming: async () => timing(),
    reviewTiming: async (id: string, correction: TimingCorrection) => {
      calls.push({ id, correction });
      if (fail) throw new Error('No se pudo guardar el tiempo.');
      sets = sets.map((set) =>
        set.id === id
          ? { ...set, review: correction.review, correctedSeconds: correction.seconds }
          : set,
      );
    },
  };
  const screen = renderModule('src/ui/TrainingTiming.tsx', {
    '../shell/AppData.tsx': { useAppData: () => actions },
    './Card.tsx': { Card: 'Card' },
    './Button.tsx': { Button: 'Button' },
    './NumericField.tsx': { NumericField: 'NumericField' },
  }).mount('TrainingTiming', {
    session,
    revision: [],
    catalog: [{ id: 'press', name_es: 'Press inclinado' }],
  });
  const button = async (label: string) => {
    const found = nodes(await screen.settle()).find(
      (node) =>
        node.type === 'Button' && (node.props.accessibilityLabel ?? node.props.label) === label,
    );
    assert.ok(found, label);
    return found.props;
  };
  const open = async () => {
    (await button('Ver análisis')).onPress();
    return screen.settle();
  };
  return { screen, button, calls, open };
}

test('analysis shows the daily mean, measured intervals and original tap times', async () => {
  const { open } = fixture();
  const text = textOf(await open());
  assert.match(text, /Promedio de 2 días: 3 min\/serie · 9 min\/ejercicio/);
  assert.match(text, /12:03:20/);
  assert.match(text, /2 intervalos válidos/);
  assert.match(text, /Primera serie: falta un inicio medido/);
});

test('excluding and restoring a timestamp refreshes both affected intervals', async () => {
  const { open, button, screen, calls } = fixture();
  await open();
  (await button('Excluir el tiempo de la serie 2')).onPress();
  const excluded = textOf(await screen.settle());
  assert.equal(calls[0].id, 'set-2');
  assert.match(excluded, /El registro anterior se excluyó/);
  assert.match(excluded, /Aún sin tiempo estimable/);
  (await button('Automático')).onPress();
  assert.match(textOf(await screen.settle()), /2 intervalos válidos/);
});

test('failed corrections show an error and retain entered minutes for retry', async () => {
  const { open, button, screen } = fixture(true);
  await open();
  (await button('Corregir el tiempo de la serie 2')).onPress();
  const input = nodes(await screen.settle()).find((node) => node.type === 'NumericField');
  assert.ok(input);
  input.props.onChange('4,5');
  (await button('Guardar minutos')).onPress();
  const tree = await screen.settle();
  assert.match(textOf(tree), /No se pudo guardar el tiempo/);
  assert.equal(nodes(tree).find((node) => node.type === 'NumericField')?.props.value, '4,5');
});
