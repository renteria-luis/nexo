import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EMPTY_DAYS,
  FILL_DAYS,
  FULL_LEVEL,
  fillProjection,
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

test('the reading says the day it fills, taking it daily, or nothing once it is full', () => {
  const week = run(Array(7).fill(true));
  const series = saturationSeries(week, week[week.length - 1].date);
  const projection = fillProjection(series);
  const reading = readSaturation(series);
  assert.ok(reading !== null);
  assert.equal(projection[0].date, addDays(series.at(-1)!.date, 1));
  assert.ok(projection.at(-1)!.value >= FULL_LEVEL);
  assert.ok(projection.slice(0, -1).every((day) => day.value < FULL_LEVEL));
  assert.equal(reading.fullOn, projection.at(-1)!.date);
  // From empty, taking it daily reaches the full band in about three weeks.
  assert.ok(fillProjection([{ date: '2026-02-01', value: 0 }]).length <= 28);

  const month = run(Array(40).fill(true));
  const full = readSaturation(saturationSeries(month, month[month.length - 1].date));
  assert.equal(full?.fullOn, null);
});

test('sin un solo dia anotado no hay nada que estimar', () => {
  assert.deepEqual(saturationSeries([], '2026-02-01'), []);
  assert.equal(readSaturation([]), null);
});

test('cada tramo del deposito se dice con palabras, y el dia en que se llena', () => {
  assert.match(sayLevel(0.95, null), /^llena/);
  assert.equal(sayLevel(0.75, '2026-10-20'), 'casi llena: se estima llena el mar 20-oct');
  assert.equal(sayLevel(0.5, '2026-10-25'), 'a medio llenar: se estima llena el dom 25-oct');
  assert.match(sayLevel(0.2, '2026-11-01'), /^baja: se estima llena/);
  assert.match(sayLevel(0.02, '2026-11-02'), /^vacía: se estima llena/);
});
