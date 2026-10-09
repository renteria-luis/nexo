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
  const screen = renderModule('src/ui/screens/Screen.tsx', {
    'react-native': {
      ScrollView: 'ScrollView',
      RefreshControl: 'RefreshControl',
      View: 'View',
      Text: 'Text',
      StyleSheet: { absoluteFill: {} },
      Platform: { OS: 'ios' },
      Keyboard: { addListener: () => ({ remove() {} }) },
      Animated: {
        View: 'Animated.View',
        Value: class {
          interpolate() {
            return 0;
          }
        },
      },
    },
    '../../shell/AppData.tsx': { useAppData: () => app },
    '../../shell/backup-file.ts': {},
    '../Button.tsx': { Button: 'Button' },
    '../TabBar.tsx': { FloatingBarSpace: { value: 0 } },
    '../theme.ts': { font: {}, sheet: (make: (theme: unknown) => unknown) => make({}) },
  }).mount('Screen', props);
  const scroll = async () =>
    nodes(await screen.settle()).find((node) => node.type === 'ScrollView')!.props;
  return {
    screen,
    props,
    scroll,
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
  assert.equal((await f.scroll()).refreshControl, undefined);
  f.props.overlay = undefined;
  f.props.scrollEnabled = false;
  assert.equal((await f.scroll()).refreshControl, undefined);
});
