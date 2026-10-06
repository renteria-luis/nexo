import { dateFrom, monthNumber, parseCommand } from './commands.ts';
import {
  addDays,
  daysBetween,
  todayIso,
  weekStart,
  type DateRange,
  type IsoDate,
} from './dates.ts';
import { fold } from '../nutrition/picker.ts';

export const QUESTIONS = [
  'marca',
  'e1rm',
  'nota',
  'racha',
  'proteina',
  'entreno',
  'despensa',
  'receta',
  'agua',
  'peso',
  'pasos',
  'sueno',
  'creatina',
  'nutricion',
] as const;
export type Question = (typeof QUESTIONS)[number];
export type ReadRequest = { question: Question; exercise: string | null; date: string | null };

function normalized(text: string): string {
  return fold(text)
    .replace(/[¿?¡!.,;:]/g, ' ')
    .replace(/\bprotenia\b/g, 'proteina')
    .replace(/\bprotiena\b/g, 'proteina')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep explicit dates even when invalid: the reader must refuse rather than read today. */
export function extractQuestionDate(text: string, today: IsoDate = todayIso()): string | null {
  const value = normalized(text);
  const range =
    /\b(?:entre\s+.+\s+y\s+.+|del\s+.+\s+al\s+.+|(?:la\s+)?semana pasada|esta semana|(?:el\s+)?mes pasado|este mes|(?:los\s+)?ultimos?\s+\d+\s+dias?)\b/.exec(
      value,
    );
  if (range) return range[0];
  const unknown = /\bel dia de\s+.+$/.exec(value);
  if (unknown) return unknown[0];
  const relative = /\b(?:anteayer|ayer|anoche|hoy|manana|hace\s+\d+\s+dias?)\b/.exec(value);
  if (relative) return relative[0];
  const dated = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/.exec(value);
  if (dated) return dated[0];
  for (const match of value.matchAll(/\b\d{1,2}\s+(?:de\s+)?([a-z]+)(?:\s+(?:de\s+)?\d{4})?\b/g)) {
    if (match[1].length >= 3 && monthNumber(match[1]) !== null) return match[0];
  }
  const weekday =
    /\b(?:el\s+)?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?:\s+pasado)?\b/.exec(
      value,
    );
  if (weekday) return weekday[0];
  const words = value.split(' ');
  for (let size = Math.min(5, words.length); size > 0; size -= 1) {
    const tail = words.slice(-size).join(' ');
    if (dateFrom(tail, today) !== null) return tail;
  }
  const uncertain = /\b(?:algun dia|otro dia|el dia\s+.+|el\s+\d+.*)$/.exec(value);
  return uncertain?.[0] ?? null;
}

export function resolveQuestionDates(
  value: string | null,
  today: IsoDate = todayIso(),
): DateRange | null {
  if (value === null || value.trim() === '') return { from: today, to: today };
  const text = normalized(value);
  if (text === 'esta semana') return { from: weekStart(today), to: today };
  if (/^(?:la )?semana pasada$/.test(text))
    return { from: addDays(weekStart(today), -7), to: addDays(weekStart(today), -1) };
  if (text === 'este mes') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (/^(?:el )?mes pasado$/.test(text)) {
    const last = addDays(`${today.slice(0, 7)}-01`, -1);
    return { from: `${last.slice(0, 7)}-01`, to: last };
  }
  const trailing = /^(?:los )?ultimos? (\d+) dias?$/.exec(text);
  if (trailing) {
    const days = Number(trailing[1]);
    return days >= 1 && days <= 3660 ? { from: addDays(today, 1 - days), to: today } : null;
  }
  const interval = /^(?:entre (.+) y (.+)|del (.+) al (.+))$/.exec(text);
  if (interval) {
    const from = dateFrom(interval[1] ?? interval[3], today);
    const to = dateFrom(interval[2] ?? interval[4], today);
    if (from === null || to === null || to < from || to > today || daysBetween(from, to) > 3660)
      return null;
    return { from, to };
  }
  const date = dateFrom(text, today);
  return date !== null && date <= today ? { from: date, to: date } : null;
}

export function readQuestion(
  text: string,
  previous: ReadRequest | null = null,
  today: IsoDate = todayIso(),
): ReadRequest | null {
  const value = normalized(text);
  if (
    /\b(?:anota(?:r(?:me)?|me|s)?|anotes|registra(?:r(?:me)?|me|s)?|registres|guarda(?:r(?:me)?|me|s)?|guardes|agrega(?:r(?:me)?|me|s)?|agregues|suma(?:r(?:me)?|me|s)?|sumes)\b/.test(
      value,
    )
  )
    return null;
  const explicit =
    /[¿?]/.test(text) ||
    /^(?:y )?(?:que|cual|cuanto|cuanta|cuantos|cuantas|cuando|como|dime|muestra|ver|consulta)\b/.test(
      value,
    );
  if (
    !explicit &&
    (parseCommand(text, today).ok ||
      /\b(?:anota|anotame|registra|registre|guarda|agrega|suma|tome|bebi|dormi|camine|comi|consumi|hice|pese|levante|compre|acabo|queda|quedan)\b/.test(
        value,
      ))
  )
    return null;
  let date = extractQuestionDate(text, today);
  const followup = value.replace(/^y\s+/, '');
  if (previous !== null) {
    if (date !== null && followup === date) return { ...previous, date };
    if (
      (previous.question === 'marca' || previous.question === 'e1rm') &&
      /^(?:con |en |sin |el |la )?(?:mancuernas?|barra|maquina|polea|plano|inclinado|declinado)\b/.test(
        followup,
      )
    ) {
      const replacement = /\b(?:mancuernas?|barra|maquina|polea)\b/.test(followup)
        ? /\b(?:con|en)?\s*(?:mancuernas?|barra|maquina|polea)\b/g
        : /\b(?:plano|inclinado|declinado)\b/g;
      const base = (previous.exercise ?? '').replace(replacement, '').replace(/\s+/g, ' ').trim();
      const equipment = date === null ? followup : followup.replace(date, '').trim();
      return { ...previous, exercise: `${base} ${equipment}`.trim(), date: date ?? previous.date };
    }
    if (
      previous.question === 'receta' &&
      /^(?:sin |con |para |otra\b|mas |menos |que no )/.test(followup)
    )
      return { question: 'receta', exercise: null, date: null };
  }
  let question: Question | null = null;
  if (
    /\b(?:receta|recetas|cocinar|cocino|preparar|cena|almuerzo)\b/.test(value) &&
    /\b(?:receta|recetas|que|dame|sugiere|idea|puedo)\b/.test(value)
  )
    question = 'receta';
  else if (/\b(?:despensa|nevera|refrigerador|inventario)\b/.test(value)) question = 'despensa';
  else if (/\b(?:proteina|proteinas|protein)\b/.test(value)) question = 'proteina';
  else if (/\b(?:nutricion|macros|calorias|comida|comi|comido|carbohidratos|grasas)\b/.test(value))
    question = 'nutricion';
  else if (/\b(?:e1rm|1rm)\b|una repeticion maxima/.test(value)) question = 'e1rm';
  else if (/\b(?:maximo|maxima|mejor|mayor|record|marca|levantamiento|pr)\b/.test(value))
    question = 'marca';
  else if (/\b(?:nota|puntaje|puntuacion|score)\b/.test(value)) question = 'nota';
  else if (/\bracha\b/.test(value)) question = 'racha';
  else if (/\b(?:entreno|entrene|entrenamiento|gym|gimnasio)\b/.test(value)) question = 'entreno';
  else if (/\bagua\b/.test(value)) question = 'agua';
  else if (/\b(?:peso|pese)\b/.test(value)) question = 'peso';
  else if (/\b(?:pasos|camine)\b/.test(value)) question = 'pasos';
  else if (/\b(?:sueno|dormi|dormido|dormir)\b/.test(value)) question = 'sueno';
  else if (/\bcreatina\b/.test(value)) question = 'creatina';
  if (question === null) return null;
  if (date === null && /^y\s+/.test(value) && question !== 'receta' && question !== 'despensa')
    date = previous?.date ?? null;
  if (question !== 'marca' && question !== 'e1rm') return { question, exercise: null, date };
  const withoutDate = date === null ? value : value.replace(date, '');
  const exercise = withoutDate
    .replace(
      /\b(?:cual|cuanto|cuando|que|es|fue|ha|sido|mi|mis|el|la|los|las|tu|maximo|maxima|mayor|mejor|record|marca|levantamiento|levantado|levante|peso|e1rm|1rm|estimado|estimada|en|de|del|para|pr|dime|muestra|ver)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return { question, exercise: exercise || previous?.exercise || null, date };
}
