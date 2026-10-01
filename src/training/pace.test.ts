import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clockFace, finishingAt, usualMinutes, type PastSession } from './pace.ts';

const PULL: Omit<PastSession, 'minutes' | 'trusted'> = {
  gymId: 'fanshawe',
  routineId: 'pull',
  budget: 'completo',
};

function session(minutes: number, trusted = true, extra: Partial<PastSession> = {}): PastSession {
  return { ...PULL, minutes, trusted, ...extra };
}

test('solo cuentan las sesiones cuyo tiempo marco como bueno', () => {
  const sessions = [session(80), session(600, false), session(82), session(78)];
  assert.equal(usualMinutes(sessions, PULL), 80);
});

test('un dia de otro tipo no entra en el promedio de este', () => {
  const sessions = [
    session(80),
    session(40, true, { routineId: 'push' }),
    session(40, true, { gymId: 'fit4less-proudfoot' }),
    session(40, true, { budget: 'express' }),
  ];
  assert.equal(usualMinutes(sessions, PULL), 80);
});

test('la mediana aguanta el dia que se quedo charlando', () => {
  // La media de esto es 103; la mediana, 83.
  assert.equal(usualMinutes([session(78), session(81), session(84), session(170)], PULL), 83);
});

test('sin ninguna sesion de ese tipo no se inventa un numero', () => {
  assert.equal(usualMinutes([], PULL), null);
  assert.equal(usualMinutes([session(80, false)], PULL), null);
  assert.equal(usualMinutes([session(80, true, { routineId: 'push' })], PULL), null);
});

test('el reloj se lee como lo dice en voz alta', () => {
  assert.equal(clockFace(81), '01h21m');
  assert.equal(clockFace(60), '01h00m');
  assert.equal(clockFace(48), '48m');
  assert.equal(clockFace(0), '0m');
});

test('la hora de salir sale de cuando empezo', () => {
  const started = new Date(2026, 8, 30, 18, 30).getTime();
  assert.equal(finishingAt(started, 81), '19:51');
  assert.equal(finishingAt(started, 30), '19:00');
});
