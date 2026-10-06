import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nodes, renderModule, textOf } from './test-render.ts';

function fixture(fail = false) {
  const writes: unknown[] = [];
  let clears = 0;
  const configured = { provider: 'groq', hasGroq: true, hasTavily: true };
  const screen = renderModule('src/ui/AssistantSettings.tsx', {
    '../shell/assistant-credentials.ts': {
      assistantCredentialStatus: async () => configured,
      saveAssistantCredentials: async (value: unknown) => {
        if (fail) throw new Error('No pude guardar las claves.');
        writes.push(value);
        return configured;
      },
      clearAssistantCredentials: async () => {
        clears++;
        return { provider: 'apple', hasGroq: false, hasTavily: false };
      },
      importAssistantCredentials: async () => configured,
    },
    './TextField.tsx': { TextField: 'TextField' },
    './Card.tsx': { Card: 'Card' },
    './Chip.tsx': { Chip: 'Chip' },
    './Button.tsx': { Button: 'Button' },
  }).mount('AssistantSettings');
  return { screen, writes, clears: () => clears };
}

test('credential settings mask new input, never display saved keys and clear successful drafts', async () => {
  const { screen, writes } = fixture();
  let tree = await screen.settle();
  const input = nodes(tree).find((node) => node.props.accessibilityLabel === 'Clave de Groq')!;
  assert.equal(input.props.secureTextEntry, true);
  assert.equal(input.props.value, '');
  input.props.onChange('fake-replacement-groq');
  tree = screen.render();
  await nodes(tree)
    .find((node) => node.props.accessibilityLabel === 'Guardar configuración del asistente')!
    .props.onPress();
  tree = await screen.settle();
  assert.deepEqual(writes, [{ provider: 'groq', groqApiKey: 'fake-replacement-groq' }]);
  assert.equal(
    nodes(tree).find((node) => node.props.accessibilityLabel === 'Clave de Groq')!.props.value,
    '',
  );
  assert.match(textOf(tree), /Configuración guardada/);
});

test('failed credential saves retain the draft and never announce success', async () => {
  const { screen, writes } = fixture(true);
  let tree = await screen.settle();
  nodes(tree)
    .find((node) => node.props.accessibilityLabel === 'Clave de Groq')!
    .props.onChange('fake-replacement-groq');
  tree = screen.render();
  await nodes(tree)
    .find((node) => node.props.accessibilityLabel === 'Guardar configuración del asistente')!
    .props.onPress();
  tree = await screen.settle();
  assert.equal(writes.length, 0);
  assert.equal(
    nodes(tree).find((node) => node.props.accessibilityLabel === 'Clave de Groq')!.props.value,
    'fake-replacement-groq',
  );
  assert.doesNotMatch(textOf(tree), /Configuración guardada/);
  assert.match(textOf(tree), /No pude guardar/);
});

test('removing credentials requires confirmation and cancellation keeps them', async () => {
  const { screen, clears } = fixture();
  let tree = await screen.settle();
  nodes(tree)
    .find((node) => node.props.label === 'Borrar claves guardadas')!
    .props.onPress();
  tree = screen.render();
  assert.equal(clears(), 0);
  nodes(tree)
    .find((node) => node.props.label === 'Cancelar')!
    .props.onPress();
  tree = screen.render();
  assert.equal(clears(), 0);
  nodes(tree)
    .find((node) => node.props.label === 'Borrar claves guardadas')!
    .props.onPress();
  tree = screen.render();
  await nodes(tree)
    .find((node) => node.props.label === 'Sí, borrar claves')!
    .props.onPress();
  await screen.settle();
  assert.equal(clears(), 1);
});
