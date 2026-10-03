import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dateFrom, parseCommand } from './commands.ts';

const TODAY = '2026-09-28';

function ok(input: string) {
  const parsed = parseCommand(input, TODAY);
  assert.ok(parsed.ok, `"${input}" should parse but said: ${parsed.ok ? '' : parsed.reason}`);
  return parsed.command;
}

function on(input: string) {
  const parsed = parseCommand(input, TODAY);
  assert.ok(parsed.ok, `"${input}" should parse but said: ${parsed.ok ? '' : parsed.reason}`);
  return parsed.date;
}

function rejected(input: string) {
  const parsed = parseCommand(input, TODAY);
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

test('lo que escribe despues del numero cuenta: la unidad se lee y lo demas se rechaza', () => {
  assert.deepEqual(ok('sueno 7h 30m'), { kind: 'sleep', minutes: 450 });
  assert.deepEqual(ok('sueño 7h30'), { kind: 'sleep', minutes: 450 });
  assert.deepEqual(ok('sueno 7h30m'), { kind: 'sleep', minutes: 450 });
  assert.deepEqual(ok('agua 1.5 l'), { kind: 'water', ml: 1500 });
  assert.deepEqual(ok('agua 1,5l'), { kind: 'water', ml: 1500 });
  assert.deepEqual(ok('agua 710 ml'), { kind: 'water', ml: 710 });
  assert.deepEqual(ok('pasos 8,200'), { kind: 'steps', steps: 8200 });
  assert.deepEqual(ok('pasos 8.200'), { kind: 'steps', steps: 8200 });
  assert.deepEqual(ok('pasos 12,345'), { kind: 'steps', steps: 12345 });
  assert.deepEqual(ok('peso 73.4 kg'), { kind: 'weight', value: 73.4 });
  assert.deepEqual(ok('peso 73.4kg'), { kind: 'weight', value: 73.4 });

  // Antes: 710 ml y los pasos tirados, 2 ml, 8 pasos, 165 kg.
  assert.match(rejected('agua 710 pasos 8200'), /Sobra "pasos 8200"/);
  assert.match(rejected('agua 1.5'), /Con unidad/);
  assert.match(rejected('pasos 8.2'), /Cuantos pasos/);
  assert.match(rejected('peso 165 lb'), /va en kilos/);
  assert.match(rejected('creatina no gracias'), /Sobra "gracias"/);
  assert.match(rejected('serie 65x8 rpe8 otra'), /Sobra "otra"/);
});

test('sin fecha escrita el comando es de hoy', () => {
  assert.equal(on('agua 710'), TODAY);
  assert.equal(on('hoy agua 710'), TODAY);
  assert.equal(on('ayer pasos 8200'), '2026-09-27');
  assert.equal(on('anteayer pasos 8200'), '2026-09-26');
});

test('la fecha va donde le salga, delante o detras', () => {
  assert.equal(on('25 set pasos 5000'), '2026-09-25');
  assert.equal(on('pasos 5000 25 set'), '2026-09-25');
  assert.deepEqual(ok('25 set pasos 5000'), { kind: 'steps', steps: 5000 });
});

test('el anio se adivina y nunca cae en el futuro', () => {
  assert.equal(on('25 setiembre pasos 5000'), '2026-09-25');
  assert.equal(on('25 dic pasos 5000'), '2025-12-25');
  assert.equal(on('25/09 pasos 5000'), '2026-09-25');
  assert.equal(on('25-09-2025 pasos 5000'), '2025-09-25');
  assert.equal(on('2025-09-25 pasos 5000'), '2025-09-25');
});

test('lo que no es una fecha se queda en el comando', () => {
  assert.equal(on('peso 7.4'), TODAY);
  assert.deepEqual(ok('peso 7.4'), { kind: 'weight', value: 7.4 });
  assert.equal(on('serie 65x8'), TODAY);
  assert.equal(on('creatina no'), TODAY);
  assert.match(rejected('32 set pasos 5000'), /No conozco "32"/);
});

test('una fecha suelta, sin comando, para las preguntas', () => {
  assert.equal(dateFrom('ayer', TODAY), '2026-09-27');
  assert.equal(dateFrom('25 set', TODAY), '2026-09-25');
  assert.equal(dateFrom('el martes', TODAY), null);
  assert.equal(dateFrom('', TODAY), null);
});
