import {
  parseCommand,
  plain,
  type Command,
  type PantryCommand,
  type ParsedCommand,
} from './commands.ts';
import type { IsoDate } from './dates.ts';
import { extractQuestionDate, resolveQuestionDates } from './questions.ts';
import { fold } from '../nutrition/picker.ts';

const SMALL: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintiun: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  trescientos: 300,
  cuatrocientos: 400,
  quinientos: 500,
  seiscientos: 600,
  setecientos: 700,
  ochocientos: 800,
  novecientos: 900,
};

// Compare explicitly stated quantities after spelling and unit conversion. This is
// deliberately narrower than a model's interpretation: uncertainty asks for another phrase.
function numericWords(message: string): string {
  const words = fold(message).split(/\s+/);
  const result: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    let current = 0;
    let total = 0;
    let last = index;
    let found = false;
    for (; last < words.length; last += 1) {
      const word = words[last];
      if (SMALL[word] !== undefined) {
        current += SMALL[word];
        found = true;
      } else if (word === 'mil') {
        total += (current || 1) * 1000;
        current = 0;
        found = true;
      } else if (
        word === 'y' &&
        (SMALL[words[last + 1]] !== undefined || /^medi[oa]$/.test(words[last + 1] ?? ''))
      )
        continue;
      else if (/^medi[oa]$/.test(word) && found) {
        current += 0.5;
      } else break;
    }
    if (found) {
      result.push(String(total + current));
      index = last - 1;
    } else result.push(words[index]);
  }
  return result
    .join(' ')
    .replace(/(\d+)\s+y\s+medi[oa]\b/g, (_, value: string) => String(Number(value) + 0.5));
}

function amounts(text: string): number[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map(([value]) =>
    /^\d{1,3}(?:[.,]\d{3})$/.test(value)
      ? Number(value.replace(/[.,]/g, ''))
      : Number(value.replace(',', '.')),
  );
}

const close = (left: number, right: number) => Math.abs(left - right) < 0.001;

export function interpretedCommand(
  message: string,
  line: string,
  today: IsoDate,
  unit: string,
): ParsedCommand {
  const parsed = parseCommand(line, today);
  if (!parsed.ok) return parsed;
  // La despensa es de ahora (spec 21.5): "ayer compre huevos" los deja en la despensa hoy.
  if (parsed.command.kind === 'pantry') {
    const reason = validateInterpretedWrite(message, parsed, today, unit);
    return reason === null ? parsed : { ok: false, reason };
  }
  const dates = resolveQuestionDates(extractQuestionDate(message, today), today);
  if (dates === null || dates.from !== dates.to) {
    return { ok: false, reason: 'Dime un día concreto para anotar ese dato.' };
  }
  // The user's date controls the write even if the model drops or changes it.
  const proposed = { ...parsed, date: dates.from };
  const reason = validateInterpretedWrite(message, proposed, today, unit);
  return reason === null ? proposed : { ok: false, reason };
}

export function commandLine(command: Command): string {
  switch (command.kind) {
    case 'water':
      return `agua ${command.ml}`;
    case 'weight':
      return `peso ${command.value}`;
    case 'steps':
      return `pasos ${command.steps}`;
    case 'sleep':
      return `sueno ${command.minutes}m`;
    case 'creatine':
      return command.taken ? 'creatina' : 'creatina no';
    case 'set':
      return `serie ${command.weight}x${command.reps}${command.rpe === null ? '' : ` rpe${command.rpe}`}`;
    case 'help':
      return 'ayuda';
    case 'pantry': {
      const amount =
        command.amount === null
          ? ''
          : `${command.amount}${command.unit === null ? '' : ` ${command.unit}`} `;
      switch (command.action) {
        case 'add':
          return `compre ${amount}${command.item}`;
        case 'set':
          return `quedan ${amount}${command.item}`;
        case 'out':
          return `se acabo ${command.item}`;
        case 'low':
          return `queda poco ${command.item}`;
        case 'have':
          return `hay ${command.item}`;
      }
    }
  }
}

/** Lo que tiene que haber dicho para cada cambio de la despensa. */
const PANTRY_SAID: Record<PantryCommand['action'], RegExp> = {
  add: /\b(compre|compramos|comprado|traje)\b/,
  set: /\b(queda|quedan|tengo|hay)\b/,
  out: /\b(acabo|acabaron|termine|termino|terminaron)\b|\bno (?:me |nos )?(?:hay|queda|quedan|tengo)\b/,
  low: /\b(poc[oa]s?|poquit[oa]s?)\b/,
  have: /\b(hay|tengo|compre)\b/,
};

/**
 * Spec 21.5 con la regla de siempre (spec 20.4): lo que el modelo entendio de la despensa
 * tiene que estar en lo que dijo, la cosa, lo que le paso y la cantidad si la hay.
 */
function pantryGrounded(original: string, command: PantryCommand): string | null {
  const said = plain(original);
  const named = command.item
    .split(' ')
    .every((word) => said.includes(word.length > 3 ? word.replace(/(es|s)$/, '') : word));
  if (!named || !PANTRY_SAID[command.action].test(said)) {
    return 'Lo interpretado no coincide con lo que dijiste de la despensa. No anoté nada.';
  }
  if (command.amount === null) return null;
  const amount = command.amount;
  return amounts(numericWords(original)).some((value) => close(value, amount))
    ? null
    : 'No puedo comprobar esa cantidad en lo que dijiste. Repite el dato con su número.';
}

export function validateInterpretedWrite(
  message: string,
  parsed: Extract<ParsedCommand, { ok: true }>,
  today: IsoDate,
  unit: string,
): string | null {
  const original = fold(message);
  const command = parsed.command;
  const explicitWrite = /\b(anota|anotar|anotame|registra|registrar|guarda|guardar)\b/.test(
    original,
  );
  if (
    (/[?¿]/.test(message) && !explicitWrite) ||
    /\b(cuant[oa]s?|cuando|cual|consulta|revisa|revisar|dime|si hubiera|si hiciera)\b/.test(
      original,
    )
  ) {
    return 'Eso parece una consulta. No voy a convertirlo en un registro.';
  }
  if (command.kind === 'pantry') return pantryGrounded(message, command);
  const date = extractQuestionDate(message, today);
  const range = resolveQuestionDates(date, today);
  if (range === null || range.from !== parsed.date || range.to !== parsed.date) {
    return 'La fecha interpretada no coincide con lo que dijiste. Repite el día y el dato.';
  }
  const relevant: Record<Exclude<typeof command.kind, 'pantry'>, RegExp> = {
    help: /\bayuda\b/,
    water: /\bagua\b/,
    weight: /\b(peso|pese|pesaba|pesando)\b/,
    steps: /\b(pasos|camine|caminado)\b/,
    sleep: /\b(sueno|dormi|dormido|dormir)\b/,
    creatine: /\bcreatina\b/,
    set: /\b(serie|series|repeticiones|reps|levante)\b/,
  };
  if (!relevant[command.kind].test(original))
    return 'Lo interpretado no coincide con el dato que dijiste. No anoté nada.';
  if (command.kind === 'help') return null;
  const mentioned = Object.entries(relevant).filter(
    ([kind, pattern]) =>
      kind !== 'help' && !(kind === 'weight' && command.kind === 'set') && pattern.test(original),
  );
  if (mentioned.length > 1)
    return 'Anota un tipo de dato por mensaje para que cada cantidad quede en su lugar.';
  if (command.kind === 'creatine') {
    if (
      (!explicitWrite && !/\b(tome|tomado|olvide)\b/.test(original)) ||
      /\b(no se|si tome|recuerdo si)\b/.test(original)
    ) {
      return 'Dime si tomaste la creatina o no; no voy a adivinarlo.';
    }
    const negative = /\b(no|sin|olvide)\b/.test(original);
    return command.taken !== negative
      ? null
      : 'No quedó claro si tomaste la creatina. Dime si la tomaste o no.';
  }
  if (/\b(no|sin|ojala|quisiera|manana)\b/.test(original))
    return 'No anoté nada: necesito un dato que ya ocurrió.';
  const withoutDate = date === null ? original : original.replace(fold(date), ' ');
  const text = numericWords(withoutDate).replace(
    /(\d+(?:[.,]\d+)?)\s+horas?\s+y\s+media\b/g,
    (_, amount: string) => `${Number(amount.replace(',', '.')) + 0.5} horas`,
  );
  const values = amounts(text);
  let matches = false;
  switch (command.kind) {
    case 'weight':
      matches =
        !/\b(lb|lbs|libras?)\b/.test(text) && values.some((value) => close(value, command.value));
      break;
    case 'steps':
      matches = values.includes(command.steps);
      break;
    case 'water': {
      const litre = /\b(litros?|l)\b/.test(text);
      const millilitre = /\b(mililitros?|ml)\b/.test(text);
      matches = values.some((value) =>
        close(litre && !millilitre ? value * 1000 : value, command.ml),
      );
      if (/\b(vasos?|botellas?|tazas?)\b/.test(text) && !litre && !millilitre) matches = false;
      break;
    }
    case 'sleep': {
      const hours = /([0-9]+(?:[.,][0-9]+)?)\s*(?:horas?|h)\b/.exec(text);
      const minutes = /([0-9]+(?:[.,][0-9]+)?)\s*(?:minutos?|min|m)\b/.exec(text);
      const stated =
        hours || minutes
          ? Number(hours?.[1]?.replace(',', '.') ?? 0) * 60 +
            Number(minutes?.[1]?.replace(',', '.') ?? 0)
          : values.length === 1 && values[0] <= 24
            ? values[0] * 60
            : null;
      matches = stated !== null && close(stated, command.minutes);
      break;
    }
    case 'set': {
      const pair =
        /([0-9]+(?:[.,][0-9]+)?)\s*(?:(?:kg|lb|lbs|kilos?|libras?)\s*)?(?:por|x)\s*(\d+)/.exec(
          text,
        );
      const rpe = /\brpe\s*([0-9]+(?:[.,][0-9]+)?)/.exec(text);
      const explicitUnit = /\b(kg|kilos?|lb|lbs|libras?)\b/.exec(text)?.[1];
      const correctUnit =
        explicitUnit === undefined ||
        (unit === 'kg'
          ? /^(kg|kilos?)$/.test(explicitUnit)
          : /^(lb|lbs|libras?)$/.test(explicitUnit));
      matches =
        correctUnit &&
        pair !== null &&
        close(Number(pair[1].replace(',', '.')), command.weight) &&
        Number(pair[2]) === command.reps &&
        (command.rpe === null
          ? rpe === null
          : rpe !== null && close(Number(rpe[1].replace(',', '.')), command.rpe));
      break;
    }
  }
  return matches
    ? null
    : 'No puedo comprobar esa cantidad en lo que dijiste. Repite el dato con su número y unidad.';
}
