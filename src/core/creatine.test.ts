import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EMPTY_DAYS,
  FILL_DAYS,
  readSaturation,
  saturationSeries,
  sayLevel,
  type CreatineDay,
} from './creatine.ts';
import { addDays } from './dates.ts';

function run(taken: boolean[], start = '2026-01-01'): CreatineDay[] {
  return taken.map((value, index) => ({ date: addDays(start, index), taken: value }));
}

function last(days: CreatineDay[], until?: string): number {
  const series = saturationSeries(days, until ?? days[days.length - 1].date);
  return series[series.length - 1].value;
}

test('veintiocho dias seguidos la dejan llena, como midio Hultman', () => {
  const level = last(run(Array(FILL_DAYS).fill(true)));
  assert.ok(level > 0.94, `llego a ${level}`);
  assert.ok(level <= 1);
});

test('treinta dias sin tomarla la dejan como al principio', () => {
  const days = [
    ...run(Array(FILL_DAYS).fill(true)),
    ...run(Array(EMPTY_DAYS).fill(false), '2026-01-29'),
  ];
  const level = last(days);
  assert.ok(level < 0.06, `quedo en ${level}`);
});

test('un dia suelto sin tomarla no tira el deposito abajo', () => {
  const full = last(run(Array(FILL_DAYS).fill(true)));
  const withGap = last([
    ...run(Array(FILL_DAYS).fill(true)),
    { date: '2026-01-29', taken: false },
    { date: '2026-01-30', taken: true },
  ]);
  assert.ok(withGap > full - 0.1, `paso de ${full} a ${withGap}`);
  assert.ok(withGap > 0.85);
});

test('un dia si y uno no se queda a medio camino, no lleno', () => {
  // Se estabiliza en dos tercios: lo que entra un dia es lo que se pierde al siguiente.
  const alternating = Array.from({ length: 60 }, (_, index) => index % 2 === 0);
  const level = last(run(alternating));
  assert.ok(level > 0.55 && level < 0.75, `se quedo en ${level}`);
});

test('fallar un dia a la semana casi no se nota; fallar dos, si', () => {
  const sixOfSeven = Array.from({ length: 56 }, (_, index) => index % 7 < 6);
  const fiveOfSeven = Array.from({ length: 56 }, (_, index) => index % 7 < 5);
  assert.ok(last(run(sixOfSeven)) > 0.88);
  assert.ok(last(run(fiveOfSeven)) > 0.78);
  assert.ok(last(run(fiveOfSeven)) < last(run(sixOfSeven)));
});

test('los dias que nadie anoto cuentan como no tomada', () => {
  // Dos semanas tomandola, y despues un mes de silencio: el deposito baja igual.
  const days = run(Array(14).fill(true));
  const quiet = last(days, '2026-02-20');
  assert.ok(quiet < last(days), 'el silencio no deja el deposito quieto');
});

test('la lectura dice si sube o baja y cuantos dias seguidos lleva', () => {
  const days = run([...Array(20).fill(true), ...Array(3).fill(false)]);
  const reading = readSaturation(saturationSeries(days, days[days.length - 1].date), days);

  assert.ok(reading !== null);
  assert.equal(reading.trend, 'bajando');
  assert.equal(reading.streak, -3);

  const rising = run(Array(10).fill(true));
  const up = readSaturation(saturationSeries(rising, rising[rising.length - 1].date), rising);
  assert.equal(up?.trend, 'subiendo');
  assert.equal(up?.streak, 10);
});

test('sin un solo dia anotado no hay nada que estimar', () => {
  assert.deepEqual(saturationSeries([], '2026-02-01'), []);
  assert.equal(readSaturation([], []), null);
});

test('cada tramo del deposito se dice con palabras', () => {
  assert.match(sayLevel(0.95), /llena/);
  assert.match(sayLevel(0.75), /casi llena/);
  assert.match(sayLevel(0.5), /medio llenar/);
  assert.match(sayLevel(0.2), /baja/);
  assert.match(sayLevel(0.02), /vacía/);
});
