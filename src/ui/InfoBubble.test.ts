import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodes, renderModule, textOf } from './test-render.ts';

test('Android Back closes help before navigation and releases the handler after closing', async () => {
  const listeners = new Map<string, () => boolean>();
  const screen = renderModule('src/ui/InfoBubble.tsx', {
    'react-native': {
      View: 'View',
      Text: 'Text',
      Pressable: 'Pressable',
      ScrollView: 'ScrollView',
      StyleSheet: { absoluteFill: {} },
      Platform: { OS: 'android' },
      useWindowDimensions: () => ({ width: 400, height: 800 }),
      Keyboard: { addListener: () => ({ remove() {} }) },
      BackHandler: {
        addEventListener: (name: string, action: () => boolean) => {
          listeners.set(name, action);
          return { remove: () => listeners.delete(name) };
        },
      },
    },
    'react-native-safe-area-context': {
      useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
    },
    './Button.tsx': { Button: 'Button' },
    './IconButton.tsx': { IconButton: 'IconButton' },
    './theme.ts': {
      font: {},
      glass: { panel: {} },
      shape: {},
      sheet: (make: (theme: unknown) => unknown) => make({}),
    },
  }).mount('InfoProvider', { children: 'Current form' });

  const tree = await screen.settle();
  assert.equal(listeners.size, 0);
  const api = nodes(tree).find((node) => node.type === 'Provider')!.props.value;
  api.show('Help text', { x: 8, y: 200, width: 26, height: 26 });
  assert.match(textOf(await screen.settle()), /Help text/);
  assert.equal(listeners.get('hardwareBackPress')?.(), true, 'Back must not reach navigation');
  const closed = textOf(await screen.settle());
  assert.match(closed, /Current form/);
  assert.doesNotMatch(closed, /Help text/);
  assert.equal(listeners.size, 0, 'normal Back navigation resumes after help closes');
});
