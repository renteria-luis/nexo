import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderModule } from '../ui/test-render.ts';

/**
 * expo-sqlite as it behaves on the phone: opening a file that is already open hands
 * back the cached connection with one more reference, a close only drops one, and a
 * delete refuses a file that still has any.
 */
function fakeSqlite() {
  const refs = new Map<string, number>();
  let opened = 0;
  let deleted = 0;
  const tick = () => new Promise((done) => setTimeout(done, 0));
  return {
    sqlite: {
      openDatabaseAsync: async (name: string) => {
        await tick();
        refs.set(name, (refs.get(name) ?? 0) + 1);
        opened += 1;
        const handle = { name, generation: opened };
        return {
          ...handle,
          closeAsync: async () => {
            await tick();
            refs.set(name, (refs.get(name) ?? 1) - 1);
          },
        };
      },
      deleteDatabaseAsync: async (name: string) => {
        await tick();
        if ((refs.get(name) ?? 0) > 0) {
          throw new Error(`Unable to delete database '${name}' that is currently open`);
        }
        deleted += 1;
      },
    },
    refs,
    deletions: () => deleted,
  };
}

test('a screen asking for the database mid-reset waits for the rebuilt one', async () => {
  const fake = fakeSqlite();
  const db = renderModule('src/db/index.ts', {
    'expo-sqlite': fake.sqlite,
    './migrate.ts': { migrate: async () => {} },
  }).exports;

  const first = await db.openDatabase();
  const reset = db.resetDatabase();
  // What Hoy or a Transit task does while Ajustes is wiping the file.
  const meanwhile = db.openDatabase();

  await reset;
  const after = await meanwhile;

  assert.equal(fake.deletions(), 1);
  assert.notEqual(after.generation, first.generation);
  assert.equal(fake.refs.get('nexo.db'), 1);
  assert.equal(await db.openDatabase(), after);
});

test('a reset that fails lets the next open try again', async () => {
  const fake = fakeSqlite();
  const db = renderModule('src/db/index.ts', {
    'expo-sqlite': {
      ...fake.sqlite,
      deleteDatabaseAsync: async () => {
        throw new Error('disk on fire');
      },
    },
    './migrate.ts': { migrate: async () => {} },
  }).exports;

  await db.openDatabase();
  await assert.rejects(db.resetDatabase(), /disk on fire/);
  assert.ok(await db.openDatabase());
});
