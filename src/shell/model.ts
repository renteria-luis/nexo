import { TurboModuleRegistry, type TurboModule } from 'react-native';

import { loadAssistantCredentials } from './assistant-credentials.ts';
import { askGroq, CloudError, withModelDeadline, type ModelMessage } from './cloud.ts';

type Part = { type: string; text?: string };

interface AppleLlm extends TurboModule {
  isAvailable(): boolean;
  generateText(
    messages: ModelMessage[],
    options: { schema?: object; temperature?: number; maxTokens?: number },
  ): Promise<Part[]>;
}

let llm: AppleLlm | null | undefined;

function model(): AppleLlm | null {
  if (llm !== undefined) return llm;
  try {
    // The package index enforces a native module even in the browser.
    llm = TurboModuleRegistry.get<AppleLlm>('NativeAppleLLM');
  } catch {
    llm = null;
  }
  return llm;
}

export function modelReady(): boolean {
  try {
    return model()?.isAvailable() === true;
  } catch {
    return false;
  }
}

export async function modelStatus(): Promise<{
  provider: 'apple' | 'groq';
  ready: boolean;
  reason: string | null;
}> {
  const credentials = await loadAssistantCredentials();
  const ready =
    credentials.provider === 'groq' ? credentials.groqApiKey.trim() !== '' : modelReady();
  return {
    provider: credentials.provider,
    ready,
    reason: ready
      ? null
      : credentials.provider === 'groq'
        ? 'Añade la clave de Groq en Ajustes.'
        : 'El modelo local no está disponible. Revisa Apple Intelligence o elige Groq en Ajustes.',
  };
}

export async function askModel(
  said: readonly ModelMessage[],
  schema: object,
  signature: string,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  if (options.signal?.aborted) throw new CloudError('cancelled', 'el modelo');
  const credentials = await loadAssistantCredentials();
  const messages: ModelMessage[] = [{ role: 'system', content: signature }, ...said];
  if (credentials.provider === 'groq') {
    return askGroq({ apiKey: credentials.groqApiKey, messages, schema, signal: options.signal });
  }
  const apple = model();
  if (apple === null || !modelReady())
    throw new Error(
      'El modelo local no está disponible. Revisa Apple Intelligence o elige Groq en Ajustes.',
    );
  try {
    return await withModelDeadline(
      async () => {
        const answer = await apple.generateText(messages, {
          schema,
          temperature: 0.1,
          maxTokens: 500,
        });
        const text = answer
          .filter((part) => part.type === 'text')
          .map((part) => part.text ?? '')
          .join('')
          .trim();
        if (text === '') throw new CloudError('invalid', 'El modelo local');
        return text;
      },
      'El modelo local',
      options,
    );
  } catch (error) {
    if (error instanceof CloudError) throw error;
    throw new CloudError('invalid', 'El modelo local');
  }
}
