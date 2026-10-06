export type AssistantCredentials = {
  groqApiKey: string;
  tavilyApiKey: string;
  provider: 'apple' | 'groq';
};

export type CredentialStatus = {
  provider: AssistantCredentials['provider'];
  hasGroq: boolean;
  hasTavily: boolean;
};

export type CredentialStorage = {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  remove: () => Promise<void>;
};

const EMPTY: AssistantCredentials = { groqApiKey: '', tavilyApiKey: '', provider: 'apple' };

function key(value: unknown, service: string): string {
  if (typeof value !== 'string') throw new Error(`Falta la clave de ${service}.`);
  const clean = value.trim();
  if (clean !== '' && !/^[A-Za-z0-9._-]{16,512}$/.test(clean)) {
    throw new Error(`La clave de ${service} no tiene un formato válido.`);
  }
  return clean;
}

function credentials(value: unknown): AssistantCredentials {
  if (typeof value !== 'object' || value === null) throw new Error('Configuración no válida.');
  const body = value as Record<string, unknown>;
  if (body.provider !== 'apple' && body.provider !== 'groq') {
    throw new Error('Elige Apple o Groq.');
  }
  const result = {
    groqApiKey: key(body.groqApiKey, 'Groq'),
    tavilyApiKey: key(body.tavilyApiKey, 'Tavily'),
    provider: body.provider,
  };
  if (result.provider === 'groq' && !result.groqApiKey) {
    throw new Error('Agrega la clave de Groq para usar la nube.');
  }
  return result as AssistantCredentials;
}

export function credentialStatus(value: AssistantCredentials): CredentialStatus {
  return {
    provider: value.provider,
    hasGroq: value.groqApiKey !== '',
    hasTavily: value.tavilyApiKey !== '',
  };
}

export function parseCredentialFile(text: string): AssistantCredentials {
  if (text.length > 8192)
    throw new Error('Ese archivo es demasiado grande para contener dos claves.');
  const fields = new Map<string, string>();
  for (const source of text.split(/\r?\n/)) {
    const line = source.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?(GROQ_API_KEY|TAVILY_API_KEY)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || fields.has(match[1]!)) {
      throw new Error(
        'Usa el archivo de claves con GROQ_API_KEY y TAVILY_API_KEY, una vez cada una.',
      );
    }
    let value = match[2]!;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields.set(match[1]!, value);
  }
  const result = credentials({
    groqApiKey: fields.get('GROQ_API_KEY'),
    tavilyApiKey: fields.get('TAVILY_API_KEY'),
    provider: 'groq',
  });
  if (!result.tavilyApiKey) throw new Error('Falta la clave de Tavily para buscar recetas.');
  return result;
}

export function createCredentialStore(storage: CredentialStorage) {
  let pending: Promise<void> = Promise.resolve();
  const load = async (): Promise<AssistantCredentials> => {
    let raw: string | null;
    try {
      raw = await storage.read();
    } catch {
      throw new Error(
        'No pude abrir las claves guardadas. Desbloquea el teléfono e inténtalo otra vez.',
      );
    }
    if (raw === null) return { ...EMPTY };
    try {
      return credentials(JSON.parse(raw));
    } catch {
      throw new Error('Las claves guardadas no se pueden leer. Vuelve a configurarlas en Ajustes.');
    }
  };
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = pending.then(work);
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  return {
    load,
    save: (changes: Partial<AssistantCredentials>) =>
      enqueue(async () => {
        const next = credentials({ ...(await load()), ...changes });
        try {
          await storage.write(JSON.stringify(next));
        } catch {
          throw new Error('No pude guardar las claves. La configuración anterior sigue activa.');
        }
        return credentialStatus(next);
      }),
    replace: (next: AssistantCredentials) =>
      enqueue(async () => {
        const checked = credentials(next);
        try {
          await storage.write(JSON.stringify(checked));
        } catch {
          throw new Error('No pude guardar las claves. La configuración anterior sigue activa.');
        }
        return credentialStatus(checked);
      }),
    clear: () =>
      enqueue(async () => {
        try {
          await storage.remove();
        } catch {
          throw new Error('No pude borrar las claves. Inténtalo otra vez.');
        }
        return credentialStatus(EMPTY);
      }),
  };
}
