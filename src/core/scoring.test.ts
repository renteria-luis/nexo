import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alongCurve, dayScore, type CurvePoint } from './scoring.ts';

const CURVE: readonly CurvePoint[] = [
  { at: 0, fraction: 0 },
  { at: 10, fraction: 0.5 },
  { at: 20, fraction: 1 },
];

test('la curva da el valor exacto en sus puntos', () => {
  assert.equal(alongCurve(0, CURVE), 0);
  assert.equal(alongCurve(10, CURVE), 0.5);
  assert.equal(alongCurve(20, CURVE), 1);
});

test('entre dos puntos la curva va en linea recta', () => {
  assert.equal(alongCurve(5, CURVE), 0.25);
  assert.equal(alongCurve(15, CURVE), 0.75);
});

test('fuera de los extremos la curva se queda en el extremo', () => {
  assert.equal(alongCurve(-40, CURVE), 0);
  assert.equal(alongCurve(200, CURVE), 1);
});

test('un tramo plano se queda plano', () => {
  const flat: readonly CurvePoint[] = [
    { at: 0, fraction: 0 },
    { at: 10, fraction: 0 },
    { at: 20, fraction: 1 },
  ];
  assert.equal(alongCurve(5, flat), 0);
  assert.equal(alongCurve(15, flat), 0.5);
});

test('una curva mal escrita se queja en vez de dar un numero raro', () => {
  assert.throws(() => alongCurve(1, []), /at least one point/);
  assert.throws(
    () =>
      alongCurve(1, [
        { at: 10, fraction: 0 },
        { at: 5, fraction: 1 },
      ]),
    /has to climb/,
  );
  assert.throws(() => alongCurve(1, [{ at: 0, fraction: 1.5 }]), /outside 0 to 1/);
});

test('la nota del dia se queda con un decimal', () => {
  const criteria = [
    { id: 'a', weight: 75.44, fraction: 1 },
    { id: 'b', weight: 24.56, fraction: 0 },
  ];
  assert.equal(dayScore(criteria).score, 75.4);

  // Y un dia casi perfecto no se convierte en un cien: el cien es el dia entero.
  const almost = [
    { id: 'a', weight: 99.2, fraction: 1 },
    { id: 'b', weight: 0.8, fraction: 0 },
  ];
  assert.equal(dayScore(almost).score, 99.2);
  assert.equal(dayScore([{ id: 'a', weight: 100, fraction: 1 }]).score, 100);
});
