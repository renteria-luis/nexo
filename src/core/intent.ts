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
export type Question = 'marca' | 'nota' | 'racha' | 'proteina' | 'entreno';

export type Intent =
  /** Una linea de la gramatica de comandos, todavia sin validar. */
  | { kind: 'write'; line: string }
  | { kind: 'ask'; question: Question; exercise: string | null; date: string | null }
  | { kind: 'none'; reply: string };

const QUESTIONS: Question[] = ['marca', 'nota', 'racha', 'proteina', 'entreno'];

/**
 * El esquema que viaja con la llamada. Es el trozo de JSON Schema que entiende Apple:
 * objetos, cadenas con `enum`, y nada mas complicado que eso.
 *
 * **Todos los campos son obligatorios, y eso no es un descuido.** Con `required` solo en
 * `tipo`, el modelo del telefono rellenaba ese y se saltaba el resto: elegia "anotar" y
 * no escribia el comando, o "preguntar" sin decir que preguntaba, y la app contestaba
 * "entendi que querias anotar algo, pero no que". Lo que guia la generacion es el
 * esquema, no las instrucciones: un campo opcional es un campo que un modelo pequeno se
 * ahorra. Obligandolos, `pregunta` ademas solo puede salir de la lista, porque Apple
 * restringe la decodificacion a los valores del `enum`.
 *
 * Los que no vienen al caso llegan con cualquier cosa dentro (una cadena vacia, un
 * ejercicio inventado) y se ignoran: solo se lee el que corresponde al `tipo`.
 */
export const INTENT_SCHEMA = {
  type: 'object',
  title: 'Intencion',
  description: 'Lo que el dueño quiso decir',
  properties: {
    tipo: {
      type: 'string',
      enum: ['nada', 'anotar', 'preguntar'],
      description:
        'nada si es un saludo, una charla o algo que no sabes; anotar si dijo un dato ' +
        'suyo para guardar; preguntar solo si pide uno de los datos de la lista',
    },
    comando: {
      type: 'string',
      description:
        'Con tipo anotar, la linea exacta en la gramatica de la app ("ayer sueno 390m"). ' +
        'Con cualquier otro tipo, cadena vacia',
    },
    pregunta: {
      type: 'string',
      enum: QUESTIONS,
      description:
        'Con tipo preguntar, cual de los datos pide. Con cualquier otro tipo da igual: ' +
        'pon marca y no se mira',
    },
    ejercicio: {
      type: 'string',
      description: 'El ejercicio por el que pregunta si la pregunta es marca; si no, cadena vacia',
    },
    fecha: {
      type: 'string',
      description: 'El dia por el que pregunta, escrito como el lo dijo; si no dijo ninguno, vacia',
    },
    respuesta: {
      type: 'string',
      description:
        'Con tipo nada, una frase corta diciendo que hace falta o que no sabes eso. ' +
        'Con cualquier otro tipo, cadena vacia',
    },
  },
  required: ['tipo', 'comando', 'pregunta', 'ejercicio', 'fecha', 'respuesta'],
} as const;

/**
 * Las instrucciones. Cortas a proposito: el modelo del telefono es pequeño y todo lo
 * que se le cuente de mas es sitio que le quita a lo que el escribio.
 */
export function instructions(today: IsoDate, unit: string): string {
  return [
    'Eres el asistente de una app personal de entreno y comida, de un solo dueño.',
    'Lees lo ultimo que el escribio y contestas una sola cosa sobre ESO, no sobre los',
    'ejemplos ni sobre lo que se dijo antes.',
    '',
    'Elige el tipo asi:',
    '  - "anotar" solo si dijo un dato suyo con su numero. Devuelves la linea de comando.',
    '  - "preguntar" solo si pide uno de estos datos: marca (su mejor 1RM de un',
    '    ejercicio), nota (la nota de un dia), racha, proteina (la de hoy), entreno',
    '    (cuando entreno por ultima vez).',
    '  - "nada" en todo lo demas: saludos, charla, y cualquier cosa que no sea',
    '    exactamente una de las dos de arriba. Ante la duda, "nada".',
    '',
    'No inventas ningun numero: si no dijo la cantidad, es "nada" y se la pides.',
    'Contestas siempre los seis campos. Los que no vienen al caso van vacios.',
    '',
    'Comandos:',
    ...COMMAND_HELP.map((row) => `  ${row}`),
    '',
    `El peso va en ${unit}. Hoy es ${today}.`,
    'Si el dia no es hoy, la fecha va delante del comando: "ayer", "anteayer", "25 set", "25/09".',
    '',
    'Ejemplos, cada uno independiente del anterior:',
    '  "cual es mi mejor press banca" -> preguntar, pregunta "marca", ejercicio "press banca"',
    '  "que nota saque ayer" -> preguntar, pregunta "nota", fecha "ayer"',
    '  "ayer dormi como seis y media" -> anotar, comando "ayer sueno 390m"',
    '  "me pese 74 y medio" -> anotar, comando "peso 74.5"',
    '  "ya tome la creatina" -> anotar, comando "creatina"',
    '  "dormi 1 hora" -> anotar, comando "sueno 60m"',
    '  "camine como nueve mil pasos" -> anotar, comando "pasos 9000"',
    '  "cuanta racha llevo" -> preguntar, pregunta "racha"',
    '  "cuanta proteina llevo" -> preguntar, pregunta "proteina"',
    '  "cuando entrene por ultima vez" -> preguntar, pregunta "entreno"',
    '  "hola" -> nada, respuesta "Dime que anotaste."',
    '  "que tal tu dia" -> nada, respuesta "Aqui solo llevo lo tuyo."',
    '  "tome un vaso de agua" -> nada, respuesta "Dime cuantos ml."',
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
    if (line === null) {
      return {
        kind: 'none',
        reply: 'Entendí que querías anotar algo, pero no qué. Dímelo con el número: "sueno 60m".',
      };
    }
    return { kind: 'write', line };
  }

  if (kind === 'preguntar') {
    const asked = text(body.pregunta);
    const question = QUESTIONS.find((one) => one === asked);
    if (question === undefined) {
      return {
        kind: 'none',
        reply:
          'De lo tuyo sé contestar: tu mejor marca de un ejercicio, la nota de un día, tu ' +
          'racha, la proteína de hoy y cuándo entrenaste por última vez.',
      };
    }
    return { kind: 'ask', question, exercise: text(body.ejercicio), date: text(body.fecha) };
  }

  return { kind: 'none', reply: text(body.respuesta) ?? 'No entendí eso.' };
}
