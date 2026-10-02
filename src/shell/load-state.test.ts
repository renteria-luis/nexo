import assert from 'node:assert/strict';
import { test } from 'node:test';

import { afterFailedLoad, type LoadState } from './load-state.ts';

test('una recarga que falla con la app abierta deja lo que habia y dice por que', () => {
  const open: LoadState<string> = { phase: 'ready', loaded: 'lo de hoy', problem: null };

  assert.deepEqual(afterFailedLoad(open, 'batch b points at food f, which is gone'), {
    phase: 'ready',
    loaded: 'lo de hoy',
    problem: 'batch b points at food f, which is gone',
  });
});

test('una carga que nunca salio bien muestra el panel de error', () => {
  const opening: LoadState<string> = { phase: 'opening' };

  assert.deepEqual(afterFailedLoad(opening, 'no such table: core_setting'), {
    phase: 'failed',
    message: 'no such table: core_setting',
  });
});
