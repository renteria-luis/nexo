import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  centsPerKgFromText,
  dealPack,
  gramsFromText,
  localDate,
  normaliseUnit,
  packFromText,
} from './parse.ts';

test('la unidad se queda en una de las que el modulo entiende', () => {
  assert.equal(normaliseUnit('/lb'), 'lb');
  assert.equal(normaliseUnit('lb.'), 'lb');
  assert.equal(normaliseUnit('  KG '), 'kg');
  assert.equal(normaliseUnit('each'), 'ea');
  assert.equal(normaliseUnit('ea.'), 'ea');
  assert.equal(normaliseUnit('/pkg'), 'ea');
  assert.equal(normaliseUnit('100 g'), '100g');
  // Ese hueco lo usan tambien para cosas que no son unidades.
  assert.equal(normaliseUnit('scene+ member pricing'), null);
  assert.equal(normaliseUnit('on sale for'), null);
  assert.equal(normaliseUnit(null), null);
});

test('el peso sale del texto cuando esta escrito', () => {
  assert.equal(gramsFromText('SEASONED CHICKEN BREAST, 4 KG'), 4000);
  assert.equal(gramsFromText('Yogurt griego 500g'), 500);
  assert.equal(gramsFromText('pechuga 1.36 kg'), 1360);
  assert.equal(gramsFromText('carne molida 2 lb'), 907);
  // Un paquete de varios cuenta el total.
  assert.equal(gramsFromText('12 x 100 g'), 1200);
  // Sin peso no se inventa uno.
  assert.equal(gramsFromText("PC BONELESS SKINLESS CHICKEN BREASTS, 6'S"), null);
  assert.equal(gramsFromText(''), null);
});

test('el precio por kilo de la letra chica se lee tal cual', () => {
  assert.equal(centsPerKgFromText('skin-on, bone-in\n11.00/kg'), 1100);
  assert.equal(centsPerKgFromText('$8.80 / kg'), 880);
  // Por libra se convierte a kilo, que es la unidad con la que compara la app.
  assert.equal(centsPerKgFromText('4.99/lb'), 1100);
  assert.equal(centsPerKgFromText('sin precio'), null);
});

test('el tamano de una oferta junta la unidad, el titulo y la letra chica', () => {
  assert.deepEqual(dealPack('Pechuga', null, '/lb'), { grams: 454 });
  assert.deepEqual(dealPack('Pechuga', null, 'kg'), { grams: 1000 });
  assert.deepEqual(dealPack('SEASONED CHICKEN BREAST, 4 KG', null, null), { grams: 4000 });
  assert.deepEqual(dealPack('Pechuga', 'bandeja de 900 g', 'ea'), { grams: 900 });
  assert.equal(dealPack('Pechuga', null, 'ea'), null);

  // Los dos casos que salieron mal en el folleto de Food Basics: el nombre se queda
  // corto y el tamano vive en la descripcion.
  assert.deepEqual(dealPack('SELECTION LARGE EGGS', "18'S", 'ea'), { count: 18 });
  assert.deepEqual(dealPack('LACTANTIA PURFILTRE MILK', '1%, 2%, SKIMMED\n4 L', 'ea'), {
    millilitres: 4000,
  });
});

test('el paquete se lee en unidades, litros o gramos', () => {
  assert.deepEqual(packFromText('18 PK'), { count: 18 });
  assert.deepEqual(packFromText('12 un.'), { count: 12 });
  assert.deepEqual(packFromText('pack of 6'), { count: 6 });
  assert.deepEqual(packFromText('750 ml'), { millilitres: 750 });
  assert.deepEqual(packFromText('2 x 1.89 L'), { millilitres: 3780 });
  assert.deepEqual(packFromText('500g'), { grams: 500 });
  // El peso manda sobre la cuenta: "4 kg" es mas util que "4".
  assert.deepEqual(packFromText('4 KG'), { grams: 4000 });
  assert.equal(packFromText('selected varieties'), null);
});

test('una oferta acaba el dia que acaba en sus tiendas, no el dia de UTC', () => {
  // Las dos horas con las que Flipp manda el final: medianoche en Ontario en horario de
  // verano y en horario de invierno, dichas en UTC.
  assert.equal(localDate('2026-10-07T03:59:59+00:00'), '2026-10-06');
  assert.equal(localDate('2026-11-12T04:59:59+00:00'), '2026-11-11');
  // El principio ya salia bien, y tiene que seguir saliendo.
  assert.equal(localDate('2026-10-01T04:00:00+00:00'), '2026-10-01');
  assert.equal(localDate(null), null);
  assert.equal(localDate('mañana'), null);
});
