import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SessionPlanEdit } from '../training/session-plan.ts';
import { nodes, renderModule, textOf } from './test-render.ts';

function fixture() {
  const initial: SessionPlanEdit = {
    sessionId: 'session',
    routineId: 'push',
    routineName: null,
    baseline: 'before',
    removedPending: 0,
    exercises: [
      { exerciseId: 'press', sets: 3, position: 1, restSeconds: 180 },
      { exerciseId: 'peck', sets: 4, position: 2, restSeconds: 120 },
    ],
    done: [{ exerciseId: 'press', sets: 1 }],
  };
  const saved: SessionPlanEdit[] = [];
  const actions = {
    load: async () => initial,
    save: async (edit: SessionPlanEdit) => {
      saved.push(edit);
    },
  };
  let applied = 0;
  let cancelled = 0;
  const screen = renderModule('src/ui/SessionPlanEditor.tsx', {
    './Card.tsx': { Card: 'Card' },
    './Button.tsx': { Button: 'Button' },
    './SearchField.tsx': { SearchField: 'SearchField' },
  }).mount('SessionPlanEditor', {
    sessionId: 'session',
    catalog: [
      { id: 'press', name_es: 'Press', default_rest_seconds: 180 },
      { id: 'peck', name_es: 'Pec deck', default_rest_seconds: 120 },
      { id: 'pull', name_es: 'Dominadas', default_rest_seconds: 180 },
    ],
    onLoad: () => actions.load(),
    onSave: (edit: SessionPlanEdit) => actions.save(edit),
    onApplied: () => {
      applied++;
    },
    onCancel: () => {
      cancelled++;
    },
  });
  const button = async (label: string) => {
    const found = nodes(await screen.settle()).find(
      (node) =>
        node.type === 'Button' && (node.props.accessibilityLabel ?? node.props.label) === label,
    );
    assert.ok(found, label);
    return found.props;
  };
  return {
    screen,
    initial,
    actions,
    saved,
    button,
    applied: () => applied,
    cancelled: () => cancelled,
  };
}

test('replacement moves only pending sets, keeps completed sets and preserves the original draft until saving', async () => {
  const { screen, button, initial, saved } = fixture();
  (await button('Cambiar ejercicio Press')).onPress();
  (await button('Elegir Dominadas para el plan')).onPress();
  assert.match(textOf(await screen.settle()), /1 hechas · 0 pendientes/);
  assert.match(textOf(await screen.settle()), /0 hechas · 2 pendientes/);
  assert.equal(saved.length, 0);
  assert.equal(initial.exercises.length, 2);
  (await button('Guardar plan')).onPress();
  await screen.settle();
  assert.deepEqual(
    saved[0].exercises.map((entry) => [entry.exerciseId, entry.sets]),
    [
      ['press', 1],
      ['pull', 2],
      ['peck', 4],
    ],
  );
});

test('adding, merging a replacement, omitting and reordering persist the reviewed counts', async () => {
  const { screen, button, saved } = fixture();
  (await button('Cambiar ejercicio Press')).onPress();
  (await button('Elegir Pec deck para el plan')).onPress();
  (await button('Añadir ejercicio')).onPress();
  (await button('Elegir Dominadas para el plan')).onPress();
  (await button('Quitar una serie pendiente de Dominadas')).onPress();
  (await button('Subir Dominadas')).onPress();
  (await button('Omitir pendientes de Pec deck')).onPress();
  assert.equal((await button('Quitar una serie pendiente de Press')).disabled, true);
  (await button('Guardar plan')).onPress();
  await screen.settle();
  assert.deepEqual(
    saved[0].exercises.map((entry) => [entry.exerciseId, entry.sets, entry.position]),
    [
      ['press', 1, 1],
      ['pull', 2, 2],
    ],
  );
});

test('failed writes retain edits for retry and same-render duplicate saves run once', async () => {
  const { actions, button, screen, applied, saved } = fixture();
  let reject!: (error: Error) => void;
  let calls = 0;
  actions.save = async () => {
    calls++;
    await new Promise<void>((_, refuse) => {
      reject = refuse;
    });
  };
  (await button('Añadir una serie pendiente a Press')).onPress();
  const save = await button('Guardar plan');
  save.onPress();
  save.onPress();
  assert.equal(calls, 1);
  assert.equal((await button('Cancelar cambios')).disabled, true);
  reject(new Error('Storage unavailable'));
  assert.match(textOf(await screen.settle()), /Storage unavailable/);
  assert.match(textOf(await screen.settle()), /1 hechas · 3 pendientes/);
  assert.equal(applied(), 0);
  actions.save = async (edit) => {
    saved.push(edit);
  };
  (await button('Reintentar guardar plan')).onPress();
  await screen.settle();
  assert.equal(saved[0].exercises[0].sets, 4);
  assert.equal(applied(), 1);
});

test('load failure can retry and cancelling never saves the draft', async () => {
  const { actions, button, screen, saved, initial, cancelled } = fixture();
  actions.load = async () => {
    throw new Error('Read failed');
  };
  assert.match(textOf(await screen.settle()), /Read failed/);
  assert.equal((await button('Guardar plan')).disabled, true);
  actions.load = async () => initial;
  (await button('Reintentar carga')).onPress();
  (await button('Omitir pendientes de Pec deck')).onPress();
  (await button('Cancelar cambios')).onPress();
  assert.equal(cancelled(), 1);
  assert.equal(saved.length, 0);
});
