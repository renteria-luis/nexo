import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ago, dealsDue, sourceStatus } from './deals.ts';

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

test('una recoleccion de hace cuatro dias no se pinta como al dia', () => {
  const now = Date.UTC(2026, 8, 25, 12);
  const hours = (count: number) => now - count * 3_600_000;
  const flipp = { name: 'Flipp', health: 'ok' as const };

  // Del 21 al 24 de septiembre el colector fallo y la descarga seguia diciendo "al dia".
  assert.deepEqual(sourceStatus({ ...flipp, last_success_at: hours(4 * 24 + 3) }, now), {
    line: 'Flipp: sin datos nuevos desde hace 4 días',
    silent: true,
  });
  assert.deepEqual(sourceStatus({ ...flipp, last_success_at: hours(10) }, now), {
    line: 'Flipp: al día, última vez hace 10 h',
    silent: false,
  });
  assert.equal(
    sourceStatus({ ...flipp, last_success_at: hours(37) }, now).line,
    'Flipp: sin datos nuevos desde hace 1 día',
  );
  assert.equal(sourceStatus({ ...flipp, last_success_at: null }, now).silent, true);
  // Sin conexion un rato no es que el colector se callara.
  assert.deepEqual(sourceStatus({ ...flipp, health: 'down', last_success_at: hours(5) }, now), {
    line: 'Flipp: no se pudo actualizar, última vez hace 5 h',
    silent: false,
  });
  assert.equal(ago(hours(30), now), 'hace 1 día');
});
