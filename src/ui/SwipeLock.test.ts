import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodes, renderModule } from './test-render.ts';

test('releasing the grid touch never unlocks another gesture and permits later tab swipes', async () => {
  const screen = renderModule('src/ui/SwipeLock.tsx').mount('SwipeLockProvider');
  const value = async () =>
    nodes(await screen.settle()).find((node) => node.type === 'Provider')!.props.value;
  const initial = await value();
  const releaseGrid = initial.acquire();
  assert.equal(initial.isLocked(), true, 'capture is blocked before the next render');
  assert.equal((await value()).locked, true);
  const releaseAnother = initial.acquire();
  releaseGrid();
  assert.equal(initial.isLocked(), true);
  assert.equal((await value()).locked, true);
  initial.setLocked(true);
  releaseAnother();
  assert.equal((await value()).locked, true);
  initial.setLocked(false);
  assert.equal(initial.isLocked(), false, 'release is visible before the next render');
  assert.equal((await value()).locked, false);
  releaseGrid();
  assert.equal((await value()).locked, false, 'late cancellation is idempotent');
  assert.equal((await value()).acquire, initial.acquire);
  assert.equal((await value()).isLocked, initial.isLocked);
});
