import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  extractQuestionDate,
  readQuestion,
  resolveQuestionDates,
  type ReadRequest,
} from './questions.ts';

const TODAY = '2026-10-04';
const ask = (text: string, previous: ReadRequest | null = null) =>
  readQuestion(text, previous, TODAY);

test('protein read phrases work offline regardless of punctuation and common spelling mistakes', () => {
  for (const text of [
    'proteina consumida ayer',
    '¿Proteína consumida ayer?',
    'cuanta proteina consumi ayer',
    'protenia de ayer',
  ]) {
    assert.deepEqual(ask(text), { question: 'proteina', exercise: null, date: 'ayer' });
  }
});

test('a load record is distinct from an explicitly requested estimate', () => {
  assert.deepEqual(ask('máximo levantamiento en press banca'), {
    question: 'marca',
    exercise: 'press banca',
    date: null,
  });
  assert.deepEqual(ask('mi mejor press inclinado'), {
    question: 'marca',
    exercise: 'press inclinado',
    date: null,
  });
  assert.deepEqual(ask('1RM estimado de press inclinado'), {
    question: 'e1rm',
    exercise: 'press inclinado',
    date: null,
  });
});

test('followups retain the question and change only the requested date or equipment', () => {
  const protein = ask('proteina consumida hoy')!;
  assert.deepEqual(ask('y ayer', protein), { ...protein, date: 'ayer' });
  const mark = ask('mi mejor press banca')!;
  assert.deepEqual(ask('y con mancuernas', mark), {
    ...mark,
    exercise: 'press banca con mancuernas',
  });
  assert.equal(ask('y ayer'), null);
});

test('statements that can be writes are never classified as reads', () => {
  for (const text of [
    'agua 710',
    'peso 74.2',
    'ayer dormí seis horas',
    'me tomé 710 ml de agua',
    'ya tomé la creatina',
    'hice una serie de 90x8',
    'anota 20 gramos de proteína',
    'no tomé creatina',
  ]) {
    assert.equal(ask(text), null, text);
  }
});

test('past-day nutrition, daily values and recipe requests are separate intents', () => {
  assert.equal(ask('que comi ayer')?.question, 'nutricion');
  assert.equal(ask('cuanto dormi ayer')?.question, 'sueno');
  assert.equal(ask('¿tomé la creatina ayer?')?.question, 'creatina');
  assert.equal(ask('que tengo en la despensa')?.question, 'despensa');
  assert.equal(ask('dame una receta alta en proteina con pollo')?.question, 'receta');
});

test('explicit unknown dates are retained so the reader cannot fall back to today', () => {
  assert.equal(ask('proteina del 31 de febrero')?.date, '31 de febrero');
  assert.equal(ask('proteina el dia de mi cumpleaños')?.date, 'el dia de mi cumpleanos');
  assert.equal(resolveQuestionDates('31 de febrero', TODAY), null);
  assert.equal(resolveQuestionDates('el dia de mi cumpleanos', TODAY), null);
});

test('natural and explicit ranges respect calendar boundaries', () => {
  assert.deepEqual(resolveQuestionDates('esta semana', TODAY), { from: '2026-09-28', to: TODAY });
  assert.deepEqual(resolveQuestionDates('la semana pasada', TODAY), {
    from: '2026-09-21',
    to: '2026-09-27',
  });
  assert.deepEqual(resolveQuestionDates('ultimos 7 dias', TODAY), {
    from: '2026-09-28',
    to: TODAY,
  });
  assert.deepEqual(resolveQuestionDates('mes pasado', '2027-01-02'), {
    from: '2026-12-01',
    to: '2026-12-31',
  });
  assert.deepEqual(resolveQuestionDates('del 22 de septiembre al 25 de septiembre', TODAY), {
    from: '2026-09-22',
    to: '2026-09-25',
  });
  assert.deepEqual(resolveQuestionDates('entre ayer y hoy', TODAY), {
    from: '2026-10-03',
    to: TODAY,
  });
  assert.equal(resolveQuestionDates('entre hoy y ayer', TODAY), null);
  assert.equal(ask('proteina de la semana pasada')?.date, 'la semana pasada');
});

test('quantities do not become calendar dates and explicit impossible dates remain visible', () => {
  for (const phrase of [
    '9000 pasos',
    '6 horas de sueño',
    '40 gramos de proteína',
    '2 series de press',
  ]) {
    assert.equal(extractQuestionDate(phrase, TODAY), null, phrase);
  }
  assert.equal(extractQuestionDate('6 horas de sueño el 31 de febrero', TODAY), '31 de febrero');
  assert.equal(extractQuestionDate('proteína 22 sept', TODAY), '22 sept');
});

test('polite requests to write are not reads even with question punctuation', () => {
  for (const phrase of [
    '¿Puedes anotar 9000 pasos?',
    '¿Puedes anotarme agua 500?',
    '¿Podrías registrar 6 horas de sueño?',
    '¿Me guardas el peso de 70 kg?',
    '¿Agregas 500 ml de agua?',
  ]) {
    assert.equal(ask(phrase), null, phrase);
  }
  assert.equal(ask('¿Cuántos pasos registré ayer?')?.question, 'pasos');
  assert.equal(ask('¿Tomé creatina ayer?')?.question, 'creatina');
});

test('an explicit topic follow-up keeps the day until the user changes it', () => {
  const protein = ask('proteína consumida ayer')!;
  assert.deepEqual(ask('y calorías', protein), {
    question: 'nutricion',
    exercise: null,
    date: 'ayer',
  });
  assert.deepEqual(ask('y agua', protein), { question: 'agua', exercise: null, date: 'ayer' });
  assert.deepEqual(ask('y agua hoy', protein), { question: 'agua', exercise: null, date: 'hoy' });
  assert.deepEqual(ask('agua consumida', protein), {
    question: 'agua',
    exercise: null,
    date: null,
  });
});

test('pantry statements stay writes while pantry questions stay reads', () => {
  assert.equal(ask('compré 18 huevos para la despensa'), null);
  assert.equal(ask('se acabó la leche de la nevera'), null);
  assert.equal(ask('queda poca whey en la despensa'), null);
  assert.equal(ask('qué queda en mi despensa')?.question, 'despensa');
});

test('record questions and equipment follow-ups keep dates out of exercise names', () => {
  assert.deepEqual(ask('¿cuándo fue mi máximo press banca?'), {
    question: 'marca',
    exercise: 'press banca',
    date: null,
  });
  const previous = ask('máximo press banca ayer')!;
  assert.deepEqual(ask('y con barra hoy', previous), {
    question: 'marca',
    exercise: 'press banca con barra',
    date: 'hoy',
  });
  const inclined = ask('máximo press inclinado con mancuernas')!;
  assert.equal(ask('y con barra', inclined)?.exercise, 'press inclinado con barra');
  const barbell = ask('máximo press plano con barra')!;
  assert.equal(ask('y inclinado', barbell)?.exercise, 'press con barra inclinado');
});

test('impossible relative dates refuse without overflowing the calendar', () => {
  const phrase = 'proteína hace 999999999999999999 días';
  assert.equal(resolveQuestionDates(ask(phrase)!.date, TODAY), null);
});
