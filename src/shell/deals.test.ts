import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dealsDue } from './deals.ts';

const HOUR = 60 * 60 * 1000;
const NOW = new Date(2026, 9, 3, 8, 0).getTime();

test('la recoleccion se baja sola cuando la guardada ya no es de hoy', () => {
  // Nunca bajada, o de ayer a esta hora: toca.
  assert.equal(dealsDue(null, null, NOW), true);
  assert.equal(dealsDue(NOW - 21 * HOUR, null, NOW), true);
  // La de esta madrugada ya es la de hoy.
  assert.equal(dealsDue(NOW - 2 * HOUR, null, NOW), false);
});

test('sin conexion no se insiste cada vez que vuelve a la app, pero se vuelve a probar', () => {
  assert.equal(dealsDue(NOW - 30 * HOUR, NOW - 10 * 60 * 1000, NOW), false);
  assert.equal(dealsDue(NOW - 30 * HOUR, NOW - 2 * HOUR, NOW), true);
});
