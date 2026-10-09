import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCommand } from './commands.ts';
import { commandLine, interpretedCommand, validateInterpretedWrite } from './write-intent.ts';

const today = '2026-10-04';
function validate(message: string, line: string, unit = 'lb') {
  const parsed = parseCommand(line, today);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error('Expected a valid command fixture.');
  return validateInterpretedWrite(message, parsed, today, unit);
}

test('a model cannot turn a question or unrelated text into a valid write', () => {
  for (const message of [
    'proteina consumida ayer',
    '¿ayer dormí 7 horas?',
    'cuánto dormí ayer',
    'hola',
  ]) {
    assert.notEqual(validate(message, 'ayer sueno 390m'), null);
  }
  assert.notEqual(validate('ayer caminé 8000 pasos', 'ayer sueno 390m'), null);
});

test('interpreted quantities must come from the original metric and amount', () => {
  for (const [message, line] of [
    ['ayer dormí como seis y media', 'ayer sueno 390m'],
    ['ayer dormí seis horas y treinta minutos', 'ayer sueno 390m'],
    ['ayer dormí seis horas y media', 'ayer sueno 390m'],
    ['¿puedes anotar 9000 pasos ayer?', 'ayer pasos 9000'],
    ['dormí 1 hora', 'sueno 60m'],
    ['me tomé 1.5 litros de agua', 'agua 1500'],
    ['tomé setecientos diez ml de agua', 'agua 710'],
    ['caminé nueve mil pasos', 'pasos 9000'],
    ['me pesé setenta y cuatro y medio', 'peso 74.5'],
    ['ya tomé la creatina', 'creatina'],
    ['ayer no tomé creatina', 'ayer creatina no'],
    ['hice una serie de 90 lb por 8 reps rpe 8', 'serie 90x8 rpe8'],
  ])
    assert.equal(validate(message, line), null, `${message} -> ${line}`);
  for (const [message, line] of [
    ['tomé un vaso de agua', 'agua 250'],
    ['dormí seis horas', 'sueno 390m'],
    ['caminé 8000 pasos', 'pasos 9000'],
    ['me pesé 74', 'peso 75'],
    ['ya tomé la creatina', 'creatina no'],
    ['no tomé la creatina', 'creatina'],
    ['hice una serie de 90 por 8', 'serie 90x8 rpe8'],
    ['hice una serie de 90 kg por 8', 'serie 90x8'],
  ])
    assert.notEqual(validate(message, line), null, `${message} -> ${line}`);
});

test('interpreted writes preserve the original day instead of copying a prompt date', () => {
  assert.notEqual(validate('ayer caminé nueve mil pasos', 'pasos 9000'), null);
  assert.notEqual(validate('caminé nueve mil pasos', 'ayer pasos 9000'), null);
  assert.equal(validate('25 de setiembre caminé nueve mil pasos', '25 set pasos 9000'), null);
});

test('calendar numbers cannot become unstated quantities', () => {
  assert.notEqual(validate('el 6 de septiembre dormí', '6 sep sueno 360m'), null);
  assert.notEqual(validate('el 25 de septiembre caminé', '25 sep pasos 25'), null);
  assert.notEqual(validate('25 set caminé nueve mil pasos', '25 set pasos 25'), null);
});

test('a model cannot swap quantities between metrics in a combined message', () => {
  const message = 'hoy caminé 9000 pasos y bebí 500 ml de agua';
  for (const line of ['pasos 500', 'agua 9000']) {
    assert.equal(interpretedCommand(message, line, today, 'lb').ok, false);
  }
  assert.equal(validate('hice una serie con peso de 90 lb por 8 reps', 'serie 90x8'), null);
});

test('the original date controls a model proposal that omits or changes it', () => {
  for (const line of ['pasos 9000', 'hoy pasos 9000', '2025-01-01 pasos 9000']) {
    const result = interpretedCommand('ayer caminé nueve mil pasos', line, today, 'lb');
    assert.equal(result.ok, true);
    if (!result.ok) assert.fail('Expected a checked proposal.');
    assert.equal(result.date, '2026-10-03');
    assert.equal(commandLine(result.command), 'pasos 9000');
  }
  assert.equal(
    interpretedCommand('ayer caminé nueve mil pasos', 'ayer pasos 25', today, 'lb').ok,
    false,
  );
  assert.equal(
    interpretedCommand('el día de mi cumpleaños caminé nueve mil pasos', 'pasos 9000', today, 'lb')
      .ok,
    false,
  );
});

test('a pantry change the model understood must name the thing, what happened and the amount', () => {
  assert.equal(validate('se me acabó la leche', 'se acabo leche'), null);
  assert.equal(validate('ya no hay leche', 'se acabo leche'), null);
  assert.equal(validate('compré dieciocho huevos', 'compre 18 huevos'), null);
  assert.equal(validate('queda poquita whey, casi nada', 'queda poco whey'), null);
  assert.notEqual(validate('se me acabó la leche', 'se acabo huevos'), null);
  assert.notEqual(validate('compré huevos', 'compre 18 huevos'), null);
  assert.notEqual(validate('se acabó la leche', 'compre 2 l leche'), null);
  assert.notEqual(validate('¿queda leche?', 'hay leche'), null);
});

test('a pantry change stays in the pantry now, whatever day the sentence mentions', () => {
  const parsed = interpretedCommand('ayer compré 12 huevos', 'compre 12 huevos', today, 'lb');
  assert.ok(parsed.ok);
  assert.equal(parsed.date, today);
  assert.equal(commandLine(parsed.command), 'compre 12 huevos');
});
