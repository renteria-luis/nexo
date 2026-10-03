import assert from 'node:assert/strict';
import { test } from 'node:test';

import { afterFailedLoad, showsAnotherDay, type LoadState } from './load-state.ts';

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
