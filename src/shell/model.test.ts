import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderModule } from '../ui/test-render.ts';

function fixture(provider: 'apple' | 'groq', groqApiKey = '', available = false) {
  const calls: string[] = [];
  let appleFailure: Error | null = null;
  let cloudFailure: Error | null = null;
  const module = renderModule('src/shell/model.ts', {
    'react-native': {
      TurboModuleRegistry: {
        get: () => ({
          isAvailable: () => available,
          generateText: async () => {
            calls.push('apple');
            if (appleFailure) throw appleFailure;
            return [{ type: 'text', text: '{"provider":"apple"}' }];
          },
        }),
      },
    },
    './assistant-credentials.ts': {
      loadAssistantCredentials: async () => ({ provider, groqApiKey, tavilyApiKey: '' }),
    },
    './cloud.ts': {
      askGroq: async () => {
        calls.push('groq');
        if (cloudFailure) throw cloudFailure;
        return '{"provider":"groq"}';
      },
      withModelDeadline: async (work: () => Promise<unknown>) => work(),
      CloudError: class extends Error {
        constructor(_code: string, _service: string) {
          super('Respuesta no verificable.');
        }
      },
    },
  });
  return {
    calls,
    status: () => module.mount('modelStatus').render(),
    ask: () => module.mount('askModel', [] as any).render(),
    failApple: (error: Error) => {
      appleFailure = error;
    },
    failCloud: (error: Error) => {
      cloudFailure = error;
    },
  };
}

test('provider availability follows explicit settings instead of Apple hardware alone', async () => {
  assert.deepEqual(await fixture('groq', 'fixture-key').status(), {
    provider: 'groq',
    ready: true,
    reason: null,
  });
  assert.equal((await fixture('groq', '', true).status()).ready, false);
  assert.equal((await fixture('apple', 'fixture-key', false).status()).ready, false);
  assert.equal((await fixture('apple', '', true).status()).ready, true);
});

test('selected provider is used without an automatic fallback on errors', async () => {
  const apple = fixture('apple', 'fixture-key', true);
  assert.equal(await apple.ask(), '{"provider":"apple"}');
  assert.deepEqual(apple.calls, ['apple']);
  apple.failApple(new Error('sensitive native failure'));
  await assert.rejects(apple.ask(), (error: Error) => !error.message.includes('sensitive'));
  assert.deepEqual(apple.calls, ['apple', 'apple']);
  const groq = fixture('groq', 'fixture-key', true);
  assert.equal(await groq.ask(), '{"provider":"groq"}');
  groq.failCloud(new Error('safe cloud error'));
  await assert.rejects(groq.ask(), /safe cloud error/);
  assert.deepEqual(groq.calls, ['groq', 'groq']);
});

test('an unavailable local model keeps all credentials private and does not use the cloud', async () => {
  const missing = fixture('apple', 'fixture-key', false);
  await assert.rejects(missing.ask(), /modelo local no está disponible/);
  assert.deepEqual(missing.calls, []);
});
