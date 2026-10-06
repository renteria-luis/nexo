import assert from 'node:assert/strict';
import { test } from 'node:test';

import { askGroq, cloudJson, CloudError, type CloudFailure } from './cloud.ts';

const schema = {
  type: 'object',
  properties: { intent: { type: 'string', enum: ['ask'] } },
  required: ['intent'],
};
const apiKey = 'fixture-credential-not-a-real-key';
const message = [{ role: 'user' as const, content: 'proteína consumida ayer' }];
const envelope = (content: unknown, finish = 'stop') => ({
  choices: [{ message: { content }, finish_reason: finish }],
});
const fetchResult =
  (body: unknown, status = 200): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status });
const failure = (code: CloudFailure) => (error: unknown) =>
  error instanceof CloudError && error.code === code && !error.message.includes(apiKey);

test('Groq requests strict structured output and sends only supplied context', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(new Headers(options?.headers).get('Authorization'), `Bearer ${apiKey}`);
    assert.equal(new Headers(options?.headers).get('User-Agent'), 'Nexo/1.0');
    const body = JSON.parse(String(options?.body));
    assert.deepEqual(body.messages, message);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
    return new Response(JSON.stringify(envelope('{"intent":"ask"}')));
  };
  assert.equal(await askGroq({ apiKey, messages: message, schema, fetcher }), '{"intent":"ask"}');
  assert.equal(calls, 1);
});

test('Groq rejects malformed, incomplete, schema-invalid and truncated answers', async () => {
  for (const body of [
    null,
    {},
    envelope('not json'),
    envelope('{}'),
    envelope('{"intent":"write"}'),
    envelope('{"intent":"ask","extra":"invented"}'),
    envelope('{"intent":"ask"}', 'length'),
    envelope(apiKey),
    envelope(null),
  ]) {
    await assert.rejects(
      askGroq({ apiKey, messages: message, schema, fetcher: fetchResult(body) }),
      failure('invalid'),
    );
  }
});

test('provider failures are sanitized and stop without retries or switching providers', async () => {
  for (const [status, code] of [
    [401, 'credentials'],
    [403, 'credentials'],
    [429, 'quota'],
    [432, 'quota'],
    [433, 'quota'],
    [500, 'server'],
    [503, 'server'],
    [400, 'invalid'],
  ] as const) {
    let calls = 0;
    await assert.rejects(
      cloudJson(
        'search',
        apiKey,
        {},
        {
          fetcher: async () => {
            calls++;
            return new Response(apiKey, { status });
          },
        },
      ),
      failure(code),
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    cloudJson(
      'groq',
      apiKey,
      {},
      {
        fetcher: async () => {
          throw new Error(apiKey);
        },
      },
    ),
    failure('network'),
  );
  await assert.rejects(
    cloudJson(
      'groq',
      '',
      {},
      {
        fetcher: async () => {
          assert.fail('missing key must prevent a request');
        },
      },
    ),
    failure('credentials'),
  );
});

test('timeout and cancellation settle even if the transport does not reject on abort', async () => {
  let signal: AbortSignal | null | undefined;
  const fetcher: typeof fetch = async (_url, options) => {
    signal = options?.signal;
    return new Promise(() => {});
  };
  await assert.rejects(
    cloudJson('groq', apiKey, {}, { fetcher, timeoutMs: 5 }),
    failure('timeout'),
  );
  assert.equal(signal?.aborted, true);
  const controller = new AbortController();
  const pending = cloudJson('groq', apiKey, {}, { fetcher, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, failure('cancelled'));
  await assert.rejects(
    cloudJson(
      'groq',
      apiKey,
      {},
      {
        fetcher: async () => {
          assert.fail('cancelled request must not start');
        },
        signal: controller.signal,
      },
    ),
    failure('cancelled'),
  );
});

test('deadline also covers a response body that never arrives', async () => {
  await assert.rejects(
    cloudJson(
      'groq',
      apiKey,
      {},
      {
        timeoutMs: 5,
        fetcher: async () =>
          ({ ok: true, status: 200, json: () => new Promise(() => {}) }) as Response,
      },
    ),
    failure('timeout'),
  );
});

test('Groq retries a transient schema-generation failure once', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ error: { code: 'json_validate_failed' } }), { status: 400 })
      : new Response(JSON.stringify(envelope('{"intent":"ask"}')));
  };
  assert.equal(await askGroq({ apiKey, messages: message, schema, fetcher }), '{"intent":"ask"}');
  assert.equal(calls, 2);
});

test('a repeated schema failure stops and other provider errors never retry', async () => {
  for (const [endpoint, status, errorCode, expectedCalls, code] of [
    ['groq', 400, 'json_validate_failed', 2, 'invalid'],
    ['groq', 400, 'invalid_request', 1, 'invalid'],
    ['groq', 429, 'rate_limit', 1, 'quota'],
    ['search', 400, 'json_validate_failed', 1, 'invalid'],
  ] as const) {
    let calls = 0;
    await assert.rejects(
      cloudJson(
        endpoint,
        apiKey,
        {},
        {
          fetcher: async () => {
            calls += 1;
            return new Response(JSON.stringify({ error: { code: errorCode } }), { status });
          },
        },
      ),
      failure(code),
    );
    assert.equal(calls, expectedCalls);
  }
});
