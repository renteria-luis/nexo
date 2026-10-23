import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodes, renderModule, textOf } from './test-render.ts';

const MOCKS = {
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
  './screens/Screen.tsx': { useScrollIntoView: () => () => {} },
};

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
  const screen = renderModule('src/ui/SessionLog.tsx', MOCKS).mount('SessionLog', {
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
    records: null,
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

test('the estimated 1RM of a dumbbell says it is one dumbbell, like the sets above it', async () => {
  const set = {
    sessionId: 'past',
    date: '2026-10-01',
    exerciseId: 'hammer',
    setIndex: 1,
    weightKg: 11.34,
    reps: 10,
    loadFactor: 2,
  };
  const tree = await renderModule('src/ui/SessionLog.tsx', MOCKS)
    .mount('SessionLog', {
      exercises: [
        {
          id: 'hammer',
          name_es: 'Curl martillo · mancuernas',
          familyId: 'hammer',
          familyName: 'Curl martillo',
          equipment_type: 'dumbbell',
          unilateral: 0,
          default_rest_seconds: 120,
          notes: new Map(),
          equipment: null,
          implements: [],
          muscles: [],
        },
      ],
      selectedExerciseId: 'hammer',
      onSelectExercise() {},
      onSelectVariant: async () => {},
      todaySets: [],
      lastSets: [set],
      restingSince: null,
      plan: [],
      marks: { best: { set, e1rm: 15.12 }, worst: { set, e1rm: 15.12 } },
      sessionVolume: 0,
      unit: 'kg',
      onChangeUnit() {},
      plannedSets: 3,
      planExerciseIds: ['hammer'],
      setsDoneByExercise: new Map(),
      plannedByExercise: new Map([['hammer', 3]]),
      onAddSet: async () => {},
      onRemoveSet() {},
      startedAt: 1,
      draft: null,
      onDraftChange() {},
      finishedAt: null,
      records: null,
      onFinish() {},
      onReopen() {},
    })
    .settle();
  assert.match(textOf(tree), /11\.34 kg c\/u/);
  assert.match(textOf(tree), /1RM estimado · mejor 15 · peor 15 kg c\/u · 8 semanas/);
});

test('a finished session shows its recap with records and nothing left to log', async () => {
  const exercise = {
    id: 'press',
    name_es: 'Press inclinado con mancuernas',
    familyId: 'press',
    familyName: 'Press inclinado',
    equipment_type: 'dumbbell',
    unilateral: 0,
    default_rest_seconds: 180,
    notes: new Map(),
    equipment: null,
    implements: [],
    muscles: [],
  };
  const set = (weightKg: number) => ({
    sessionId: 'today',
    date: '2026-10-23',
    exerciseId: 'press',
    setIndex: 1,
    weightKg,
    reps: 8,
    loadFactor: 2,
  });
  const props = {
    exercises: [exercise],
    selectedExerciseId: 'press',
    onSelectExercise() {},
    onSelectVariant: async () => {},
    todaySets: [set(40.82)],
    lastSets: [],
    restingSince: 1,
    plan: [],
    marks: null,
    sessionVolume: 1306.24,
    unit: 'lb',
    onChangeUnit() {},
    plannedSets: 3,
    planExerciseIds: ['press'],
    setsDoneByExercise: new Map([['press', 3]]),
    plannedByExercise: new Map([['press', 3]]),
    onAddSet: async () => {},
    onRemoveSet() {},
    startedAt: 0,
    draft: null,
    onDraftChange() {},
    finishedAt: 72 * 60_000,
    records: [
      {
        exerciseId: 'press',
        now: { set: set(40.82), e1rm: 51.7 },
        before: { set: set(38.56), e1rm: 48.8 },
      },
    ],
    onFinish() {},
    onReopen() {},
  };
  const tree = await renderModule('src/ui/SessionLog.tsx', MOCKS)
    .mount('SessionLog', props)
    .settle();
  const text = textOf(tree);
  assert.match(text, /VOLUMEN.*2 880 lb/);
  assert.match(text, /SERIES.*3/);
  assert.match(text, /DURÓ01h12m/);
  assert.match(text, /RÉCORDS.*1/);
  assert.match(text, /Press inclinado con mancuernas · 1RM 114 · antes 108 lb c\/u/);
  assert.doesNotMatch(text, /DESCANSANDO|Terminar entreno/);
  assert.equal(
    nodes(tree).filter((node) => node.props.accessibilityLabel === 'Agregar serie').length,
    0,
  );
});

test('logged sets sit under the set button, so it does not move as they are added', async () => {
  const exercise = {
    id: 'curl',
    name_es: 'Curl',
    familyId: 'curl',
    familyName: 'Curl',
    equipment_type: 'cable',
    unilateral: 0,
    default_rest_seconds: 120,
    notes: new Map(),
    equipment: null,
    implements: [],
    muscles: [],
  };
  const tree = await renderModule('src/ui/SessionLog.tsx', MOCKS)
    .mount('SessionLog', {
      exercises: [exercise],
      selectedExerciseId: 'curl',
      onSelectExercise() {},
      onSelectVariant: async () => {},
      todaySets: [
        {
          sessionId: 's',
          date: '2026-10-23',
          exerciseId: 'curl',
          setIndex: 1,
          weightKg: 20,
          reps: 10,
        },
      ],
      lastSets: [],
      restingSince: null,
      plan: [],
      marks: null,
      sessionVolume: 200,
      unit: 'kg',
      onChangeUnit() {},
      plannedSets: 3,
      planExerciseIds: ['curl'],
      setsDoneByExercise: new Map([['curl', 1]]),
      plannedByExercise: new Map([['curl', 3]]),
      onAddSet: async () => {},
      onRemoveSet() {},
      startedAt: 1,
      draft: null,
      onDraftChange() {},
      finishedAt: null,
      records: null,
      onFinish() {},
      onReopen() {},
    })
    .settle();
  const order = nodes(tree).map((node) => node.props.accessibilityLabel);
  assert.ok(order.indexOf('Agregar serie') < order.indexOf('Quitar serie 1'));
  assert.match(textOf(tree), /DESCANSO SUGERIDO/);
});
