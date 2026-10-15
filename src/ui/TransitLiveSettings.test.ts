import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as realtime from '../transit/realtime.ts';
import { nodes, renderModule, textOf } from './test-render.ts';

const now = Date.UTC(2026, 9, 15, 12);
const health = { status: 'ok', feedTimestamp: now, fetchedAt: now, error: null };
function fixture() {
  const saved: unknown[] = [];
  const props: Record<string, any> = {
    config: { endpoint: 'https://example.test/api/live', credential: 'sample-test-value' },
    error: null,
    active: false,
    state: {
      lastSuccessAt: now,
      loading: false,
      reason: null,
      snapshot: {
        staticCompatible: true,
        generatedAt: now,
        health: { trips: health, vehicles: health },
      },
    },
    onSave: async (config: unknown) => {
      saved.push(config);
    },
    onClear: async () => {},
    onClose() {},
  };
  const screen = renderModule('src/ui/TransitLiveSettings.tsx', {
    '../transit/realtime.ts': realtime,
    './TextField.tsx': { TextField: 'TextField' },
    './IconButton.tsx': { IconButton: 'IconButton' },
    './Button.tsx': { Button: 'Button' },
    './PopupSheet.tsx': { PopupSheet: 'PopupSheet' },
    './icons.ts': { Eye: 'Eye', EyeOff: 'EyeOff', X: 'X' },
    './TransitDepartures.tsx': { useLiveClock: () => now },
  }).mount('TransitLiveSettings', props);
  const field = (tree: unknown) =>
    nodes(tree).find((n) => n.props.accessibilityLabel === 'Clave de conexión Transit')!.props;
  return { props, screen, saved, field };
}

test('saved credentials open masked, can be revealed and are retained when only the URL is edited', async () => {
  const f = fixture();
  let tree = await f.screen.settle();
  assert.equal(f.field(tree).value, f.props.config.credential);
  assert.equal(f.field(tree).secureTextEntry, true);
  nodes(tree)
    .find((n) => n.props.accessibilityLabel === 'Mostrar clave')!
    .props.onPress();
  tree = await f.screen.settle();
  assert.equal(f.field(tree).secureTextEntry, false);
  nodes(tree)
    .find((n) => n.props.accessibilityLabel === 'URL del servicio Transit')!
    .props.onChange('https://example.test/api/updated');
  tree = await f.screen.settle();
  nodes(tree)
    .find((n) => n.props.label === 'Guardar conexión')!
    .props.onPress();
  tree = await f.screen.settle();
  assert.deepEqual(f.saved, [
    { endpoint: 'https://example.test/api/updated', credential: 'sample-test-value' },
  ]);
  assert.equal(f.field(tree).secureTextEntry, true);
});

test('the live indicator follows healthy data, failed connections and expired readings', async () => {
  const f = fixture();
  let tree = await f.screen.settle();
  const labels = (tree: unknown) => nodes(tree).map((n) => n.props.accessibilityLabel);
  assert.ok(labels(tree).includes('En vivo'));
  f.props.state = { ...f.props.state, reason: 'Sin conexión' };
  tree = await f.screen.settle();
  assert.ok(labels(tree).includes('Sin datos en vivo'));
  assert.match(textOf(tree), /Sin conexión/);
  f.props.state = {
    ...f.props.state,
    reason: null,
    snapshot: { ...f.props.state.snapshot, generatedAt: now - 600_000 },
  };
  tree = await f.screen.settle();
  assert.ok(labels(tree).includes('Sin datos en vivo'));
});
