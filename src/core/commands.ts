// La consola del nucleo: una linea escrita en vez de cuatro toques.
//
// Solo se entiende lo que esta aqui. Un comando que no se reconoce no escribe nada y
// dice por que, porque lo contrario seria guardar algo distinto de lo que escribio y
// enterarse tres semanas despues, cuando el dato ya esta en la cuadricula.
//
// El parser no toca la base ni sabe de unidades: devuelve que quiso decir, y quien lo
// ejecuta decide si "65" son kilos o libras segun su ajuste.
//
// Tambien devuelve a que dia va. Sin fecha escrita es hoy, y si la escribio ("25 set
// pasos 5000", "pasos 5000 ayer") es ese dia: el anio no hace falta porque lo que se
// anota ya paso.

import { addDays, isRealDate, todayIso, type IsoDate } from './dates.ts';

export type Command =
  | { kind: 'water'; ml: number }
  | { kind: 'weight'; value: number }
  | { kind: 'steps'; steps: number }
  | { kind: 'sleep'; minutes: number }
  | { kind: 'creatine'; taken: boolean }
  | { kind: 'set'; weight: number; reps: number; rpe: number | null }
  | { kind: 'help' };

export type ParsedCommand =
  { ok: true; command: Command; date: IsoDate } | { ok: false; reason: string };

export const COMMAND_HELP = [
  'agua 710        suma esos ml al dia',
  'serie 65x8      una serie del ejercicio abierto, rpe8 opcional',
  'peso 74.2       tu peso de hoy en kilos',
  'pasos 8200      los pasos del dia',
  'sueno 7.5h      tambien sueno 130m',
  'creatina        o creatina no',
  '25 set pasos 5000   otro dia: ayer, 25 set, 25/09',
  'ayuda           esta lista',
];

// Los meses como los escribe el: el mes es la primera coincidencia por prefijo, asi
// que "set", "sept" y "setiembre" son el mismo mes y no hay que listar cada forma.
const MONTHS = [
  ['enero', 'ene'],
  ['febrero', 'feb'],
  ['marzo', 'mar'],
  ['abril', 'abr'],
  ['mayo', 'may'],
  ['junio', 'jun'],
  ['julio', 'jul'],
  ['agosto', 'ago'],
  ['septiembre', 'setiembre', 'sep', 'set'],
  ['octubre', 'oct'],
  ['noviembre', 'nov'],
  ['diciembre', 'dic'],
];

function monthNumber(word: string): number | null {
  const index = MONTHS.findIndex((names) => names.some((name) => name.startsWith(word)));
  return index === -1 ? null : index + 1;
}

function iso(year: number, month: number, day: number): IsoDate | null {
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isRealDate(date) ? date : null;
}

/**
 * El anio que no escribio. Sin anio es el de hoy, salvo que eso caiga en el futuro:
 * "25 dic" escrito en septiembre es el diciembre pasado, porque lo que se anota ya paso.
 */
function guessYear(today: IsoDate, month: number, day: number): IsoDate | null {
  const thisYear = Number(today.slice(0, 4));
  const candidate = iso(thisYear, month, day);
  if (candidate === null) return null;
  return candidate <= today ? candidate : iso(thisYear - 1, month, day);
}

function fullYear(raw: string): number {
  const value = Number(raw);
  return raw.length === 2 ? 2000 + value : value;
}

/**
 * La fecha que lleva el comando, si la lleva. Se admite al principio o al final, que es
 * donde sale sola al escribir: "25 set pasos 5000" y "pasos 5000 ayer".
 */
function readDate(words: string[], today: IsoDate): IsoDate | null {
  if (words.length === 0) return null;

  if (words.length === 1) {
    const [word] = words;
    if (word === 'hoy') return today;
    if (word === 'ayer') return addDays(today, -1);
    if (word === 'anteayer') return addDays(today, -2);
    if (/^\d{4}-\d{2}-\d{2}$/.test(word)) return isRealDate(word) ? word : null;

    // 25/09, 25-09, 25/09/2026. El punto no separa una fecha aqui a proposito: "peso
    // 7.4" es un peso, no el siete de abril.
    const slashed = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/.exec(word);
    if (slashed) {
      const day = Number(slashed[1]);
      const month = Number(slashed[2]);
      if (slashed[3]) return iso(fullYear(slashed[3]), month, day);
      return guessYear(today, month, day);
    }
    return null;
  }

  // 25 set, 25 setiembre 2025
  if (words.length <= 3 && /^\d{1,2}$/.test(words[0])) {
    const month = monthNumber(words[1]);
    if (month === null) return null;
    const day = Number(words[0]);
    if (words.length === 2) return guessYear(today, month, day);
    if (/^(\d{2}|\d{4})$/.test(words[2])) return iso(fullYear(words[2]), month, day);
  }

  return null;
}

/**
 * La fecha que dice un trozo de texto suelto, sin comando ninguno: "ayer", "25 set".
 * Null si eso no es una fecha. Spec 20.2 punto 2.
 */
export function dateFrom(input: string, today: IsoDate = todayIso()): IsoDate | null {
  const words = plain(input).split(/\s+/).filter(Boolean);
  return words.length === 0 ? null : readDate(words, today);
}

/** Saca la fecha del principio o del final y devuelve el comando que queda. */
function splitDate(parts: string[], today: IsoDate): { date: IsoDate; rest: string[] } {
  for (let size = Math.min(3, parts.length - 1); size >= 1; size -= 1) {
    const head = readDate(parts.slice(0, size), today);
    if (head !== null) return { date: head, rest: parts.slice(size) };

    const tail = readDate(parts.slice(parts.length - size), today);
    if (tail !== null) return { date: tail, rest: parts.slice(0, parts.length - size) };
  }
  return { date: today, rest: parts };
}

/** Sin tildes y en minusculas, para que "sueño" y "sueno" sean el mismo comando. */
function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function number(raw: string): number | null {
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function bad(reason: string): ParsedCommand {
  return { ok: false, reason };
}

export function parseCommand(input: string, today: IsoDate = todayIso()): ParsedCommand {
  const words = plain(input).split(/\s+/).filter(Boolean);
  if (words.length === 0) return bad('Escribe algo. "ayuda" lista los comandos.');

  const { date, rest: parts } = splitDate(words, today);
  const [verb, ...rest] = parts;

  const done = (command: Command): ParsedCommand => ({ ok: true, command, date });

  if (verb === 'ayuda' || verb === 'help') return done({ kind: 'help' });

  if (verb === 'agua') {
    const ml = number(rest[0] ?? '');
    if (ml === null || ml <= 0) return bad('Cuantos ml. Por ejemplo "agua 710".');
    return done({ kind: 'water', ml: Math.round(ml) });
  }

  if (verb === 'peso') {
    const value = number(rest[0] ?? '');
    if (value === null || value <= 0) return bad('Cuanto pesas hoy. Por ejemplo "peso 74.2".');
    return done({ kind: 'weight', value });
  }

  if (verb === 'pasos') {
    const steps = number(rest[0] ?? '');
    if (steps === null || steps < 0) return bad('Cuantos pasos. Por ejemplo "pasos 8200".');
    return done({ kind: 'steps', steps: Math.round(steps) });
  }

  if (verb === 'sueno') {
    const raw = rest[0] ?? '';
    const match = /^([0-9]+(?:[.,][0-9]+)?)(h|m)$/.exec(raw);
    if (!match) return bad('Con h o con m: "sueno 7.5h" o "sueno 130m".');
    const value = number(match[1]);
    if (value === null || value <= 0) return bad('Con h o con m: "sueno 7.5h" o "sueno 130m".');
    const minutes = Math.round(match[2] === 'h' ? value * 60 : value);
    if (minutes <= 0) return bad('Eso no llega ni a un minuto.');
    return done({ kind: 'sleep', minutes });
  }

  if (verb === 'creatina') {
    const negative = rest[0] === 'no';
    if (rest.length > 0 && !negative) return bad('"creatina" o "creatina no".');
    return done({ kind: 'creatine', taken: !negative });
  }

  if (verb === 'serie') {
    const match = /^([0-9]+(?:[.,][0-9]+)?)x([0-9]+)$/.exec(rest[0] ?? '');
    if (!match) return bad('Asi: "serie 65x8", peso por repeticiones.');
    const weight = number(match[1]);
    const reps = Number(match[2]);
    if (weight === null || weight < 0) return bad('Asi: "serie 65x8", peso por repeticiones.');
    if (reps <= 0) return bad('Cero repeticiones no es una serie.');

    let rpe: number | null = null;
    if (rest.length > 1) {
      const rpeMatch = /^rpe([0-9]+(?:[.,][0-9]+)?)$/.exec(rest[1]);
      const parsed = rpeMatch ? number(rpeMatch[1]) : null;
      if (parsed === null || parsed < 1 || parsed > 10) {
        return bad('El RPE va de 1 a 10, pegado: "serie 65x8 rpe8".');
      }
      rpe = parsed;
    }

    return done({ kind: 'set', weight, reps, rpe });
  }

  return bad(`No conozco "${verb}". Escribe "ayuda" para ver la lista.`);
}
