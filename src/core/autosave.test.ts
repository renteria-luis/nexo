import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autosave, type SaveState } from './autosave.ts';

test('typing during a slow write persists the latest text in order before reporting saved', async () => {
  let release!: () => void;
  const written: string[] = [];
  const states: SaveState[] = [];
  const writer = autosave(
    'old',
    async (text) => {
      if (!written.length)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      written.push(text);
    },
    (state) => states.push(state),
  );
  const pending = writer.change('first');
  await Promise.resolve();
  writer.change('second');
  writer.change('latest');
  assert.equal(states.at(-1)?.status, 'saving');
  release();
  await pending;
  assert.deepEqual(written, ['first', 'latest']);
  assert.equal(states.at(-1)?.status, 'saved');
});

test('a failed save retains the newest text and permits retry, including a synchronous failure', async () => {
  let failing = true;
  let stored = 'old';
  const states: SaveState[] = [];
  const writer = autosave(
    'old',
    (text) => {
      if (failing) throw new Error('storage failure');
      stored = text;
      return Promise.resolve();
    },
    (state) => states.push(state),
  );
  await writer.change('custom technique');
  assert.equal(stored, 'old');
  assert.equal(states.at(-1)?.status, 'error');
  failing = false;
  await writer.retry();
  assert.equal(stored, 'custom technique');
  assert.equal(states.at(-1)?.status, 'saved');
});

test('reverting text during storage restores the original persisted value', async () => {
  let release!: () => void;
  const written: string[] = [];
  const writer = autosave(
    'old',
    async (text) => {
      if (!written.length)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      written.push(text);
    },
    () => {},
  );
  const pending = writer.change('temporary');
  await Promise.resolve();
  writer.change('old');
  release();
  await pending;
  assert.deepEqual(written, ['temporary', 'old']);
});
