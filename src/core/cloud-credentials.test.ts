import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCredentialStore, parseCredentialFile } from './cloud-credentials.ts';

const GROQ = 'fake-groq-key-for-tests';
const TAVILY = 'fake-tavily-key-for-tests';
const configured = { groqApiKey: GROQ, tavilyApiKey: TAVILY, provider: 'groq' as const };

function fixture() {
  let value: string | null = null;
  let fail = false;
  const store = createCredentialStore({
    read: async () => value,
    write: async (next) => {
      if (fail) throw new Error(`provider unexpectedly returned ${GROQ}`);
      value = next;
    },
    remove: async () => {
      value = null;
    },
  });
  return {
    store,
    fail: () => {
      fail = true;
    },
    raw: (next: string) => {
      value = next;
    },
  };
}

test('import accepts the prepared credential file without evaluating its contents', () => {
  assert.deepEqual(
    parseCredentialFile(`# local only\nGROQ_API_KEY="${GROQ}"\r\nTAVILY_API_KEY='${TAVILY}'\n`),
    configured,
  );
  assert.throws(
    () => parseCredentialFile(`GROQ_API_KEY=$(cat another-file)\nTAVILY_API_KEY=${TAVILY}`),
    /formato/,
  );
  assert.throws(
    () =>
      parseCredentialFile(`GROQ_API_KEY=${GROQ}\nGROQ_API_KEY=${GROQ}\nTAVILY_API_KEY=${TAVILY}`),
    /una vez/,
  );
  assert.throws(() => parseCredentialFile(`GROQ_API_KEY=${GROQ}\nTAVILY_API_KEY=`), /Tavily/);
});

test('saving provider preference preserves existing keys and returns no secrets', async () => {
  const { store } = fixture();
  await store.replace(configured);
  assert.deepEqual(await store.save({ provider: 'apple' }), {
    provider: 'apple',
    hasGroq: true,
    hasTavily: true,
  });
  assert.deepEqual(await store.load(), { ...configured, provider: 'apple' });
});

test('concurrent independent changes retain both updates', async () => {
  const { store } = fixture();
  await store.replace(configured);
  await Promise.all([
    store.save({ groqApiKey: 'fake-replacement-groq' }),
    store.save({ tavilyApiKey: 'fake-replacement-tavily' }),
  ]);
  assert.deepEqual(await store.load(), {
    provider: 'groq',
    groqApiKey: 'fake-replacement-groq',
    tavilyApiKey: 'fake-replacement-tavily',
  });
});

test('failed storage writes expose no key and preserve the working configuration', async () => {
  const { store, fail } = fixture();
  await store.replace(configured);
  fail();
  await assert.rejects(store.save({ groqApiKey: 'fake-replacement-groq' }), (error: Error) => {
    assert.match(error.message, /No pude guardar/);
    assert.ok(!error.message.includes(GROQ));
    return true;
  });
  assert.deepEqual(await store.load(), configured);
});

test('missing credentials cannot enable Groq and clearing returns to local mode', async () => {
  const { store } = fixture();
  await assert.rejects(store.save({ provider: 'groq' }), /Agrega la clave/);
  await store.replace(configured);
  assert.deepEqual(await store.clear(), { provider: 'apple', hasGroq: false, hasTavily: false });
  assert.deepEqual(await store.load(), { provider: 'apple', groqApiKey: '', tavilyApiKey: '' });
});

test('a valid import can replace damaged stored data', async () => {
  const { store, raw } = fixture();
  raw('invalid json');
  await assert.rejects(store.load(), /no se pueden leer/);
  await store.replace(configured);
  assert.deepEqual(await store.load(), configured);
});
