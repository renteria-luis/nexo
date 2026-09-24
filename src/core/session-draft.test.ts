import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDraft, serializeDraft, type SessionDraft } from './session-draft.ts';

const draft: SessionDraft = {
  sessionId: 'session-2026-09-23-1',
  exerciseId: 'incline-curl',
  weight: '25',
  reps: '10',
  rpe: '8',
  implement: 'dumbbell',
};

test('lo que quedo escrito vuelve tal cual', () => {
  assert.deepEqual(parseDraft(serializeDraft(draft), draft.sessionId), draft);
});

test('un borrador de otra sesion no se arrastra al entreno de hoy', () => {
  assert.equal(parseDraft(serializeDraft(draft), 'session-2026-09-24-1'), null);
  assert.equal(parseDraft(serializeDraft(draft), null), null);
});

test('un ajuste roto no tumba el arranque', () => {
  assert.equal(parseDraft('{no es json', 'session-2026-09-23-1'), null);
  assert.equal(parseDraft('null', 'session-2026-09-23-1'), null);
  assert.equal(parseDraft(undefined, 'session-2026-09-23-1'), null);
});

test('los campos que no son texto se descartan sin romper el resto', () => {
  const stored = JSON.stringify({ sessionId: draft.sessionId, weight: 25, reps: '10' });
  assert.deepEqual(parseDraft(stored, draft.sessionId), {
    sessionId: draft.sessionId,
    exerciseId: null,
    weight: null,
    reps: '10',
    rpe: null,
    implement: null,
  });
});
