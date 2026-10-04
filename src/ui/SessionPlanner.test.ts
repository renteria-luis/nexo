import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clockFace } from '../training/pace.ts';

import { nodes, renderModule, textOf } from './test-render.ts';

test('the displayed plan includes both arms and follows overrides and removed exercises', async () => {
  const exercises = [
    {
      exerciseId: 'one-arm',
      name: 'Elevación',
      unilateral: true,
      position: 1,
      tier: 3,
      sets: 3,
      repMode: 'range',
      repMin: 12,
      repMax: 15,
      restSeconds: 90,
    },
    {
      exerciseId: 'press',
      name: 'Press',
      unilateral: false,
      position: 2,
      tier: 1,
      sets: 2,
      repMode: 'range',
      repMin: 8,
      repMax: 12,
      restSeconds: 120,
    },
  ];
  const planner = renderModule('src/ui/SessionPlanner.tsx', {
    './Button.tsx': { Button: 'Button' },
    './Card.tsx': { Card: 'Card' },
    './Chip.tsx': { Chip: 'Chip' },
    './InfoBubble.tsx': { ConfirmAction: 'ConfirmAction' },
    './icons.ts': Object.fromEntries(
      ['Dumbbell', 'GripLines', 'MapPin', 'Moon', 'Play', 'Timer', 'Users'].map((name) => [
        name,
        name,
      ]),
    ),
  }).mount('SessionPlanner', {
    routines: [{ id: 'push', name: 'Push' }],
    gyms: [],
    onLoadOwedRoutine: async () => 'push',
    onLoadPlan: async () => ({ exercises, usualMinutes: null }),
    onLocate: async () => ({ kind: 'unavailable' }),
    onStart() {},
    restDay: false,
    onRestDay() {},
    onDragging() {},
  });
  let tree = await planner.settle();
  const check = (count: number, seconds: number) =>
    assert.ok(textOf(tree).includes(`${count} ejercicios · ${clockFace(seconds / 60)} de plan`));
  check(2, 300 + 3 * (90 + 90) + 2 * (45 + 120) + 120);
  const fewer = (name: string) => {
    nodes(tree)
      .find((node) => node.props.accessibilityLabel === `Una serie menos de ${name}`)!
      .props.onPress();
    tree = planner.render();
  };
  fewer('Elevación');
  check(2, 300 + 2 * (90 + 90) + 2 * (45 + 120) + 120);
  fewer('Elevación');
  fewer('Elevación');
  check(1, 300 + 2 * (45 + 120) + 60);
  fewer('Press');
  fewer('Press');
  check(0, 0);
  assert.equal(
    nodes(tree).find((node) => node.type === 'Button' && node.props.label === 'Empezar entreno')!
      .props.disabled,
    true,
  );
});
