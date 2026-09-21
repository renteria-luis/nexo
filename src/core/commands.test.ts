import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCommand } from './commands.ts';

function ok(input: string) {
  const parsed = parseCommand(input);
  assert.ok(parsed.ok, `"${input}" should parse but said: ${parsed.ok ? '' : parsed.reason}`);
  return parsed.command;
}

function rejected(input: string) {
  const parsed = parseCommand(input);
  assert.equal(parsed.ok, false, `"${input}" should have been refused`);
  return parsed.ok ? '' : parsed.reason;
}

test('the commands he would actually type', () => {
  assert.deepEqual(ok('agua 710'), { kind: 'water', ml: 710 });
  assert.deepEqual(ok('peso 74.2'), { kind: 'weight', value: 74.2 });
  assert.deepEqual(ok('pasos 8200'), { kind: 'steps', steps: 8200 });
  assert.deepEqual(ok('creatina'), { kind: 'creatine', taken: true });
  assert.deepEqual(ok('creatina no'), { kind: 'creatine', taken: false });
  assert.deepEqual(ok('serie 65x8'), { kind: 'set', weight: 65, reps: 8, rpe: null });
  assert.deepEqual(ok('serie 22.5x11 rpe8'), { kind: 'set', weight: 22.5, reps: 11, rpe: 8 });
});

test('sleep is written with its unit, in hours or in minutes', () => {
  assert.deepEqual(ok('sueno 7.5h'), { kind: 'sleep', minutes: 450 });
  assert.deepEqual(ok('sueño 130m'), { kind: 'sleep', minutes: 130 });
  assert.match(rejected('sueno 7.5'), /h o con m/);
});

test('accents, capitals and stray spaces are the same command', () => {
  assert.deepEqual(ok('  AGUA   710 '), { kind: 'water', ml: 710 });
  assert.deepEqual(ok('Sueño 8h'), { kind: 'sleep', minutes: 480 });
});

test('a command it does not know writes nothing and says so', () => {
  assert.match(rejected('correr 5km'), /No conozco "correr"/);
  assert.match(rejected(''), /ayuda/);
  assert.match(rejected('agua mucha'), /Cuantos ml/);
  assert.match(rejected('serie 65'), /peso por repeticiones/);
  assert.match(rejected('serie 65x0'), /Cero repeticiones/);
  assert.match(rejected('serie 65x8 rpe22'), /RPE va de 1 a 10/);
  assert.match(rejected('peso -3'), /Cuanto pesas/);
  assert.match(rejected('creatina quiza'), /creatina no/);
});
