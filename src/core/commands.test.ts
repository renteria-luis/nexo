import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateFrom, parseCommand, setLoggedReply } from './commands.ts';

test('natural date phrases retain their intended calendar day', () => {
  assert.equal(dateFrom('29 de septiembre', '2026-10-03'), '2026-09-29');
  assert.equal(dateFrom('29 de septiembre 2025', '2026-10-03'), '2025-09-29');
  assert.equal(dateFrom('el martes', '2026-10-03'), '2026-09-29');
  assert.equal(dateFrom('martes', '2026-09-29'), '2026-09-22');
  assert.equal(dateFrom('el miércoles', '2027-01-01'), '2026-12-30');
  assert.equal(dateFrom('anoche', '2027-01-01'), '2026-12-31');
  assert.equal(dateFrom('31 de febrero', '2026-10-03'), null);
  assert.equal(dateFrom('algún día', '2026-10-03'), null);
  const parsed = parseCommand('25 de setiembre 2025 pasos 5000', '2026-10-03');
  assert.ok(parsed.ok);
  assert.equal(parsed.date, '2025-09-25');
});

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
  assert.equal(on('peso 74.2'), TODAY);
  // "7.4" no se lee como el 7 de abril: es el peso, y se rechaza por serlo.
  assert.match(rejected('peso 7.4'), /^7\.4 kg no es un peso corporal/);
  assert.equal(on('serie 65x8'), TODAY);
  assert.equal(on('creatina no'), TODAY);
  assert.match(rejected('32 set pasos 5000'), /No conozco "32"/);
});

test('una fecha suelta, sin comando, para las preguntas', () => {
  assert.equal(dateFrom('ayer', TODAY), '2026-09-27');
  assert.equal(dateFrom('25 set', TODAY), '2026-09-25');
  assert.equal(dateFrom('el martes', TODAY), '2026-09-22');
  assert.equal(dateFrom('', TODAY), null);
});

test('un peso corporal imposible se rechaza, como en el campo de Hoy', () => {
  // Spec 20.3 usa justo este ejemplo: antes se guardaba y movia las metas.
  assert.match(rejected('peso 742'), /742 kg no es un peso corporal/);
  assert.match(rejected('peso 7.4'), /7\.4 kg no es un peso corporal/);
  assert.match(rejected('ayer peso 12'), /no es un peso corporal/);
  assert.deepEqual(ok('peso 30'), { kind: 'weight', value: 30 });
  assert.deepEqual(ok('peso 250'), { kind: 'weight', value: 250 });
});

test('la serie anotada por el asistente dice en que ejercicio cayo', () => {
  assert.equal(
    setLoggedReply(65, 'lb', 8, 'Elevaciones laterales'),
    'Serie de 65 lb por 8 anotada en Elevaciones laterales',
  );
});

test('the pantry changes he says out loud parse as he says them, with no date', () => {
  const pantry = (input: string) => {
    const command = ok(input);
    assert.equal(command.kind, 'pantry', input);
    assert.equal(on(input), TODAY, input);
    return command.kind === 'pantry'
      ? [command.action, command.amount, command.unit, command.item]
      : null;
  };
  assert.deepEqual(pantry('compré 18 huevos'), ['add', 18, null, 'huevos']);
  assert.deepEqual(pantry('compre 2 kg de arroz'), ['add', 2, 'kg', 'arroz']);
  assert.deepEqual(pantry('compre 1,5l leche'), ['add', 1.5, 'l', 'leche']);
  assert.deepEqual(pantry('quedan 6 huevos'), ['set', 6, null, 'huevos']);
  assert.deepEqual(pantry('hay 3 latas de atún'), ['set', 3, null, 'latas de atun']);
  assert.deepEqual(pantry('se acabó la leche'), ['out', null, null, 'leche']);
  assert.deepEqual(pantry('no hay aceite de oliva'), ['out', null, null, 'aceite de oliva']);
  assert.deepEqual(pantry('queda poca whey'), ['low', null, null, 'whey']);
  assert.deepEqual(pantry('hay sal'), ['have', null, null, 'sal']);
  // A pantry item is never read as a date: this is mayonnaise, not the first of May.
  assert.deepEqual(pantry('compre 1 mayo'), ['add', 1, null, 'mayo']);
});

test('a pantry change that cannot be written says why', () => {
  const reason = (input: string) => {
    const parsed = parseCommand(input, TODAY);
    assert.ok(!parsed.ok, `"${input}" should be refused`);
    return parsed.reason;
  };
  assert.match(reason('quedan huevos'), /Cuanto queda/);
  assert.match(reason('compre'), /Que cosa/);
  assert.match(reason('compre 0 huevos'), /cero/);
  assert.match(reason('queda poca 3 whey'), /Sin cantidad/);
  assert.match(reason('compre 2tz arroz'), /No conozco la unidad "tz"/);
  assert.match(reason('ayer compre 18 huevos'), /sin fecha/);
});
