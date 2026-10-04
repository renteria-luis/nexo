import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shortDate, todayIso } from '../core/dates.ts';
import { nodes, renderModule, textOf } from './test-render.ts';

function chatFixture(extra: Record<string, any> = {}, model: Record<string, any> = {}) {
  const calls: string[] = [];
  const data = {
    state: {
      phase: 'ready',
      loaded: {
        unit: 'lb',
        scoreHistory: [],
        today: {},
        exercise: { exercises: [] },
      },
    },
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
    '../shell/model.ts': { modelReady: () => false, ...model },
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
      translated ? 'anota una serie de ayer' : 'ayer serie 65x8',
    );
    assert.match(calls.at(-1)!, /Las series de otro día/);
    assert.equal(writes, 0);
    assert.ok(!nodes(tree).some((node) => node.props.accessibilityLabel === 'Sí'));
  }
});

test('an unknown explicit score date does not silently query today', async () => {
  let queries = 0;
  const { screen, calls } = chatFixture(
    {
      loadDay: async () => {
        queries += 1;
        return { report: { score: 99 } };
      },
    },
    {
      modelReady: () => true,
      askModel: async () => ({
        tipo: 'preguntar',
        pregunta: 'nota',
        fecha: 'algún día',
      }),
    },
  );
  await submitChat(screen, 'qué nota saqué algún día');
  assert.equal(queries, 0);
  assert.match(calls.at(-1)!, /No sé qué día/);
});

test('exercise questions match separated words in the recorded exercise name', async () => {
  const { screen, calls } = chatFixture(
    {
      loadCharts: async () => ({
        trends: [
          {
            name: 'Press de pecho sentado en máquina',
            e1rm: [{ value: 50, date: '2026-09-29' }],
          },
        ],
      }),
    },
    {
      modelReady: () => true,
      askModel: async () => ({
        tipo: 'preguntar',
        pregunta: 'marca',
        ejercicio: 'press pecho',
      }),
    },
  );
  await submitChat(screen, 'mi mejor press pecho');
  assert.match(calls.at(-1)!, /Tu mejor Press de pecho/);
});
