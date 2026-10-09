import assert from 'node:assert/strict';
import { test } from 'node:test';

import { afterFailedLoad, reloadQueue, showsAnotherDay, type LoadState } from './load-state.ts';

test('una recarga que falla con la app abierta deja lo que habia y dice por que', () => {
  const open: LoadState<string> = { phase: 'ready', loaded: 'lo de hoy', problem: null };

  assert.deepEqual(afterFailedLoad(open, 'batch b points at food f, which is gone'), {
    phase: 'ready',
    loaded: 'lo de hoy',
    problem: 'batch b points at food f, which is gone',
  });
});

test('al volver a la app en un dia nuevo, lo cargado es de ayer y hay que recargar', () => {
  const lastNight = { today: { date: '2026-09-30' } };

  assert.equal(showsAnotherDay(lastNight, '2026-10-01'), true);
  // El mismo dia no paga una recarga cada vez que vuelve a la app.
  assert.equal(showsAnotherDay(lastNight, '2026-09-30'), false);
  // Sin nada cargado todavia no hay nada viejo que cambiar: la carga ya viene en camino.
  assert.equal(showsAnotherDay(null, '2026-10-01'), false);
});

test('una carga que nunca salio bien muestra el panel de error', () => {
  const opening: LoadState<string> = { phase: 'opening' };

  assert.deepEqual(afterFailedLoad(opening, 'no such table: core_setting'), {
    phase: 'failed',
    message: 'no such table: core_setting',
  });
});

test('una recarga que termina despues de una botella nueva no pisa la pantalla', async () => {
  // Cada carga lee el agua cuando empieza, como load(), y termina cuando se le dice.
  let water = 1420;
  const started: { settle: boolean; finish: () => void }[] = [];
  const shown: number[] = [];
  const request = reloadQueue(
    (settle) =>
      new Promise<number>((resolve) => {
        const seen = water;
        started.push({ settle, finish: () => resolve(seen) });
      }),
    (result) => shown.push(result),
    (error) => assert.fail(String(error)),
    (a, b) => a || b,
    () => false,
  );
  const settled = () => new Promise((resolve) => setImmediate(resolve));

  // Cerrar el aviso de ofertas pide la larga; la botella llega mientras corre, y despues
  // un segundo ajuste.
  request(true);
  water = 2130;
  request(false);
  request(false);
  assert.equal(started.length, 1, 'una sola carga a la vez');

  started[0].finish();
  await settled();
  // Lo que leyo antes de la botella no se pinta, y las dos que se pidieron mientras van en
  // una sola mas, sin el trabajo de fondo porque ninguna de esas lo pedia.
  assert.deepEqual(shown, []);
  assert.equal(started.length, 2);
  assert.equal(started[1].settle, false);

  started[1].finish();
  await settled();
  assert.deepEqual(shown, [2130]);
});

test('si alguna de las que esperan pide el trabajo de fondo, la siguiente lo hace', async () => {
  const started: { settle: boolean; finish: () => void }[] = [];
  const request = reloadQueue(
    (settle) => new Promise<void>((resolve) => started.push({ settle, finish: resolve })),
    () => undefined,
    (error) => assert.fail(String(error)),
    (a, b) => a || b,
    () => false,
  );

  request(false);
  request(false);
  request(true);
  request(false);
  started[0].finish();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(started.length, 2);
  assert.equal(started[1].settle, true);
});

test('una carga que falla deja correr la que esperaba', async () => {
  const failures: unknown[] = [];
  const shown: string[] = [];
  let calls = 0;
  const request = reloadQueue(
    () => (++calls === 1 ? Promise.reject(new Error('locked')) : Promise.resolve('bien')),
    (result) => shown.push(result),
    (error) => failures.push(error),
    (a, b) => a || b,
    () => false,
  );

  request(false);
  request(false);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(failures.length, 1);
  assert.deepEqual(shown, ['bien']);
});

test('lo que leia una carga tirada lo vuelve a leer la siguiente', async () => {
  type Ask = { deals: boolean };
  const started: { ask: Ask; finish: () => void }[] = [];
  const request = reloadQueue<Ask, void>(
    (ask) => new Promise<void>((resolve) => started.push({ ask, finish: resolve })),
    () => undefined,
    (error) => assert.fail(String(error)),
    (a, b) => ({ deals: a.deals || b.deals }),
    (ask) => ask,
  );

  // Bajar las ofertas pide releerlas; una botella llega mientras y esa carga se tira.
  request({ deals: true });
  request({ deals: false });
  started[0].finish();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(started[1].ask, { deals: true });
});

test('refresh completion waits for the replacement read when its first result becomes stale', async () => {
  const complete: (() => void)[] = [];
  const painted: string[] = [];
  const queue = reloadQueue(
    () => new Promise<string>((resolve) => complete.push(() => resolve('fresh'))),
    (value) => {
      painted.push(value);
    },
    () => assert.fail('unexpected failure'),
    () => false,
    () => false,
  );
  let done = 0;
  const first = queue(false).then((result) => {
    assert.equal(result.ok, true);
    done++;
  });
  const second = queue(false).then((result) => {
    assert.equal(result.ok, true);
    done++;
  });
  complete[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(done, 0);
  assert.deepEqual(painted, []);
  complete[1]();
  await Promise.all([first, second]);
  assert.equal(done, 2);
  assert.deepEqual(painted, ['fresh']);
});

test('a failed refresh reports failure without completing a newer pending refresh', async () => {
  let refuse!: (error: Error) => void;
  let finish!: () => void;
  let calls = 0;
  const error = new Error('database unavailable');
  const queue = reloadQueue(
    () =>
      ++calls === 1
        ? new Promise<void>((_resolve, reject) => {
            refuse = reject;
          })
        : new Promise<void>((resolve) => {
            finish = resolve;
          }),
    () => {},
    () => {},
    () => false,
    () => false,
  );
  const first = queue(false);
  let done = false;
  const second = queue(false).then((result) => {
    done = true;
    return result;
  });
  refuse(error);
  assert.deepEqual(await first, { ok: false, error });
  assert.equal(done, false);
  finish();
  assert.deepEqual(await second, { ok: true });
});
