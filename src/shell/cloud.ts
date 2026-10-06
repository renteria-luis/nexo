export type ModelMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type CloudOptions = {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

export type CloudFailure =
  'credentials' | 'quota' | 'timeout' | 'cancelled' | 'network' | 'server' | 'invalid';

export class CloudError extends Error {
  readonly code: CloudFailure;

  constructor(code: CloudFailure, service: string) {
    const messages: Record<CloudFailure, string> = {
      credentials: `Revisa la clave de ${service} en Ajustes.`,
      quota: `Se alcanzó el límite gratuito de ${service}. Inténtalo cuando se renueve; no se activó ningún plan de pago.`,
      timeout: `${service} tardó demasiado. Inténtalo de nuevo.`,
      cancelled: 'Consulta cancelada.',
      network: `No pude conectar con ${service}. Revisa tu conexión.`,
      server: `${service} no está disponible ahora. Inténtalo después.`,
      invalid: `${service} devolvió una respuesta que no pude verificar. Inténtalo de nuevo.`,
    };
    super(messages[code]);
    this.name = 'CloudError';
    this.code = code;
  }
}

export async function withModelDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  service: string,
  options: Pick<CloudOptions, 'signal' | 'timeoutMs'> = {},
): Promise<T> {
  const controller = new AbortController();
  let rejectWait: (error: Error) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectWait = reject;
  });
  const cancel = () => {
    controller.abort();
    rejectWait(new CloudError('cancelled', service));
  };
  if (options.signal?.aborted) throw new CloudError('cancelled', service);
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    controller.abort();
    rejectWait(new CloudError('timeout', service));
  }, options.timeoutMs ?? 25_000);
  try {
    return await Promise.race([work(controller.signal), interrupted]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}

const ENDPOINTS = {
  groq: ['Groq', 'https://api.groq.com/openai/v1/chat/completions'],
  search: ['Tavily', 'https://api.tavily.com/search'],
  extract: ['Tavily', 'https://api.tavily.com/extract'],
} as const;

export async function cloudJson(
  endpoint: keyof typeof ENDPOINTS,
  apiKey: string,
  body: object,
  options: CloudOptions = {},
): Promise<unknown> {
  const [service, url] = ENDPOINTS[endpoint];
  if (apiKey.trim() === '') throw new CloudError('credentials', service);
  return withModelDeadline(
    async (signal) => {
      for (let attempt = 0; ; attempt += 1) {
        if (signal.aborted)
          throw new CloudError(options.signal?.aborted ? 'cancelled' : 'timeout', service);
        let response: Response;
        try {
          response = await (options.fetcher ?? fetch)(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'User-Agent': 'Nexo/1.0',
            },
            body: JSON.stringify(body),
            signal,
          });
        } catch {
          if (signal.aborted)
            throw new CloudError(options.signal?.aborted ? 'cancelled' : 'timeout', service);
          throw new CloudError('network', service);
        }
        if (response.status === 401 || response.status === 403)
          throw new CloudError('credentials', service);
        if ([402, 429, 432, 433].includes(response.status)) throw new CloudError('quota', service);
        if (response.status >= 500) throw new CloudError('server', service);
        if (endpoint === 'groq' && response.status === 400 && attempt === 0) {
          let error: { error?: { code?: string } } | null;
          try {
            error = await response.json();
          } catch {
            throw new CloudError('invalid', service);
          }
          // The provider can reject its own generated JSON even with strict output.
          if (error?.error?.code === 'json_validate_failed') continue;
        }
        if (!response.ok) throw new CloudError('invalid', service);
        try {
          return await response.json();
        } catch {
          throw new CloudError('invalid', service);
        }
      }
    },
    service,
    options,
  );
}

type Schema = {
  type?: string | readonly string[];
  enum?: readonly unknown[];
  properties?: Record<string, Schema>;
  required?: readonly string[];
  items?: Schema;
  additionalProperties?: boolean;
};

function strictSchema(schema: Schema): Schema {
  if (schema.type === 'object') {
    const properties = Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [key, strictSchema(value)]),
    );
    return {
      ...schema,
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    };
  }
  if (schema.items) return { ...schema, items: strictSchema(schema.items) };
  return schema;
}

function matchesSchema(value: unknown, schema: Schema): boolean {
  if (schema.enum && !schema.enum.includes(value)) return false;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (
    !types.includes(type) &&
    !(type === 'number' && types.includes('integer') && Number.isInteger(value))
  )
    return false;
  if (type === 'number' && !Number.isFinite(value)) return false;
  if (Array.isArray(value))
    return !!schema.items && value.every((item) => matchesSchema(item, schema.items!));
  if (type === 'object') {
    const object = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    return (
      (schema.required ?? []).every((key) => Object.hasOwn(object, key)) &&
      Object.entries(object).every(([key, item]) =>
        Object.hasOwn(properties, key)
          ? matchesSchema(item, properties[key])
          : schema.additionalProperties !== false,
      )
    );
  }
  return true;
}

export const GROQ_MODEL = 'openai/gpt-oss-120b';

export async function askGroq(
  input: {
    apiKey: string;
    messages: readonly ModelMessage[];
    schema: object;
    model?: string;
    maxTokens?: number;
  } & CloudOptions,
): Promise<string> {
  const schema = strictSchema(input.schema);
  const raw = await cloudJson(
    'groq',
    input.apiKey,
    {
      model: input.model ?? GROQ_MODEL,
      messages: input.messages,
      temperature: 0.1,
      reasoning_effort: 'low',
      max_completion_tokens: input.maxTokens ?? 1_600,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'response', strict: true, schema },
      },
    },
    input,
  );
  const body = raw as {
    choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[];
  } | null;
  const choice = body?.choices?.[0];
  const content = choice?.message?.content;
  if (
    choice?.finish_reason !== 'stop' ||
    choice.message?.refusal ||
    typeof content !== 'string' ||
    content.length > 60_000 ||
    content.includes(input.apiKey)
  ) {
    throw new CloudError('invalid', 'Groq');
  }
  try {
    if (!matchesSchema(JSON.parse(content), schema)) throw new Error();
  } catch {
    throw new CloudError('invalid', 'Groq');
  }
  return content;
}
