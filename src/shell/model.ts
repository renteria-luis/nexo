// El modelo que vive dentro del telefono. Spec 20.3.
//
// Apple Foundation Models, el mismo que usa el sistema: gratis, sin cuenta, sin limite
// de llamadas, sin conexion, y nada de lo que el escribe sale del telefono. Pide iOS 26,
// Apple Intelligence encendido y un telefono que lo soporte; el suyo lo es.
//
// Se habla con el modulo nativo a secas y no con el envoltorio del paquete, por dos
// razones. La primera es que su indice arrastra el SDK de Vercel y `zod` al bundle para
// no usar nada de eso (lo mismo que los iconos: un import por cosa, nunca el indice). La
// segunda es que ese envoltorio llama a `getEnforcing`, que revienta al importarlo si el
// modulo no esta compilado, y aqui hace falta justo lo contrario: que la app funcione
// igual sin el.

import { TurboModuleRegistry, type TurboModule } from 'react-native';

type Said = { role: 'system' | 'user' | 'assistant'; content: string };

type Part = { type: string; text?: string };

interface AppleLlm extends TurboModule {
  isAvailable(): boolean;
  generateText(
    messages: Said[],
    options: { schema?: object; temperature?: number; maxTokens?: number },
  ): Promise<Part[]>;
}

// `undefined` es "todavia no se miro"; null es "aqui no hay modelo", que es el caso en
// el navegador, en una compilacion anterior a esta y en cualquier telefono sin Apple
// Intelligence. Se busca tarde y dentro de un try: `get` devuelve null en vez de
// reventar (esa es la diferencia con `getEnforcing`), pero en el navegador no existe ni
// el registro, y esto se importa desde la pantalla principal.
let llm: AppleLlm | null | undefined;

function model(): AppleLlm | null {
  if (llm !== undefined) return llm;
  try {
    llm = TurboModuleRegistry.get<AppleLlm>('NativeAppleLLM');
  } catch {
    llm = null;
  }
  return llm;
}

/** Si se le puede preguntar ahora mismo. Falso tambien con el modelo apagado. */
export function modelReady(): boolean {
  try {
    return model()?.isAvailable() === true;
  } catch {
    return false;
  }
}

/**
 * Una respuesta con la forma del esquema, ya en texto. Lo que no se puede leer se
 * devuelve como error y no como una respuesta vacia: una frase que el escribio y que no
 * llego a ninguna parte tiene que decirlo.
 */
export async function askModel(
  said: readonly Said[],
  schema: object,
  signature: string,
): Promise<string> {
  const apple = model();
  if (apple === null) throw new Error('Esta versión de la app no trae el modelo.');

  const answer = await apple.generateText([{ role: 'system', content: signature }, ...said], {
    schema,
    // Bajo a proposito: esto no escribe prosa, traduce una frase a una linea exacta.
    temperature: 0.1,
    maxTokens: 220,
  });

  const text = answer
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
    .trim();

  if (text === '') throw new Error('El modelo contestó vacío.');
  return text;
}
