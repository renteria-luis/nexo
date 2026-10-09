import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nodes, renderModule, textOf } from '../test-render.ts';

function fixture(active = false) {
  const app = {
    state: {
      phase: 'ready',
      loaded: {
        today: {
          session: active
            ? {
                id: 'session',
                start_time: Date.now(),
                end_time: null,
                routine_id: 'push',
                crowding: null,
              }
            : null,
          sessionSets: [],
          sessionVolume: 0,
          log: null,
        },
        exercise: { exercises: [], todaySets: [], lastSets: [], marks: null },
        plan: [],
        sessionDraft: null,
        unit: 'lb',
        gyms: [],
        routines: [
          { id: 'push', name: 'Push' },
          { id: 'pull', name: 'Pull' },
        ],
      },
    },
    exerciseId: null,
    selectExercise() {},
    beginSession: async (..._args: unknown[]) => {},
    endSession: async () => {},
    reopenSession: async () => {},
    loadTrainingPlan: async (_id: string) => {},
    saveTrainingPlan: async (_edit: unknown) => {},
  };
  const screen = renderModule('src/ui/screens/TrainingScreen.tsx', {
    '@react-navigation/native': {
      useNavigation: () => ({ navigate() {} }),
      useFocusEffect() {},
      useIsFocused: () => true,
    },
    'expo-screen-orientation': {},
    '../../shell/AppData.tsx': { useAppData: () => app },
    '../SwipeLock.tsx': { useSwipeLock: () => ({ setLocked() {} }) },
    '../icons.ts': { ChevronRight: 'ChevronRight' },
    './Screen.tsx': { Screen: 'Screen' },
    '../Card.tsx': { Card: 'Card' },
    '../Button.tsx': { Button: 'Button' },
    '../Chip.tsx': { Chip: 'Chip' },
    '../SessionPlanner.tsx': {
      SessionPlanner: (props: Record<string, unknown>) => ({
        type: 'SessionPlanner',
        props: { ...props, children: props.startProblem },
      }),
    },
    '../SessionLog.tsx': {
      SessionLog: (props: Record<string, unknown>) => ({
        type: 'SessionLog',
        props: { ...props, children: props.sessionProblem },
      }),
    },
    '../TrainingTiming.tsx': { TrainingTiming: 'TrainingTiming' },
    '../SessionPlanEditor.tsx': { SessionPlanEditor: 'SessionPlanEditor' },
    '../RestLandscape.tsx': { RestLandscape: 'RestLandscape' },
  }).mount('TrainingScreen');
  const component = async (type: string) => {
    const found = nodes(await screen.settle()).find((node) => node.type === type);
    assert.ok(found, type);
    return found.props;
  };
  const button = async (label: string) => {
    const found = nodes(await screen.settle()).find(
      (node) => (node.props.accessibilityLabel ?? node.props.label) === label,
    );
    assert.ok(found, label);
    return found.props;
  };
  return { app, screen, component, button };
}

test('the start handler catches same-render double taps, displays failure and permits a fresh retry', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { app, component, screen } = fixture();
  let reject!: (error: Error) => void;
  let calls = 0;
  app.beginSession = () => {
    calls++;
    return new Promise<void>((_resolve, refuse) => {
      reject = refuse;
    });
  };
  const planner = await component('SessionPlanner');
  planner.onStart('push', 'completo', [], 'alone', 'fanshawe');
  planner.onStart('push', 'completo', [], 'alone', 'fanshawe');
  assert.equal(calls, 1);
  assert.equal((await component('SessionPlanner')).busy, true);
  reject(new Error('storage failure'));
  assert.match(textOf(await screen.settle()), /No se pudo iniciar el entreno/);
  assert.equal((await component('SessionPlanner')).busy, false);
  app.beginSession = async (...args) => {
    calls++;
    assert.equal(args[0], 'pull');
  };
  (await component('SessionPlanner')).onStart('pull', 'completo', [], 'alone', 'fanshawe');
  assert.doesNotMatch(textOf(await screen.settle()), /No se pudo iniciar/);
  assert.equal(calls, 2);
});

test('routine changes open a review without writing, and cancelling preserves the session', async () => {
  const { app, button, component, screen } = fixture(true);
  let saves = 0;
  app.saveTrainingPlan = async () => {
    saves++;
  };
  (await button('Cambiar la rutina de hoy')).onPress();
  (await button('Cambiar a Pull')).onPress();
  const editor = await component('SessionPlanEditor');
  assert.equal(editor.sessionId, 'session');
  assert.equal(editor.routineId, 'pull');
  assert.equal(app.state.loaded.today.session?.routine_id, 'push');
  assert.equal(saves, 0);
  editor.onCancel();
  assert.equal(
    nodes(await screen.settle()).some((node) => node.type === 'SessionPlanEditor'),
    false,
  );
  assert.equal(app.state.loaded.today.session?.routine_id, 'push');
  (await button('Editar lo que falta')).onPress();
  assert.equal((await component('SessionPlanEditor')).routineId, undefined);
});

test('finish and reopen errors appear beside their controls, with retry and pending state', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { app, component, button, screen } = fixture(true);
  let finish = 0;
  app.endSession = async () => {
    finish++;
    if (finish === 1) throw new Error('storage failure');
  };
  (await component('SessionLog')).onFinish();
  assert.match(textOf(await screen.settle()), /No se pudo terminar el entreno/);
  (await button('Reintentar la acción del entreno')).onPress();
  assert.doesNotMatch(textOf(await screen.settle()), /No se pudo terminar/);
  assert.equal(finish, 2);
  let reject!: (error: Error) => void;
  app.reopenSession = () =>
    new Promise<void>((_resolve, refuse) => {
      reject = refuse;
    });
  (await component('SessionLog')).onReopen();
  assert.equal((await component('SessionLog')).sessionAction, 'reopen');
  reject(new Error('storage failure'));
  assert.match(textOf(await screen.settle()), /No se pudo reabrir el entreno/);
  app.reopenSession = async () => {};
  (await component('SessionLog')).onReopen();
  assert.doesNotMatch(textOf(await screen.settle()), /No se pudo reabrir/);
});
