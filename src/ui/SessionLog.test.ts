import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodes, renderModule, textOf } from './test-render.ts';

test('a family appears once, variant failures keep the original choice, and saving blocks new sets', async () => {
  const exercises = ['dumbbell', 'cable', 'machine'].map((equipment_type) => ({
    id: equipment_type,
    name_es: `Laterales ${equipment_type}`,
    familyId: 'laterals',
    familyName: 'Laterales',
    equipment_type,
    unilateral: equipment_type === 'cable' ? 1 : 0,
    default_rest_seconds: 120,
    notes: new Map(),
    equipment: null,
    implements: [],
    muscles: [],
  }));
  let reject!: (error: Error) => void;
  let calls = 0;
  const screen = renderModule('src/ui/SessionLog.tsx', {
    './Button.tsx': { Button: 'Button' },
    './Card.tsx': { Card: 'Card' },
    './Chip.tsx': { Chip: 'Chip' },
    './SearchField.tsx': { SearchField: 'SearchField' },
    './NumericField.tsx': { NumericField: 'NumericField' },
    './Elapsed.tsx': { clock: () => '2:00', Elapsed: 'Elapsed' },
    './icons.ts': {
      Check: 'Check',
      Circle: 'Circle',
      Minus: 'Minus',
      Plus: 'Plus',
      Trash: 'Trash',
    },
    './InfoBubble.tsx': {
      InfoDot: 'InfoDot',
      InfoText: 'InfoText',
      ConfirmButton: 'ConfirmButton',
    },
  }).mount('SessionLog', {
    exercises,
    selectedExerciseId: 'cable',
    onSelectExercise() {},
    onSelectVariant: () => {
      calls++;
      return new Promise<void>((_, refuse) => {
        reject = refuse;
      });
    },
    todaySets: [],
    lastSets: [],
    restingSince: null,
    plan: [],
    marks: null,
    sessionVolume: 0,
    unit: 'kg',
    onChangeUnit() {},
    plannedSets: 3,
    planExerciseIds: ['cable'],
    setsDoneByExercise: new Map(),
    plannedByExercise: new Map([['cable', 3]]),
    onAddSet: async () => {},
    onRemoveSet() {},
    startedAt: 1,
    draft: null,
    onDraftChange() {},
    finishedAt: null,
    onFinish() {},
    onReopen() {},
  });
  const tree = await screen.settle();
  assert.equal(
    nodes(tree).filter(
      (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Laterales',
    ).length,
    1,
  );
  const chip = nodes(tree).find(
    (node) => node.type === 'Chip' && node.props.label === 'Mancuernas',
  )!;
  chip.props.onPress();
  chip.props.onPress();
  assert.equal(calls, 1);
  assert.match(textOf(await screen.settle()), /Cambiando variante/);
  reject(new Error('storage failure'));
  assert.match(textOf(await screen.settle()), /storage failure/);
  chip.props.onPress();
  assert.equal(calls, 2);
  reject(new Error('retry failure'));
  await screen.settle();
});
