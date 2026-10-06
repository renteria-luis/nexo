import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shortDate, todayIso } from '../core/dates.ts';
import { nodes, renderModule, textOf } from './test-render.ts';

function chatFixture(
  extra: Record<string, any> = {},
  model: Record<string, any> = {},
  recipes: Record<string, any> = {},
) {
  const calls: string[] = [];
  const data = {
    exerciseId: null as string | null,
    state: {
      phase: 'ready',
      loaded: {
        unit: 'lb',
        scoreHistory: [],
        today: {},
        exercise: { exercises: [] },
      },
    },
    askLocal: async () => 'Respuesta comprobada.',
    loadPantry: async () => [],
    lastChatId: async () => null,
    loadChat: async () => [],
    loadChats: async () => [],
    openChat: async () => 'chat',
    sayInChat: async (_id: string, role: string, body: string) => {
      calls.push(body);
      return { id: calls.length, role, body };
    },
    ...extra,
  };
  const screen = renderModule('src/ui/Chat.tsx', {
    '../shell/AppData.tsx': { useAppData: () => data },
    '../shell/model.ts': {
      modelReady: () => false,
      modelStatus: async () => ({
        provider: 'apple',
        ready: model.modelReady?.() ?? false,
        reason: 'Modelo no disponible.',
      }),
      ...model,
    },
    '../shell/recipes.ts': {
      suggestRecipe: async () => 'Receta comprobada.',
      publicRecipeUrl: (value: string) => (/^https:\/\//.test(value) ? value : null),
      ...recipes,
    },
    './Button.tsx': { Button: 'Button' },
    './IconButton.tsx': { IconButton: 'IconButton' },
    './TextField.tsx': { TextField: 'TextField' },
    './icons.ts': { List: 'List', Plus: 'Plus', Send: 'Send', X: 'X' },
  }).mount('Chat', { onClose() {} });
  return { screen, calls, data };
}

test('chat history and its accessible label use the local day of an evening chat', async () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Toronto';
  try {
    for (const startedAt of [
      '2026-10-01T01:15:00.000Z',
      '2026-12-02T01:15:00.000Z',
      '2027-01-01T02:00:00.000Z',
    ]) {
      const { screen } = chatFixture({
        loadChats: async () => [{ id: 'old', startedAt, opener: 'Evening chat' }],
      });
      const tree = await screen.settle();
      const history = nodes(tree).find(
        (node) => node.props.accessibilityLabel === 'Chats anteriores',
      );
      assert.ok(history);
      await history.props.onPress();
      const row = nodes(await screen.settle()).find(
        (node) => textOf(node).includes('Evening chat') && node.type === 'Pressable',
      );
      assert.ok(row);
      const local = todayIso(new Date(startedAt));
      assert.equal(row.props.accessibilityLabel, `Abrir el chat del ${local}`);
      assert.ok(textOf(row).includes(shortDate(local)));
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

async function submitChat(screen: ReturnType<typeof chatFixture>['screen'], message: string) {
  let tree = await screen.settle();
  nodes(tree)
    .find((node) => node.type === 'TextField')!
    .props.onChange(message);
  tree = screen.render();
  await nodes(tree)
    .find((node) => node.props.accessibilityLabel === 'Enviar')!
    .props.onPress();
  return screen.settle();
}

test('an initial history failure leaves the chat usable', async () => {
  const { screen, calls } = chatFixture({
    lastChatId: async () => {
      throw new Error('history unavailable');
    },
  });
  assert.match(textOf(await screen.settle()), /No se pudo abrir el chat/);
  await submitChat(screen, 'proteina consumida ayer');
  assert.match(calls.at(-1)!, /Respuesta comprobada/);
});

test('past-day water and creatine confirmations disclose existing values before any write', async () => {
  for (const [message, log, expected] of [
    ['ayer agua 710', { water_ml: 1420 }, /1\.42 L/],
    ['ayer agua 710', null, /no hay agua anotada/],
    ['ayer creatina', { creatine_taken: 1 }, /ya está tomada/],
    ['ayer creatina', { creatine_taken: 0 }, /no la tomaste/],
    ['ayer creatina', null, /no está anotada/],
  ] as const) {
    let writes = 0;
    const { screen, calls } = chatFixture({
      loadDay: async () => ({ day: { log } }),
      addToDayOn: async () => {
        writes += 1;
      },
      editDay: async () => {
        writes += 1;
      },
    });
    const tree = await submitChat(screen, message);
    assert.match(calls.at(-1)!, expected);
    assert.equal(writes, 0);
    assert.ok(nodes(tree).some((node) => node.props.accessibilityLabel === 'Sí'));
  }
});

test('past-day sets are refused before confirmation in both input paths', async () => {
  for (const translated of [false, true]) {
    let writes = 0;
    const { screen, calls } = chatFixture(
      {
        logSet: () => {
          writes += 1;
        },
      },
      translated
        ? {
            modelReady: () => true,
            askModel: async () => ({
              tipo: 'anotar',
              comando: 'ayer serie 65x8',
              pregunta: '',
              fecha: '',
              ejercicio: '',
            }),
          }
        : {},
    );
    const tree = await submitChat(
      screen,
      translated ? 'ayer hice una serie de 65 lb por 8 reps' : 'ayer serie 65x8',
    );
    assert.match(calls.at(-1)!, /Las series de otro día/);
    assert.equal(writes, 0);
    assert.ok(!nodes(tree).some((node) => node.props.accessibilityLabel === 'Sí'));
  }
});

test('natural questions use local data without a model and preserve punctuation and dates', async () => {
  for (const message of [
    'proteina consumida ayer',
    'proteína consumida ayer?',
    '¿proteína consumida ayer?',
  ]) {
    const requests: any[] = [];
    let modelCalls = 0;
    const { screen, calls } = chatFixture(
      {
        askLocal: async (request: any) => {
          requests.push(request);
          return 'Ayer registraste 99 g de proteína.';
        },
      },
      {
        askModel: async () => {
          modelCalls += 1;
          throw new Error('must stay local');
        },
      },
    );
    await submitChat(screen, message);
    assert.equal(modelCalls, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].question, 'proteina');
    assert.equal(requests[0].date, 'ayer');
    assert.match(calls.at(-1)!, /99 g/);
  }
});

test('a follow-up retains the last local topic and changes its day', async () => {
  const requests: any[] = [];
  const { screen } = chatFixture({
    askLocal: async (request: any) => {
      requests.push(request);
      return 'Proteína registrada.';
    },
  });
  await submitChat(screen, 'proteina consumida hoy');
  await submitChat(screen, 'y ayer?');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].question, 'proteina');
  assert.equal(requests[1].date, 'ayer');
});

test('the model cannot copy a numeric example into an unrelated write', async () => {
  let writes = 0;
  const { screen, calls } = chatFixture(
    {
      loadDay: async () => ({ day: { log: null } }),
      editDay: async () => {
        writes += 1;
      },
    },
    {
      modelReady: () => true,
      askModel: async () => ({ tipo: 'anotar', comando: 'ayer sueno 390m' }),
    },
  );
  const tree = await submitChat(screen, 'quiero revisar lo que llevo');
  assert.equal(writes, 0);
  assert.ok(!nodes(tree).some((node) => node.props.accessibilityLabel === 'Sí'));
  assert.doesNotMatch(calls.at(-1)!, /¿Lo escribo/);
});

test('a database failure while preparing confirmation never leaves an active write', async () => {
  const { screen, calls } = chatFixture(
    {
      loadDay: async () => {
        throw new Error('lectura fallida');
      },
    },
    {
      modelReady: () => true,
      askModel: async () => ({ tipo: 'anotar', comando: 'ayer pasos 9000' }),
    },
  );
  const tree = await submitChat(screen, 'ayer caminé nueve mil pasos');
  assert.ok(!nodes(tree).some((node) => node.props.accessibilityLabel === 'Sí'));
  assert.match(calls.at(-1)!, /lectura fallida/);
  assert.doesNotMatch(calls.at(-1)!, /El modelo falló/);
});

test('failed current-day writes are awaited and never reported as saved', async () => {
  const { screen, calls } = chatFixture({
    editDay: async () => {
      throw new Error('no se pudo guardar');
    },
  });
  await submitChat(screen, 'pasos 9000');
  assert.match(calls.at(-1)!, /no se pudo guardar/);
  assert.doesNotMatch(calls.at(-1)!, /^9000 pasos/);
});

test('a set confirmation is refused if its exercise, session or unit changes', async () => {
  for (const change of ['exercise', 'session', 'unit']) {
    let writes = 0;
    const state = {
      phase: 'ready',
      loaded: {
        unit: 'lb',
        today: { session: { id: 'session-a' }, log: null },
        exercise: {
          exercises: [
            { id: 'press', name_es: 'Press inclinado' },
            { id: 'fly', name_es: 'Aperturas' },
          ],
        },
      },
    };
    const { screen, calls, data } = chatFixture(
      {
        state,
        exerciseId: 'press',
        loadDay: async () => ({ day: { log: null } }),
        logSet: async () => {
          writes += 1;
        },
      },
      {
        modelReady: () => true,
        askModel: async () => ({ tipo: 'anotar', comando: 'serie 90x8' }),
      },
    );
    await submitChat(screen, 'hice una serie de 90 lb por 8 reps');
    assert.match(calls.at(-1)!, /Press inclinado/);
    if (change === 'exercise') data.exerciseId = 'fly';
    if (change === 'session') state.loaded.today.session.id = 'session-b';
    if (change === 'unit') state.loaded.unit = 'kg';
    data.state = { ...state } as unknown as typeof data.state;
    const tree = await screen.settle();
    await nodes(tree)
      .find((node) => node.props.accessibilityLabel === 'Sí')!
      .props.onPress();
    await screen.settle();
    assert.equal(writes, 0, change);
    assert.match(calls.at(-1)!, /cambió|cambiaron/i);
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function beginMessage(screen: ReturnType<typeof chatFixture>['screen'], message: string) {
  let tree = await screen.settle();
  nodes(tree)
    .find((node) => node.type === 'TextField')!
    .props.onChange(message);
  tree = screen.render();
  const completion = nodes(tree)
    .find((node) => node.type === 'TextField')!
    .props.onSubmit();
  await screen.settle();
  return { completion };
}

test('new chats discard late replies and release the request lock', async () => {
  const answer = deferred<any>();
  let signal: AbortSignal | undefined;
  const { screen, calls } = chatFixture(
    {},
    {
      modelReady: () => true,
      askModel: async (
        _messages: unknown,
        _schema: unknown,
        _instructions: unknown,
        options: any,
      ) => {
        signal = options?.signal;
        return answer.promise;
      },
    },
  );
  const { completion } = await beginMessage(screen, 'necesito orientación');
  let tree = await screen.settle();
  await nodes(tree)
    .find((node) => node.props.accessibilityLabel === 'Chat nuevo')!
    .props.onPress();
  assert.equal(signal?.aborted, true);
  answer.resolve({ tipo: 'nada', respuesta: 'respuesta antigua' });
  await completion;
  tree = await screen.settle();
  assert.doesNotMatch(textOf(tree), /respuesta antigua/);
  assert.equal(calls.length, 1);
  await submitChat(screen, 'proteina hoy');
  assert.match(calls.at(-1)!, /Respuesta comprobada/);
});

test('keyboard submission cannot start another request while one is active', async () => {
  const answer = deferred<any>();
  let models = 0;
  const { screen } = chatFixture(
    {},
    {
      modelReady: () => true,
      askModel: async () => {
        models += 1;
        return answer.promise;
      },
    },
  );
  const first = await beginMessage(screen, 'necesito orientación');
  const second = await beginMessage(screen, 'otra cosa');
  assert.equal(models, 1);
  answer.resolve({ tipo: 'nada', respuesta: 'no sé' });
  await Promise.all([first.completion, second.completion]);
});

test('a new recipe reads actual pantry and never requires a saved recipe or writes', async () => {
  const stock = [{ id: 'eggs', name: 'Huevos', kind: 'counted', quantity: 6 }];
  let received: any;
  const { screen, calls } = chatFixture(
    { loadPantry: async () => stock },
    {},
    {
      suggestRecipe: async (request: any) => {
        received = request;
        return 'Tortilla: 2 porciones. Falta comprar cebolla. Fuente: https://example.org/tortilla';
      },
    },
  );
  await submitChat(screen, 'dame una receta nueva con huevos');
  assert.deepEqual(received.pantry, stock);
  assert.equal(received.request, 'dame una receta nueva con huevos');
  assert.match(calls.at(-1)!, /Falta comprar cebolla/);
});

test('free model text cannot claim personal facts without a local query', async () => {
  const { screen, calls } = chatFixture(
    {},
    {
      modelReady: () => true,
      askModel: async () => ({ tipo: 'nada', respuesta: 'Ayer consumiste 200 g y tienes pollo.' }),
    },
  );
  await submitChat(screen, 'dime algo sobre mí');
  assert.doesNotMatch(calls.at(-1)!, /200 g|tienes pollo/);
});

test('greetings work without a model and a resumed chat retains its previous topic', async () => {
  const requests: any[] = [];
  const { screen, calls } = chatFixture({
    lastChatId: async () => 'old',
    loadChat: async () => [
      { id: 'first', role: 'me', body: 'proteína de ayer', createdAt: new Date().toISOString() },
      {
        id: 'second',
        role: 'app',
        body: 'Ayer: 80 g registrados.',
        createdAt: new Date().toISOString(),
      },
    ],
    askLocal: async (request: any) => {
      requests.push(request);
      return 'Respuesta comprobada.';
    },
  });
  await screen.settle();
  await submitChat(screen, 'hola!');
  assert.match(calls.at(-1)!, /Hola/);
  await submitChat(screen, 'y ayer');
  assert.equal(requests.at(-1)?.question, 'proteina');
  assert.equal(requests.at(-1)?.date, 'ayer');
});

test('model write proposals keep the original date even when the command omits it', async () => {
  const { screen, calls } = chatFixture(
    { loadDay: async () => ({ day: { log: null } }) },
    { modelReady: () => true, askModel: async () => ({ tipo: 'anotar', comando: 'pasos 9000' }) },
  );
  await submitChat(screen, 'ayer caminé nueve mil pasos');
  assert.match(calls.at(-1)!, /pasos 9000/);
  assert.match(calls.at(-1)!, /¿Lo escribo/);
  assert.ok(nodes(await screen.settle()).some((node) => node.props.accessibilityLabel === 'Sí'));
});

test('interpreted questions preserve an explicit date that the model drops or changes', async () => {
  for (const date of ['', 'hoy']) {
    const requests: any[] = [];
    const { screen } = chatFixture(
      {
        askLocal: async (request: any) => {
          requests.push(request);
          return 'Dato consultado.';
        },
      },
      {
        modelReady: () => true,
        askModel: async () => ({ tipo: 'preguntar', pregunta: 'proteina', fecha: date }),
      },
    );
    await submitChat(screen, 'consumo proteico ayer');
    assert.equal(requests.at(-1)?.date, 'ayer');
  }
});
