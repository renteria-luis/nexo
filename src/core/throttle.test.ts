import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { throttled } from './throttle.ts';

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

test('lo pedido dentro del medio minuto corre al final, una vez y con lo ultimo', () => {
  let clock = 0;
  const runs: string[] = [];
  const sync = throttled(
    (what: string) => runs.push(what),
    30_000,
    () => clock,
  );

  sync.call('al abrir');
  clock = 20_000;
  sync.call('despues del agua');
  clock = 25_000;
  sync.call('despues del peso');
  assert.deepEqual(runs, ['al abrir']);

  clock = 30_000;
  mock.timers.tick(10_000);
  assert.deepEqual(runs, ['al abrir', 'despues del peso']);

  // Y la espera vuelve a contar desde esa pasada, no desde la primera.
  clock = 45_000;
  sync.call('otra cosa');
  mock.timers.tick(14_999);
  assert.deepEqual(runs, ['al abrir', 'despues del peso']);
  clock = 60_000;
  mock.timers.tick(1);
  assert.deepEqual(runs, ['al abrir', 'despues del peso', 'otra cosa']);
});

test('al irse la app al fondo, lo pendiente corre ya; si no hay nada, no corre nada', () => {
  let clock = 0;
  const runs: string[] = [];
  const sync = throttled(
    (what: string) => runs.push(what),
    30_000,
    () => clock,
  );

  sync.call('al abrir');
  clock = 5_000;
  sync.call('despues del agua');
  sync.flush();
  assert.deepEqual(runs, ['al abrir', 'despues del agua']);

  sync.flush();
  mock.timers.tick(60_000);
  assert.deepEqual(runs, ['al abrir', 'despues del agua']);
});
