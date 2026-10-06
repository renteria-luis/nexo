import type { IsoDate } from './dates.ts';
import { QUESTIONS, type ReadRequest } from './questions.ts';

export type Intent =
  | { kind: 'write'; line: string }
  | ({ kind: 'ask' } & ReadRequest)
  | { kind: 'none'; reply: string };

export const UNSUPPORTED_REQUEST =
  'Puedo consultar tus registros y tu despensa, buscar una receta o anotar un dato. ' +
  'Dime qué quieres consultar; para anotar, incluye la cantidad y el día.';

// The native guided decoder requires simple string fields and explicit enums.
export const INTENT_SCHEMA = {
  type: 'object',
  title: 'Intencion',
  description: 'La petición actual del usuario, sin inventar datos',
  properties: {
    tipo: {
      type: 'string',
      enum: ['nada', 'preguntar', 'anotar'],
      description:
        'preguntar para consultar, incluso sin signos; anotar solo un dato explícito para guardar; nada si no está claro',
    },
    comando: {
      type: 'string',
      description:
        'Solo al anotar: comando con la cantidad y fecha que dijo el usuario. No copies ejemplos ni datos de mensajes anteriores. Si faltan datos, deja vacío',
    },
    pregunta: {
      type: 'string',
      enum: ['', ...QUESTIONS],
      description:
        'El dato solicitado; marca significa peso realmente levantado y e1rm solo una estimación pedida explícitamente. Vacío si no es una consulta',
    },
    ejercicio: {
      type: 'string',
      description:
        'Nombre o descripción del ejercicio tal como lo pidió, sin completar una variante por tu cuenta; vacío si no aplica',
    },
    fecha: {
      type: 'string',
      description:
        'Día o rango tal como lo pidió; vacío si no indicó ninguno. Conserva ayer y otras fechas en todas las preguntas',
    },
    respuesta: {
      type: 'string',
      description:
        'Cadena vacía. Los datos personales y las aclaraciones los responde la app al consultar sus registros',
    },
  },
  required: ['tipo', 'comando', 'pregunta', 'ejercicio', 'fecha', 'respuesta'],
} as const;

export function instructions(today: IsoDate, unit: string): string {
  return [
    'Clasifica únicamente la petición actual. La app consultará los datos y escribirá la respuesta.',
    'Una pregunta sigue siendo una consulta aunque no tenga signos de interrogación.',
    'Peticiones como proteína consumida ayer consultan registros; nunca se convierten en anotar sueño.',
    'preguntar: marca, e1rm, nota, racha, proteina, entreno, despensa, receta, agua, peso, pasos, sueno, creatina, nutricion.',
    'marca es el mayor peso registrado. e1rm es una estimación y solo se elige si la pide expresamente.',
    'receta pide una receta nueva, investigada con la despensa. No necesita una receta guardada.',
    'anotar: cuando AFIRMA un dato suyo que ocurrió y da una cantidad, aunque no diga anota. Las cantidades escritas con palabras también cuentan.',
    'Una afirmación de haber dormido cierta cantidad es anotar sueño; preguntar cuánto durmió es preguntar sueno. Haber caminado cierta cantidad es anotar pasos.',
    'Una petición explícita de guardar un dato también es anotar aunque esté escrita entre signos de interrogación.',
    'No inventes cantidades, unidades, ejercicios, fechas ni hechos personales. Ante una duda devuelve nada.',
    'La única excepción sin cantidad es haber tomado o no la creatina, cuando lo dice explícitamente.',
    'No conviertas consultas ni hipótesis en registros. La negación de haber tomado creatina se registra como creatina no. No copies datos de mensajes anteriores.',
    'Gramática de escritura: agua <ml>; peso <kg>; pasos <cantidad>; sueno <horas>h o sueno <minutos>m;',
    'Sueño usa UNA sola cantidad: horas decimales o minutos totales, nunca una mezcla de h y m. Media hora equivale a 0.5 horas.',
    'creatina o creatina no; serie <peso>x<repeticiones> con rpe<valor> solo si se indicó.',
    'La fecha va delante del comando. Si dijo ayer, anteayer o una fecha, copia esa fecha delante del comando; nunca la omitas. Sin fecha corresponde a hoy.',
    `El peso corporal va siempre en kg; el de las series, en ${unit}. Hoy es ${today}.`,
    'Devuelve los seis campos. respuesta siempre queda vacía. Los campos que no aplican quedan vacíos, incluida pregunta cuando tipo no sea preguntar.',
  ].join('\n');
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function readIntent(answer: unknown): Intent {
  let raw = answer;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { kind: 'none', reply: UNSUPPORTED_REQUEST };
    }
  }
  if (typeof raw !== 'object' || raw === null) return { kind: 'none', reply: UNSUPPORTED_REQUEST };
  const body = raw as Record<string, unknown>;
  if (body.tipo === 'anotar') {
    const line = text(body.comando);
    return line === null ? { kind: 'none', reply: UNSUPPORTED_REQUEST } : { kind: 'write', line };
  }
  if (body.tipo === 'preguntar') {
    const question = QUESTIONS.find((one) => one === body.pregunta);
    if (question) {
      return { kind: 'ask', question, exercise: text(body.ejercicio), date: text(body.fecha) };
    }
  }
  return { kind: 'none', reply: UNSUPPORTED_REQUEST };
}
