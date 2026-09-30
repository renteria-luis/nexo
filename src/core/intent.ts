// Lo que el modelo del telefono puede contestar, y como se lee.
//
// Spec 20.3: el modelo no escribe nada. Su unico trabajo es traducir una frase suelta a
// una linea de la gramatica de comandos, y quien decide si esa linea vale y que
// significa es `parseCommand`, que es codigo y no un modelo. Un parser que no entiende
// lo dice; un modelo que no entiende se lo inventa, y la diferencia es un peso de 74 kg
// escrito como 7.4.
//
// Por eso la respuesta viene con esquema y no en texto libre: el modelo elige entre tres
// cosas (anotar, preguntar, nada) y todo lo que no encaje aqui se descarta.

import { COMMAND_HELP } from './commands.ts';
import type { IsoDate } from './dates.ts';

/** Lo poco que sabe contestar de su propia informacion. Spec 20.2 punto 4. */
export type Question = 'marca' | 'nota' | 'racha' | 'proteina';

export type Intent =
  /** Una linea de la gramatica de comandos, todavia sin validar. */
  | { kind: 'write'; line: string }
  | { kind: 'ask'; question: Question; exercise: string | null; date: string | null }
  | { kind: 'none'; reply: string };

const QUESTIONS: Question[] = ['marca', 'nota', 'racha', 'proteina'];

/**
 * El esquema que viaja con la llamada. Es el trozo de JSON Schema que entiende Apple:
 * objetos, cadenas con `enum`, y nada mas complicado que eso.
 */
export const INTENT_SCHEMA = {
  type: 'object',
  title: 'Intencion',
  description: 'Lo que el dueño quiso decir',
  properties: {
    tipo: {
      type: 'string',
      enum: ['anotar', 'preguntar', 'nada'],
      description: 'anotar si hay algo que guardar, preguntar si pide un dato suyo, nada si no',
    },
    comando: {
      type: 'string',
      description: 'Solo con tipo anotar: la linea exacta en la gramatica de la app',
    },
    pregunta: {
      type: 'string',
      enum: QUESTIONS,
      description: 'Solo con tipo preguntar',
    },
    ejercicio: {
      type: 'string',
      description: 'El ejercicio por el que pregunta, cuando la pregunta es marca',
    },
    fecha: {
      type: 'string',
      description: 'El dia por el que pregunta, escrito como el lo dijo',
    },
    respuesta: {
      type: 'string',
      description: 'Solo con tipo nada: una frase corta diciendo que hace falta',
    },
  },
  required: ['tipo'],
} as const;

/**
 * Las instrucciones. Cortas a proposito: el modelo del telefono es pequeño y todo lo
 * que se le cuente de mas es sitio que le quita a lo que el escribio.
 */
export function instructions(today: IsoDate, unit: string): string {
  return [
    'Eres el asistente de una app personal de entreno y comida, de un solo dueño.',
    'Traduces lo que el escribe a una linea de comando de la app. No inventas ningun numero:',
    'si no dijo la cantidad, no la pongas.',
    '',
    'Comandos:',
    ...COMMAND_HELP.map((row) => `  ${row}`),
    '',
    `El peso va en ${unit}. Hoy es ${today}.`,
    'Si el dia no es hoy, la fecha va delante del comando: "ayer", "anteayer", "25 set", "25/09".',
    '',
    'Ejemplos:',
    '  "ayer dormi como seis y media" -> anotar, comando "ayer sueno 390m"',
    '  "me pese 74 y medio" -> anotar, comando "peso 74.5"',
    '  "ya tome la creatina" -> anotar, comando "creatina"',
    '  "tome un vaso de agua" -> nada, respuesta "Dime cuantos ml"',
    '  "cual es mi mejor press banca" -> preguntar, pregunta "marca", ejercicio "press banca"',
    '  "que nota saque ayer" -> preguntar, pregunta "nota", fecha "ayer"',
  ].join('\n');
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Lo que contesto el modelo, convertido en algo que la app entiende. Cualquier cosa que
 * no encaje se queda en `none`: es un modelo pequeño contestando, no una llamada a una
 * funcion nuestra, y tratar su respuesta como valida por venir con la forma correcta es
 * exactamente lo que hay que no hacer.
 */
export function readIntent(answer: unknown): Intent {
  let raw = answer;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { kind: 'none', reply: 'No entendí eso.' };
    }
  }
  if (typeof raw !== 'object' || raw === null) return { kind: 'none', reply: 'No entendí eso.' };

  const body = raw as Record<string, unknown>;
  const kind = text(body.tipo);

  if (kind === 'anotar') {
    const line = text(body.comando);
    if (line === null)
      return { kind: 'none', reply: 'Entendí que querías anotar algo, pero no qué.' };
    return { kind: 'write', line };
  }

  if (kind === 'preguntar') {
    const asked = text(body.pregunta);
    const question = QUESTIONS.find((one) => one === asked);
    if (question === undefined) return { kind: 'none', reply: 'Eso no lo sé contestar todavía.' };
    return { kind: 'ask', question, exercise: text(body.ejercicio), date: text(body.fecha) };
  }

  return { kind: 'none', reply: text(body.respuesta) ?? 'No entendí eso.' };
}
