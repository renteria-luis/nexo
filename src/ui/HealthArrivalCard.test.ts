import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nodes, renderModule, textOf } from './test-render.ts';

const TODAY = '2026-10-09';

function reading(metric: 'sleep' | 'steps', value: number | null, extra: object = {}) {
  return {
    metric,
    source: metric === 'sleep' ? 'autosleep' : 'apple_health',
    date: TODAY,
    value,
    startedAt: null,
    endedAt: null,
    ...extra,
  };
}

function card(arrival: unknown, onAnswer = async (_metric: string, _replace: boolean) => {}) {
  const props = { arrival, today: TODAY, onAnswer, onDismiss() {} };
  return renderModule('src/ui/HealthArrivalCard.tsx', {
    './Button.tsx': { Button: 'Button' },
    './Card.tsx': { Card: 'Card' },
  }).mount('HealthArrivalCard', props);
}

const buttons = (tree: unknown) =>
  nodes(tree)
    .filter((node) => node.type === 'Button')
    .map((node) => node.props.label);

test('saved, empty and replaced values say how much, from where and what was there', async () => {
  const tree = await card({
    id: 1,
    problem: null,
    results: [
      {
        reading: reading('sleep', 465, {
          startedAt: new Date(2026, 9, 8, 23, 40).getTime(),
          endedAt: new Date(2026, 9, 9, 7, 25).getTime(),
        }),
        outcome: 'saved',
        current: null,
      },
      { reading: reading('steps', 9000, { date: '2026-10-08' }), outcome: 'saved', current: 5000 },
    ],
  }).settle();
  const text = textOf(tree);
  assert.ok(text.includes('Llegó del Atajo'), text);
  assert.ok(text.includes('Sueño: 7 h 45 de AutoSleep, de 23:40 a 07:25.'), text);
  assert.ok(text.includes('Pasos del jue 08-oct: 9 000 de Salud. Antes: 5 000.'), text);
  assert.deepEqual(buttons(tree), ['Listo']);

  const empty = await card({
    id: 2,
    problem: null,
    results: [{ reading: reading('steps', null), outcome: 'empty', current: null }],
  }).settle();
  assert.ok(textOf(empty).includes('Pasos: sin datos de Salud, no se cambió nada.'));
});

test('a clash with a value typed by hand asks before closing, and a failed answer says so', async (t) => {
  t.mock.method(console, 'error', () => {});
  const answers: [string, boolean][] = [];
  const conflict = {
    id: 3,
    problem: null,
    results: [{ reading: reading('steps', 9000), outcome: 'conflict', current: 5000 }],
  };
  const view = card(conflict, async (metric, replace) => {
    answers.push([metric, replace]);
    throw new Error('disco lleno');
  });
  let tree = await view.settle();
  assert.ok(textOf(tree).includes('Pasos: anotaste 5 000 a mano y Salud dice 9 000.'));
  assert.deepEqual(buttons(tree), ['Usar Salud', 'Dejar el mío']);
  nodes(tree)
    .find((node) => node.props.label === 'Usar Salud')!
    .props.onPress();
  tree = await view.settle();
  assert.deepEqual(answers, [['steps', true]]);
  assert.ok(textOf(tree).includes('No se pudo guardar: disco lleno'));

  const kept = await card({
    ...conflict,
    results: [{ ...conflict.results[0], outcome: 'kept' }],
  }).settle();
  assert.ok(textOf(kept).includes('Pasos: se quedó el tuyo, 5 000.'));
  assert.deepEqual(buttons(kept), ['Listo']);
});

test('a link that could not be used explains why', async () => {
  const tree = await card({
    id: 4,
    problem: 'Los pasos "muchos" no son un número de pasos.',
    results: [],
  }).settle();
  assert.ok(textOf(tree).includes('El Atajo no se pudo usar'));
  assert.ok(textOf(tree).includes('Los pasos "muchos" no son un número de pasos.'));
  assert.deepEqual(buttons(tree), ['Listo']);
});
