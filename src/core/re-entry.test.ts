import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startsOnItsOwn } from './re-entry.ts';

const never = { startedOn: null, weeks: 3 };

test('una semana de entrenos pendientes sin ninguno enciende la readaptacion', () => {
  assert.equal(startsOnItsOwn(never, '2026-10-10', '2026-09-30', 7), true);
  assert.equal(startsOnItsOwn(never, '2026-10-10', '2026-09-30', 6), false);
});

test('sin ningun entreno antes no hay nada de que readaptarse', () => {
  assert.equal(startsOnItsOwn(never, '2026-10-10', null, 40), false);
});

test('una readaptacion ya en curso no se reinicia', () => {
  const running = { startedOn: '2026-10-05', weeks: 3 };
  assert.equal(startsOnItsOwn(running, '2026-10-10', '2026-09-27', 12), false);
});

test('si termino sin que volviera a entrenar, la misma parada no abre otra', () => {
  const ended = { startedOn: '2026-10-05', weeks: 3 };
  assert.equal(startsOnItsOwn(ended, '2026-10-27', '2026-09-27', 25), false);
  // Volvio el 28 de octubre y paro otra vez: esa es otra parada.
  assert.equal(startsOnItsOwn(ended, '2026-11-08', '2026-10-28', 7), true);
});
