import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodes, renderModule, textOf } from '../test-render.ts';

function fixture() {
  let calls = 0;
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const app = {
    state: { phase: 'ready', problem: null },
    refreshData: () => {
      calls++;
      return new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
    },
  };
  const props = {
    title: 'Hoy',
    refreshable: true,
    children: 'existing draft',
    overlay: undefined as unknown,
    scrollEnabled: true,
  };
  const listeners = new Map<string, (event: any) => void>();
  const screen = renderModule('src/ui/screens/Screen.tsx', {
    'react-native': {
      ScrollView: 'ScrollView',
      RefreshControl: 'RefreshControl',
      View: 'View',
      Text: 'Text',
      Easing: { out: (f: unknown) => f, in: (f: unknown) => f, cubic: () => 0 },
      StyleSheet: { absoluteFill: {} },
      Platform: { OS: 'ios' },
      Keyboard: {
        addListener: (name: string, fn: (event: any) => void) => {
          listeners.set(name, fn);
          return { remove() {} };
        },
        dismiss() {},
      },
      Animated: {
        View: 'Animated.View',
        ScrollView: 'ScrollView',
        event: () => () => undefined,
        timing: () => ({ start() {} }),
        Value: class {
          interpolate(config: { outputRange: number[] }) {
            return config.outputRange[1];
          }
          addListener() {
            return '';
          }
          removeListener() {}
        },
      },
    },
    '@react-navigation/native': { NavigationRouteContext: { value: { name: 'Hoy' } } },
    '../background-editing.tsx': { useBackgrounds: () => ({}) },
    '../../shell/AppData.tsx': { useAppData: () => app },
    '../../shell/backup-file.ts': {},
    '../Button.tsx': { Button: 'Button' },
    '../TabBar.tsx': { FloatingBarSpace: { value: 0 } },
    '../ScreenBlur': { ScreenBlur: 'ScreenBlur' },
    '../theme.ts': { font: {}, sheet: (make: (theme: unknown) => unknown) => make({}) },
  }).mount('Screen', props);
  const scroll = async () =>
    nodes(await screen.settle()).find((node) => node.type === 'ScrollView')!.props;
  return {
    screen,
    props,
    scroll,
    listeners,
    calls: () => calls,
    finish: () => finish(),
    fail: () => fail(new Error('offline database')),
  };
}

test('pull-to-refresh waits for completion, coalesces repeated pulls and preserves contents', async () => {
  const f = fixture();
  const control = (await f.scroll()).refreshControl.props;
  assert.equal(control.refreshing, false);
  const pending = control.onRefresh();
  control.onRefresh();
  assert.equal(f.calls(), 1);
  assert.equal((await f.scroll()).refreshControl.props.refreshing, true);
  assert.match(textOf(await f.screen.settle()), /existing draft/);
  f.finish();
  await pending;
  assert.equal((await f.scroll()).refreshControl.props.refreshing, false);
});

test('a failed pull stops the spinner and exposes retry without removing data', async () => {
  const f = fixture();
  const pending = (await f.scroll()).refreshControl.props.onRefresh();
  f.fail();
  await pending;
  assert.equal((await f.scroll()).refreshControl.props.refreshing, false);
  const tree = await f.screen.settle();
  assert.match(textOf(tree), /offline database/);
  assert.match(textOf(tree), /existing draft/);
  assert.ok(nodes(tree).some((node) => node.props.label === 'Reintentar actualización'));
  f.props.overlay = 'editing overlay';
  assert.ok((await f.scroll()).refreshControl, 'opening a popup preserves the scroll tree');
  assert.equal((await f.scroll()).refreshControl.props.enabled, false);
  assert.equal((await f.scroll()).scrollEnabled, false);
  f.props.overlay = undefined;
  // A drag inside turns scrolling off mid-touch; removing the control then hung the
  // screen on the iPhone, so it stays mounted and only scrolling stops.
  f.props.scrollEnabled = false;
  const dragging = await f.scroll();
  assert.equal(dragging.scrollEnabled, false);
  assert.ok(dragging.refreshControl);
});

test('screen refresh waits for its extra work and ignores pulls during map gestures', async () => {
  const f = fixture();
  let extraCalls = 0;
  let finishExtra!: () => void;
  Object.assign(f.props, {
    onRefresh: () => {
      extraCalls++;
      return new Promise<void>((resolve) => {
        finishExtra = resolve;
      });
    },
  });
  f.props.scrollEnabled = false;
  await (await f.scroll()).refreshControl.props.onRefresh();
  assert.equal(f.calls(), 0);
  assert.equal(extraCalls, 0);
  f.props.scrollEnabled = true;
  const pending = (await f.scroll()).refreshControl.props.onRefresh();
  assert.equal(extraCalls, 1);
  f.finish();
  assert.equal((await f.scroll()).refreshControl.props.refreshing, true);
  finishExtra();
  await pending;
  assert.equal((await f.scroll()).refreshControl.props.refreshing, false);
});

test('a child sheet keeps its parent mounted, blocks background interaction and dismisses one level', async () => {
  const f = fixture();
  Object.assign(f.props, {
    overlay: 'explorer',
    overlayAbove: 'place editor',
    onOverlayDismiss: () => {
      Object.assign(f.props, { overlayAbove: undefined });
    },
  });
  let tree = await f.screen.settle();
  assert.match(textOf(tree), /explorer/);
  assert.match(textOf(tree), /place editor/);
  const hidden = nodes(tree).filter(
    (n) => n.props.importantForAccessibility === 'no-hide-descendants',
  );
  assert.ok(hidden.some((n) => textOf(n).includes('explorer') && n.props.pointerEvents === 'none'));
  const close = nodes(tree)
    .filter((n) => n.props.accessibilityLabel === 'Cerrar')
    .at(-1)!;
  // The parent remains, and refresh remains disabled after dismissing the child.
  close.props.onPress();
  tree = await f.screen.settle();
  assert.ok(close);
  assert.match(textOf(tree), /explorer/);
  assert.doesNotMatch(textOf(tree), /place editor/);
  assert.equal((await f.scroll()).refreshControl.props.enabled, false);
  await (await f.scroll()).refreshControl.props.onRefresh();
  assert.equal(f.calls(), 0);
});

test('opening the keyboard shrinks the active overlay sheet frame to fit above the keyboard', async () => {
  const f = fixture();
  f.props.overlay = 'place editor';
  let tree = await f.screen.settle();
  const layoutViews = () =>
    nodes(tree).filter((n) => n.type === 'View' && typeof n.props.onLayout === 'function');
  layoutViews()[0].props.onLayout({ nativeEvent: { layout: { height: 740 } } });
  layoutViews()[1].props.onLayout({ nativeEvent: { layout: { height: 560 } } });
  tree = await f.screen.settle();
  f.listeners.get('keyboardWillShow')!({ endCoordinates: { height: 336 }, duration: 250 });
  tree = await f.screen.settle();
  assert.deepEqual(layoutViews()[1].props.style.at(-1), { maxHeight: 376 });
  const animatedOverlay = nodes(tree).find((n) => n.type === 'Animated.View')!;
  assert.deepEqual(animatedOverlay.props.style.at(-1), {
    transform: [{ translateY: -168 }],
  });
});
