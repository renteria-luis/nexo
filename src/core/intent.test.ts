import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INTENT_SCHEMA, instructions, readIntent } from './intent.ts';

test('una respuesta de anotar trae la linea de comando', () => {
  assert.deepEqual(readIntent({ tipo: 'anotar', comando: 'ayer sueno 390m' }), {
    kind: 'write',
    line: 'ayer sueno 390m',
  });
  assert.deepEqual(readIntent('{"tipo":"anotar","comando":"peso 74.5"}'), {
    kind: 'write',
    line: 'peso 74.5',
  });
});

test('una pregunta solo vale si es una de las que sabe contestar', () => {
  assert.deepEqual(readIntent({ tipo: 'preguntar', pregunta: 'marca', ejercicio: 'press banca' }), {
    kind: 'ask',
    question: 'marca',
    exercise: 'press banca',
    date: null,
  });
  assert.equal(readIntent({ tipo: 'preguntar', pregunta: 'el clima' }).kind, 'none');
  assert.equal(readIntent({ tipo: 'preguntar' }).kind, 'none');
});

test('lo que no encaja se queda en nada y no escribe', () => {
  assert.deepEqual(readIntent({ tipo: 'nada', respuesta: 'Dime cuántos ml' }), {
    kind: 'none',
    reply: 'Dime cuántos ml',
  });
  // Un modelo pequeño contesta cualquier cosa: nada de esto puede acabar escribiendo.
  assert.equal(readIntent({ tipo: 'anotar', comando: '   ' }).kind, 'none');
  assert.equal(readIntent('no soy json').kind, 'none');
  assert.equal(readIntent(null).kind, 'none');
  assert.equal(readIntent(42).kind, 'none');
  assert.equal(readIntent({}).kind, 'none');
});

test('el esquema es el trozo de json schema que entiende Apple', () => {
  assert.equal(INTENT_SCHEMA.type, 'object');
  // Todos obligatorios: un campo opcional es un campo que el modelo del telefono se
  // ahorra, y se ahorraba justo el que decia que hacer (2026-10-01).
  assert.deepEqual(
    Object.keys(INTENT_SCHEMA.properties).sort(),
    [...INTENT_SCHEMA.required].sort(),
  );
  // Cadenas con enum y nada mas: ni anyOf anidado ni tipos que el parser de Swift no lea.
  for (const property of Object.values(INTENT_SCHEMA.properties)) {
    assert.equal(property.type, 'string');
    assert.ok(property.description.length > 0);
  }
});

test('las instrucciones dicen el dia y la unidad, que es lo que el no escribe', () => {
  const said = instructions('2026-09-29', 'kg');
  assert.match(said, /2026-09-29/);
  assert.match(said, /en kg/);
  assert.match(said, /agua 710/);
});
