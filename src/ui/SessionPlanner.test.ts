import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clockFace } from '../training/pace.ts';
import { freshPlannerDraft, type PlannerDraft } from '../training/planner-draft.ts';

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
    './IconButton.tsx': { IconButton: 'IconButton' },
    './icons.ts': Object.fromEntries(
      ['Dumbbell', 'GripLines', 'MapPin', 'Moon', 'Navigation', 'Play', 'Timer', 'Users'].map(
        (name) => [name, name],
      ),
    ),
  }).mount('SessionPlanner', {
    routines: [{ id: 'push', name: 'Push' }],
    gyms: [],
    draft: freshPlannerDraft('2026-10-09'),
    onSaveDraft: async () => {},
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

test('start stays disabled while saving or while the selected gym plan is still loading', async () => {
  const exercises = [
    {
      exerciseId: 'press',
      name: 'Press',
      unilateral: false,
      position: 1,
      tier: 1,
      sets: 3,
      repMode: 'range',
      repMin: 8,
      repMax: 12,
      restSeconds: 180,
    },
  ];
  const calls: unknown[][] = [];
  let resolvePlan!: (value: unknown) => void;
  const props = {
    routines: [{ id: 'push', name: 'Push' }],
    gyms: [{ id: 'fanshawe', name: 'Fanshawe' }],
    draft: freshPlannerDraft('2026-10-09'),
    onSaveDraft: async () => {},
    onLoadOwedRoutine: async () => 'push',
    onLoadPlan: async (_routine: string, _budget: string, gymId: string | null) =>
      gymId === null
        ? { exercises, usualMinutes: null }
        : new Promise((resolve) => {
            resolvePlan = resolve;
          }),
    onLocate: async () => ({ kind: 'unavailable' }),
    onStart: (...args: unknown[]) => {
      calls.push(args);
    },
    restDay: false,
    onRestDay() {},
    onDragging() {},
    busy: false,
    startProblem: null as string | null,
  };
  const planner = renderModule('src/ui/SessionPlanner.tsx', {
    './Button.tsx': { Button: 'Button' },
    './Card.tsx': { Card: 'Card' },
    './Chip.tsx': { Chip: 'Chip' },
    './InfoBubble.tsx': { ConfirmAction: 'ConfirmAction' },
    './IconButton.tsx': { IconButton: 'IconButton' },
    './icons.ts': Object.fromEntries(
      ['Dumbbell', 'GripLines', 'MapPin', 'Moon', 'Navigation', 'Play', 'Timer', 'Users'].map(
        (name) => [name, name],
      ),
    ),
  }).mount('SessionPlanner', props);
  let tree = await planner.settle();
  const start = () =>
    nodes(tree).find(
      (node) =>
        node.type === 'Button' &&
        node.props.accessibilityLabel ===
          (props.startProblem ? 'Reintentar inicio del entreno' : 'Empezar entreno'),
    )!.props;
  nodes(tree)
    .find((node) => node.props.accessibilityLabel === 'Gimnasio Fanshawe')!
    .props.onPress();
  tree = await planner.settle();
  assert.equal(start().disabled, true);
  start().onPress();
  assert.equal(calls.length, 0);
  resolvePlan({ exercises, usualMinutes: null });
  tree = await planner.settle();
  assert.equal(start().disabled, false);
  props.busy = true;
  tree = planner.render();
  assert.equal(start().loading, true);
  start().onPress();
  assert.equal(calls.length, 0);
  props.busy = false;
  props.startProblem = 'No se pudo iniciar el entreno.';
  tree = planner.render();
  nodes(tree)
    .find((node) => node.props.accessibilityLabel === 'Una serie menos de Press')!
    .props.onPress();
  tree = planner.render();
  start().onPress();
  assert.equal(calls.length, 1);
  assert.equal((calls[0][2] as { sets: number }[])[0].sets, 2);
  assert.equal(calls[0][4], 'fanshawe');
});

function plannerWith(props: Record<string, unknown>) {
  return renderModule('src/ui/SessionPlanner.tsx', {
    './Button.tsx': { Button: 'Button' },
    './Card.tsx': { Card: 'Card' },
    './Chip.tsx': { Chip: 'Chip' },
    './InfoBubble.tsx': { ConfirmAction: 'ConfirmAction' },
    './IconButton.tsx': { IconButton: 'IconButton' },
    './icons.ts': Object.fromEntries(
      ['Dumbbell', 'GripLines', 'MapPin', 'Moon', 'Navigation', 'Play', 'Timer', 'Users'].map(
        (name) => [name, name],
      ),
    ),
  }).mount(
    'SessionPlanner',
    // The same object the test holds, so changing a prop reaches the next render.
    Object.assign(props, {
      routines: [
        { id: 'pull', name: 'Pull' },
        { id: 'legs', name: 'Legs' },
      ],
      gyms: [
        { id: 'fanshawe', name: 'Fanshawe' },
        { id: 'fit4less', name: 'Fit4Less' },
        { id: 'otro', name: 'Otro' },
      ],
      onLoadOwedRoutine: async () => 'pull',
      onLoadPlan: async (routineId: string) => ({
        exercises: (routineId === 'legs' ? ['hack', 'curl'] : ['row']).map((id, index) => ({
          exerciseId: id,
          name: id,
          unilateral: false,
          position: index + 1,
          tier: 1,
          sets: 3,
          repMode: 'range',
          repMin: 8,
          repMax: 12,
          restSeconds: 120,
        })),
        usualMinutes: null,
      }),
      onLocate: async () => ({ kind: 'elsewhere' }),
      visible: false,
      onStart() {},
      restDay: false,
      onRestDay() {},
      onDragging() {},
      ...props,
    }),
  );
}

const press = (tree: unknown, label: string) =>
  nodes(tree)
    .find((node) => (node.props.accessibilityLabel ?? node.props.label) === label)!
    .props.onPress();

test('Solo starts selected and stays selected when tapped again', async () => {
  const saves: PlannerDraft[] = [];
  const calls: unknown[][] = [];
  const planner = plannerWith({
    draft: freshPlannerDraft('2026-10-09', 'fanshawe'),
    onSaveDraft: async (draft: PlannerDraft) => {
      saves.push(draft);
    },
    onStart: (...args: unknown[]) => calls.push(args),
  });
  let tree = await planner.settle();
  const solo = () => nodes(tree).find((node) => node.props.label === 'Solo')!.props;
  assert.equal(solo().selected, true);
  solo().onPress();
  tree = await planner.settle();
  assert.equal(solo().selected, true);
  assert.equal(saves.length, 0);
  press(tree, 'Empezar entreno');
  assert.equal(calls[0][3], 'alone');
});

test('a manual routine, gym, budget and edited plan come back after reopening', async () => {
  const saves: PlannerDraft[] = [];
  const first = plannerWith({
    draft: freshPlannerDraft('2026-10-09'),
    onSaveDraft: async (draft: PlannerDraft) => {
      saves.push(draft);
    },
  });
  let tree = await first.settle();
  assert.equal(saves.length, 0);
  press(tree, 'Gimnasio Fit4Less');
  tree = await first.settle();
  press(tree, 'Rutina Legs');
  tree = await first.settle();
  press(tree, 'Tiempo −25%');
  tree = await first.settle();
  press(tree, 'Acompañado');
  tree = await first.settle();
  press(tree, 'Una serie menos de curl');
  tree = await first.settle();

  const last = saves.at(-1)!;
  assert.equal(last.routineId, 'legs');
  assert.equal(last.gymId, 'fit4less');
  assert.equal(last.budget, 'minus_25');
  assert.equal(last.company, 'with_someone');
  assert.deepEqual(
    last.edits?.exercises.map((exercise) => [exercise.exerciseId, exercise.sets]),
    [
      ['hack', 3],
      ['curl', 2],
    ],
  );

  const writes = saves.length;
  const calls: unknown[][] = [];
  const again = plannerWith({
    draft: last,
    onSaveDraft: async (draft: PlannerDraft) => {
      saves.push(draft);
    },
    onStart: (...args: unknown[]) => calls.push(args),
  });
  tree = await again.settle();
  assert.equal(saves.length, writes);
  const chip = (label: string) => nodes(tree).find((node) => node.props.label === label)!.props;
  assert.equal(chip('Legs').selected, true);
  assert.equal(chip('Pull').selected, false);
  assert.equal(chip('Fit4Less').selected, true);
  assert.equal(chip('Acompañado').selected, true);
  press(tree, 'Empezar entreno');
  assert.deepEqual(calls[0].slice(0, 2), ['legs', 'minus_25']);
  assert.deepEqual(
    (calls[0][2] as { exerciseId: string; sets: number }[]).map((item) => [
      item.exerciseId,
      item.sets,
    ]),
    [
      ['hack', 3],
      ['curl', 2],
    ],
  );
  assert.equal(calls[0][4], 'fit4less');
});

test('a routine that no longer exists is dropped visibly for the owed one', async () => {
  const planner = plannerWith({
    draft: { ...freshPlannerDraft('2026-10-09', 'fanshawe'), routineId: 'gone' },
    onSaveDraft: async () => {},
  });
  const tree = await planner.settle();
  assert.ok(textOf(tree).includes('La rutina que habías elegido ya no está'));
  assert.equal(nodes(tree).find((node) => node.props.label === 'Pull')!.props.selected, true);
});

test('edits that no longer match the plan are dropped with a notice', async () => {
  const planner = plannerWith({
    draft: {
      ...freshPlannerDraft('2026-10-09', 'fanshawe'),
      edits: {
        plan: JSON.stringify(['pull', 'completo', 'fanshawe']),
        exercises: [{ exerciseId: 'pulldown', sets: 1, position: 1 }],
      },
    },
    onSaveDraft: async () => {},
  });
  const tree = await planner.settle();
  assert.ok(textOf(tree).includes('El plan cambió desde que lo ajustaste'));
  assert.ok(textOf(tree).includes('row'));
});

test('a failed save says so, and the next successful one clears it', async (t) => {
  t.mock.method(console, 'error', () => {});
  let fail = true;
  const planner = plannerWith({
    draft: freshPlannerDraft('2026-10-09'),
    onSaveDraft: async () => {
      if (fail) throw new Error('disco lleno');
    },
  });
  let tree = await planner.settle();
  press(tree, 'Gimnasio Fanshawe');
  tree = await planner.settle();
  assert.ok(textOf(tree).includes('No se guardó lo elegido: disco lleno'));
  fail = false;
  press(tree, 'Gimnasio Fit4Less');
  tree = await planner.settle();
  assert.ok(!textOf(tree).includes('No se guardó lo elegido'));
});

const FIT4LESS_MATCH = {
  kind: 'match',
  fix: { gym: { id: 'fit4less', name: 'Fit4Less' }, distanceM: 42.4 },
};

const selectedGym = (tree: unknown) =>
  nodes(tree)
    .filter((node) => String(node.props.accessibilityLabel).startsWith('Gimnasio '))
    .filter((node) => node.props.selected)
    .map((node) => node.props.accessibilityLabel);

test('entering the tab reads the gym once, after a short dwell, without asking for anything', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const modes: string[] = [];
  const props = {
    draft: freshPlannerDraft('2026-10-09', 'fanshawe'),
    onSaveDraft: async () => {},
    visible: true,
    onLocate: async (mode: string) => {
      modes.push(mode);
      return FIT4LESS_MATCH;
    },
  };
  const planner = plannerWith(props);
  let tree = await planner.settle();
  t.mock.timers.tick(399);
  assert.deepEqual(modes, []);
  t.mock.timers.tick(1);
  tree = await planner.settle();
  assert.deepEqual(modes, ['auto']);
  assert.deepEqual(selectedGym(tree), ['Gimnasio Fit4Less']);
  assert.ok(textOf(tree).includes('Fit4Less, a 42 m'));
});

test('passing through the tab or finding no gym changes nothing and says nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const modes: string[] = [];
  const props: Record<string, unknown> = {
    draft: freshPlannerDraft('2026-10-09', 'fanshawe'),
    onSaveDraft: async () => {},
    visible: true,
    onLocate: async (mode: string) => {
      modes.push(mode);
      return { kind: 'elsewhere' };
    },
  };
  const planner = plannerWith(props);
  await planner.settle();
  t.mock.timers.tick(200);
  props.visible = false;
  await planner.settle();
  t.mock.timers.tick(1000);
  assert.deepEqual(modes, []);

  props.visible = true;
  await planner.settle();
  t.mock.timers.tick(400);
  const tree = await planner.settle();
  assert.deepEqual(modes, ['auto']);
  assert.deepEqual(selectedGym(tree), ['Gimnasio Fanshawe']);
  assert.ok(!textOf(tree).includes('No estás'));
});

test('a late answer never overrides a gym tapped meanwhile or arrives after leaving', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let answer!: (value: unknown) => void;
  const props: Record<string, unknown> = {
    draft: freshPlannerDraft('2026-10-09', 'fanshawe'),
    onSaveDraft: async () => {},
    visible: true,
    onLocate: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  };
  const planner = plannerWith(props);
  let tree = await planner.settle();
  t.mock.timers.tick(400);
  tree = await planner.settle();
  // Searching on its own shows nothing on the arrow.
  assert.equal(nodes(tree).find((node) => node.type === 'IconButton')!.props.style[1], false);
  press(tree, 'Gimnasio Otro');
  answer(FIT4LESS_MATCH);
  tree = await planner.settle();
  assert.deepEqual(selectedGym(tree), ['Gimnasio Otro']);

  press(tree, 'Usar mi ubicación');
  props.visible = false;
  tree = await planner.settle();
  answer(FIT4LESS_MATCH);
  tree = await planner.settle();
  assert.deepEqual(selectedGym(tree), ['Gimnasio Otro']);
});

test('the arrow reports every outcome, keeps the gym, and gives up waiting after a while', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const outcomes: unknown[] = [{ kind: 'elsewhere' }, { kind: 'unsure' }, { kind: 'denied' }];
  let answer!: (value: unknown) => void;
  const planner = plannerWith({
    draft: freshPlannerDraft('2026-10-09', 'fanshawe'),
    onSaveDraft: async () => {},
    onLocate: (mode: string) => {
      assert.equal(mode, 'manual');
      const next = outcomes.shift();
      return next ? Promise.resolve(next) : new Promise((resolve) => (answer = resolve));
    },
  });
  let tree = await planner.settle();
  const notes: string[] = [];
  for (let i = 0; i < 3; i++) {
    press(tree, 'Usar mi ubicación');
    tree = await planner.settle();
    notes.push(textOf(tree));
  }
  assert.ok(notes[0].includes('No estás en ninguno de los gimnasios guardados.'));
  assert.ok(notes[1].includes('no es lo bastante precisa'));
  assert.ok(notes[2].includes('Sin permiso de ubicación.'));
  assert.deepEqual(selectedGym(tree), ['Gimnasio Fanshawe']);

  press(tree, 'Usar mi ubicación');
  tree = await planner.settle();
  const arrow = () => nodes(tree).find((node) => node.type === 'IconButton')!.props;
  assert.ok(arrow().style[1], 'sunk while it waits');
  t.mock.timers.tick(20_000);
  tree = await planner.settle();
  assert.equal(arrow().style[1], false);
  assert.ok(textOf(tree).includes('no llegó a tiempo'));
  answer(FIT4LESS_MATCH);
  tree = await planner.settle();
  assert.deepEqual(selectedGym(tree), ['Gimnasio Fanshawe']);
});

test('gym chips use the short name, unless two would read the same', async () => {
  const planner = plannerWith({
    draft: freshPlannerDraft('2026-10-09'),
    onSaveDraft: async () => {},
    gyms: [
      { id: 'fanshawe', name: 'Fanshawe' },
      { id: 'proudfoot', name: 'Fit4Less Proudfoot' },
      { id: 'oxford', name: 'Fit4Less Oxford' },
      { id: 'west', name: 'Goodlife West' },
    ],
  });
  const tree = await planner.settle();
  assert.deepEqual(
    nodes(tree)
      .filter((node) => String(node.props.accessibilityLabel).startsWith('Gimnasio '))
      .map((node) => node.props.label),
    ['Fanshawe', 'Fit4Less Proudfoot', 'Fit4Less Oxford', 'Goodlife'],
  );
});
