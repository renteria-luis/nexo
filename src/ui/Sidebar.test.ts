import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodes, renderModule } from './test-render.ts';

function fixture() {
  let locked = false;
  let route = 'Hoy';
  const screen = renderModule('src/ui/Sidebar.tsx', {
    './SwipeLock.tsx': { useSwipeLock: () => ({ isLocked: () => locked }) },
    './icons.ts': new Proxy({}, { get: (_target, name) => String(name) }),
    './theme.ts': {
      font: {},
      shape: {},
      theme: {},
      hardShadow: () => ({}),
      sheet: (make: (theme: unknown) => unknown) => make({}),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'react-native': {
      View: 'View',
      Text: 'Text',
      Pressable: 'Pressable',
      ScrollView: 'ScrollView',
      StyleSheet: { absoluteFill: {} },
      useWindowDimensions: () => ({ width: 430 }),
      Easing: { in: () => null, out: () => null },
      Animated: {
        View: 'Animated.View',
        Value: class {
          setValue() {}
          interpolate() {
            return 0;
          }
        },
        timing: () => ({
          start: (done?: (result: { finished: boolean }) => void) => done?.({ finished: true }),
        }),
      },
      PanResponder: { create: (handlers: unknown) => ({ panHandlers: handlers }) },
    },
  }).mount('SidebarProvider', {
    navigation: { isReady: () => true, getCurrentRoute: () => ({ name: route }) },
  });
  const edge = async () =>
    nodes(await screen.settle()).find(
      (node) => node.type === 'View' && node.props.onMoveShouldSetPanResponderCapture,
    )!.props;
  return {
    screen,
    edge,
    lock: (value: boolean) => {
      locked = value;
    },
    route: (value: string) => {
      route = value;
    },
  };
}

test('the sidebar cannot capture a grid drag even before the touch lock renders', async () => {
  const f = fixture();
  const handler = (await f.edge()).onMoveShouldSetPanResponderCapture;
  // On a wide phone the first squares overlap the sidebar's 15% edge region.
  const swipe = { x0: 62, dx: 50, dy: 2 };
  assert.equal(handler(null, swipe), true);
  f.lock(true);
  assert.equal(handler(null, swipe), false);
  assert.equal(
    handler(null, { ...swipe, dx: 220 }),
    false,
    'the edge still belongs to the grid when it cannot scroll farther',
  );
  f.lock(false);
  assert.equal(handler(null, swipe), true, 'an outside-grid swipe works after release');
  assert.equal(handler(null, { ...swipe, x0: 100 }), false);
  assert.equal(handler(null, { ...swipe, dy: 80 }), false);
  f.route('Entreno');
  assert.equal(handler(null, swipe), false);
});

test('the menu button still opens and closes the sidebar independently of swipe capture', async () => {
  const f = fixture();
  f.lock(true);
  let tree = await f.screen.settle();
  nodes(tree)
    .find((node) => node.type === 'Provider')!
    .props.value.open();
  tree = await f.screen.settle();
  assert.equal(nodes(tree).find((node) => node.type === 'Provider')!.props.value.isOpen, true);
  assert.equal(
    (await f.edge()).onMoveShouldSetPanResponderCapture(null, { x0: 10, dx: 40, dy: 0 }),
    false,
  );
  nodes(tree)
    .find((node) => node.props.accessibilityLabel === 'Cerrar el menú')!
    .props.onPress();
  assert.equal(
    nodes(await f.screen.settle()).find((node) => node.type === 'Provider')!.props.value.isOpen,
    false,
  );
});
