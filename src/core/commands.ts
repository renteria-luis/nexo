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

import { isBodyWeightKg } from './daily-log.ts';
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

export function monthNumber(word: string): number | null {
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
  if (/^\d{1,2}$/.test(words[0]) && words[1] === 'de') {
    words = [words[0], ...words.slice(2)];
  }
  if (words.at(-1) === 'pasado') words = words.slice(0, -1);
  if (words.length === 2 && words[0] === 'el') words = words.slice(1);
  if (
    words.length === 3 &&
    words[0] === 'hace' &&
    /^\d+$/.test(words[1]) &&
    /^dias?$/.test(words[2])
  ) {
    const days = Number(words[1]);
    return Number.isSafeInteger(days) && days <= 3660 ? addDays(today, -days) : null;
  }
  if (words.length === 4 && words[2] === 'de') words = [words[0], words[1], words[3]];

  if (words.length === 1) {
    const [word] = words;
    if (word === 'hoy') return today;
    if (word === 'ayer' || word === 'anoche') return addDays(today, -1);
    if (word === 'anteayer') return addDays(today, -2);
    const weekday = [
      'domingo',
      'lunes',
      'martes',
      'miercoles',
      'jueves',
      'viernes',
      'sabado',
    ].indexOf(word);
    if (weekday !== -1) {
      const current = new Date(`${today}T00:00:00Z`).getUTCDay();
      return addDays(today, -((current - weekday + 7) % 7 || 7));
    }
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
 * Lo que contesta el asistente al anotar una serie. Dice en que ejercicio cayo: el plan
 * abre solo el siguiente al completar las series de uno, el chat tapa la pantalla, y
 * "Serie de 65 lb por 8 anotada" no decia si cayo en las laterales o en el siguiente.
 */
export function setLoggedReply(
  weight: number,
  unit: string,
  reps: number,
  exerciseName: string,
): string {
  return `Serie de ${weight} ${unit} por ${reps} anotada en ${exerciseName}`;
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
  for (let size = Math.min(4, parts.length - 1); size >= 1; size -= 1) {
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

/**
 * Un numero con su unidad, pegada o en la palabra siguiente: "1.5l", "1.5 l", "710".
 * Devuelve cuantas palabras uso, para que lo que sobre se pueda rechazar. Null si la
 * unidad no es ninguna de las que se esperan.
 */
function measure(
  rest: readonly string[],
  units: readonly string[],
): { value: number; unit: string | null; used: number } | null {
  const glued = /^([0-9]+(?:[.,][0-9]+)?)([a-z]+)?$/.exec(rest[0] ?? '');
  if (!glued) return null;
  const value = number(glued[1]);
  if (value === null) return null;
  if (glued[2] !== undefined) {
    return units.includes(glued[2]) ? { value, unit: glued[2], used: 1 } : null;
  }
  if (rest[1] !== undefined && units.includes(rest[1])) return { value, unit: rest[1], used: 2 };
  return { value, unit: null, used: 1 };
}

/** "7.5h", "130m", "7h30", "7h30m" o "7h 30m", en minutos. Null si no es ninguna. */
function sleepMinutes(rest: readonly string[]): { minutes: number; used: number } | null {
  const split = /^([0-9]+)h$/.exec(rest[0] ?? '');
  const tail = /^([0-9]{1,2})m$/.exec(rest[1] ?? '');
  if (split && tail) return { minutes: Number(split[1]) * 60 + Number(tail[1]), used: 2 };

  const joined = /^([0-9]+)h([0-9]{1,2})m?$/.exec(rest[0] ?? '');
  if (joined) return { minutes: Number(joined[1]) * 60 + Number(joined[2]), used: 1 };

  const single = /^([0-9]+(?:[.,][0-9]+)?)(h|m)$/.exec(rest[0] ?? '');
  const value = single ? number(single[1]) : null;
  if (!single || value === null) return null;
  return { minutes: Math.round(single[2] === 'h' ? value * 60 : value), used: 1 };
}

/**
 * Pasos como los copia de la app de Salud, con el separador de miles: "8,200" y "8.200"
 * son ocho mil doscientos, no ocho.
 */
function steps(raw: string): number | null {
  const plain = /^[0-9]{1,3}(?:[.,][0-9]{3})+$/.test(raw) ? raw.replace(/[.,]/g, '') : raw;
  const value = Number(plain);
  return /^[0-9]+$/.test(plain) && Number.isInteger(value) ? value : null;
}

function bad(reason: string): ParsedCommand {
  return { ok: false, reason };
}

export function parseCommand(input: string, today: IsoDate = todayIso()): ParsedCommand {
  const words = plain(input).split(/\s+/).filter(Boolean);
  if (words.length === 0) return bad('Escribe algo. "ayuda" lista los comandos.');

  const { date, rest: parts } = splitDate(words, today);
  const [verb, ...rest] = parts;

  // Lo que sobra despues de lo que el comando espera no se tira: guardar 7 h de "sueno 7h
  // 30m" es justo guardar algo distinto de lo que escribio.
  const done = (command: Command, used: number): ParsedCommand =>
    rest.length > used
      ? bad(`Sobra "${rest.slice(used).join(' ')}": una cosa por linea.`)
      : { ok: true, command, date };

  if (verb === 'ayuda' || verb === 'help') return { ok: true, command: { kind: 'help' }, date };

  if (verb === 'agua') {
    const water = measure(rest, ['ml', 'l']);
    if (water === null || water.value <= 0) return bad('Cuantos ml. Por ejemplo "agua 710".');
    // Un ml y medio no es algo que se beba: sin unidad, un numero con decimales es un litro
    // mal escrito, y adivinarlo seria guardar otra cosa.
    if (water.unit === null && !Number.isInteger(water.value)) {
      return bad(`Con unidad: "agua ${rest[0]} l" o los ml, "agua 710".`);
    }
    const ml = water.unit === 'l' ? water.value * 1000 : water.value;
    return done({ kind: 'water', ml: Math.round(ml) }, water.used);
  }

  if (verb === 'peso') {
    // Su gimnasio va en libras y el peso corporal no (2026-10-02).
    if (rest.some((word) => /^(lb|lbs|libras?)$/.test(word) || /^[0-9.,]+lbs?$/.test(word))) {
      return bad('El peso corporal va en kilos: "peso 74.2".');
    }
    const weight = measure(rest, ['kg']);
    if (weight === null || weight.value <= 0) {
      return bad('Cuanto pesas hoy. Por ejemplo "peso 74.2".');
    }
    // El mismo limite que el campo de Hoy: un 7.4 o un 742 entraban al promedio de siete
    // dias y movian las metas, por el asistente y por el modelo, que pasan por aqui.
    if (!isBodyWeightKg(weight.value)) {
      return bad(`${weight.value} kg no es un peso corporal: escribe "peso 74.2".`);
    }
    return done({ kind: 'weight', value: weight.value }, weight.used);
  }

  if (verb === 'pasos') {
    const count = steps(rest[0] ?? '');
    if (count === null) return bad('Cuantos pasos. Por ejemplo "pasos 8200".');
    return done({ kind: 'steps', steps: count }, 1);
  }

  if (verb === 'sueno') {
    const slept = sleepMinutes(rest);
    if (slept === null) return bad('Con h o con m: "sueno 7.5h", "sueno 7h 30m" o "sueno 130m".');
    if (slept.minutes <= 0) return bad('Eso no llega ni a un minuto.');
    return done({ kind: 'sleep', minutes: slept.minutes }, slept.used);
  }

  if (verb === 'creatina') {
    const negative = rest[0] === 'no';
    if (rest.length > 0 && !negative) return bad('"creatina" o "creatina no".');
    return done({ kind: 'creatine', taken: !negative }, negative ? 1 : 0);
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

    return done({ kind: 'set', weight, reps, rpe }, rpe === null ? 1 : 2);
  }

  return bad(`No conozco "${verb}". Escribe "ayuda" para ver la lista.`);
}
