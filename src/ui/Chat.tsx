import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import type { ChatMessage, ChatSummary } from '../core/assistant.ts';
import { COMMAND_HELP, parseCommand, setLoggedReply, type Command } from '../core/commands.ts';
import { shortDate, todayIso, type IsoDate } from '../core/dates.ts';
import { INTENT_SCHEMA, instructions, readIntent } from '../core/intent.ts';
import {
  extractQuestionDate,
  readQuestion,
  resolveQuestionDates,
  type ReadRequest,
} from '../core/questions.ts';
import { toKg, type WeightUnit } from '../core/units.ts';
import { commandLine, interpretedCommand } from '../core/write-intent.ts';
import { changePantryItem, findPantryItem, stockOf } from '../pantry/index.ts';
import { useAppData } from '../shell/AppData.tsx';
import { askModel, modelStatus } from '../shell/model.ts';
import { publicRecipeUrl, suggestRecipe } from '../shell/recipes.ts';

import { Button } from './Button.tsx';
import { List, Plus, Send, X } from './icons.ts';
import { IconButton } from './IconButton.tsx';
import { TextField } from './TextField.tsx';
import { font, hardShadow, sheet, shape } from './theme.ts';

type SetTarget = {
  exerciseId: string | null;
  sessionId: string | null;
  unit: WeightUnit;
  name: string;
};
type Pending = { command: Command; date: IsoDate; target: SetTarget | null };
type Request = { generation: number; controller: AbortController };
const YES = ['si', 'sí', 'dale', 'ok', 'hazlo'];
const NO = ['no', 'cancela', 'nada'];
const CHAT_PAGE = 50;
const plain = (text: string) => text.toLowerCase().trim().replace(/[.!]$/g, '');

const Bubble = memo(function Bubble({
  role,
  body,
  onSource,
}: {
  role: 'me' | 'app';
  body: string;
  onSource: (url: string) => void;
}) {
  return (
    <View style={[styles.bubble, role === 'me' ? styles.mine : styles.theirs]}>
      <Text style={role === 'me' ? styles.mineText : styles.theirsText}>
        {body.split(/(https:\/\/[^\s]+)/g).map((part, index) => {
          const url = role === 'app' ? publicRecipeUrl(part) : null;
          return url === null ? (
            part
          ) : (
            <Text
              key={index}
              accessibilityRole="link"
              accessibilityLabel="Abrir fuente de la receta"
              onPress={() => onSource(url)}
              style={{ textDecorationLine: 'underline' }}
            >
              {part}
            </Text>
          );
        })}
      </Text>
    </View>
  );
});

export function Chat({ onClose }: { onClose: () => void }) {
  const {
    state,
    exerciseId,
    logSet,
    editDay,
    addToDayOn,
    loadDay,
    askLocal,
    loadPantry,
    changePantry,
    loadChat,
    loadChats,
    lastChatId,
    openChat,
    sayInChat,
  } = useAppData();
  const [chatId, setChatId] = useState<string | null>(null);
  const [said, setSaid] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [history, setHistory] = useState<ChatSummary[] | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shown, setShown] = useState(CHAT_PAGE);
  const [older, setOlder] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const generation = useRef(0);
  const active = useRef<Request | null>(null);
  const currentChat = useRef<string | null>(null);
  const previousQuestion = useRef<ReadRequest | null>(null);
  const recipeRequest = useRef<string | null>(null);
  const target = useRef<SetTarget>({ exerciseId: null, sessionId: null, unit: 'kg', name: '' });
  useEffect(() => {
    if (state.phase !== 'ready') return;
    target.current = {
      exerciseId,
      sessionId: state.loaded.today.session?.id ?? null,
      unit: state.loaded.unit,
      name:
        state.loaded.exercise.exercises.find((item) => item.id === exerciseId)?.name_es ??
        'el ejercicio abierto',
    };
  }, [state, exerciseId]);
  const valid = (request: Request) =>
    request.generation === generation.current && !request.controller.signal.aborted;

  const cancel = useCallback(() => {
    generation.current += 1;
    active.current?.controller.abort();
    active.current = null;
    setActivity(null);
    setNotice(null);
    setPending(null);
  }, []);

  const showPage = useCallback(
    async (id: string, count: number, version = generation.current) => {
      const page = await loadChat(id, count + 1);
      if (version !== generation.current) return;
      setOlder(page.length > count);
      setSaid(page.slice(-count));
      setShown(count);
      let question: ReadRequest | null = null;
      let recipe: string | null = null;
      for (const message of page) {
        if (message.role !== 'me') continue;
        const at = Number.isNaN(Date.parse(message.createdAt))
          ? todayIso()
          : todayIso(new Date(message.createdAt));
        const next = readQuestion(message.body, question, at);
        if (next === null) continue;
        if (next.question === 'receta') {
          recipe =
            question?.question === 'receta' && recipe !== null
              ? `${recipe}\nCambio pedido: ${message.body}`
              : message.body;
        } else if (!['marca', 'e1rm', 'entreno', 'despensa'].includes(next.question)) {
          const dates = resolveQuestionDates(next.date, at);
          if (dates !== null)
            next.date = dates.from === dates.to ? dates.from : `entre ${dates.from} y ${dates.to}`;
        }
        question = next;
      }
      previousQuestion.current = question;
      recipeRequest.current = recipe;
    },
    [loadChat],
  );

  useEffect(() => {
    const version = generation.current;
    void lastChatId()
      .then(async (id) => {
        if (version !== generation.current || active.current !== null) return;
        currentChat.current = id;
        setChatId(id);
        if (id !== null) await showPage(id, CHAT_PAGE, version);
      })
      .catch((error: unknown) => {
        if (version === generation.current)
          setNotice(
            `No se pudo abrir el chat: ${error instanceof Error ? error.message : String(error)}`,
          );
      });
    return () => {
      generation.current += 1;
      active.current?.controller.abort();
      active.current = null;
    };
  }, [lastChatId, showPage]);

  const say = async (
    request: Request,
    role: 'me' | 'app',
    body: string,
    into?: string,
  ): Promise<string | null> => {
    if (!valid(request)) return null;
    const id = into ?? currentChat.current ?? (await openChat());
    if (!valid(request)) return null;
    currentChat.current = id;
    setChatId(id);
    const message = await sayInChat(id, role, body);
    if (valid(request)) setSaid((before) => [...before, message]);
    return id;
  };

  if (state.phase !== 'ready') return null;
  const dayOf = (date: IsoDate) => (date === todayIso() ? 'hoy' : `el ${shortDate(date)}`);

  const run = async (entry: Pending, request: Request): Promise<string> => {
    const { command, date, target: confirmed } = entry;
    const when = dayOf(date);
    switch (command.kind) {
      case 'help':
        return [
          'Puedes consultar tus registros, tu despensa o pedir una receta. Para anotar:',
          ...COMMAND_HELP,
        ].join('\n');
      case 'water': {
        const { day } = await loadDay(date);
        if (!valid(request)) return 'Solicitud cancelada.';
        const total = (day.log?.water_ml ?? 0) + command.ml;
        await addToDayOn(date, { waterMl: command.ml });
        return `Agua +${command.ml} ml ${when}, van ${(total / 1000).toFixed(2)} L`;
      }
      case 'weight':
        await editDay(date, { weightKg: command.value });
        return `Peso de ${when}: ${command.value} kg`;
      case 'steps':
        await editDay(date, { steps: command.steps });
        return `${command.steps} pasos ${when}`;
      case 'sleep':
        await editDay(date, { sleepMinutes: command.minutes, sleepSource: 'manual' });
        return `Sueño de ${when}: ${Math.floor(command.minutes / 60)} h ${command.minutes % 60} min`;
      case 'creatine':
        await editDay(date, { creatineTaken: command.taken });
        return command.taken ? `Creatina tomada ${when}` : `Creatina no tomada ${when}`;
      case 'set': {
        if (date !== todayIso())
          return 'Las series de otro día se anotan en la pantalla de ese día.';
        const now = target.current;
        if (
          confirmed !== null &&
          (confirmed.exerciseId !== now.exerciseId ||
            confirmed.sessionId !== now.sessionId ||
            confirmed.unit !== now.unit)
        ) {
          return 'Cambió el ejercicio, el entreno o la unidad. No anoté la serie; repítela para confirmar el destino actual.';
        }
        if (now.sessionId === null) return 'No hay entreno abierto, no anoté nada.';
        if (now.exerciseId === null) return 'Elige el ejercicio en Entreno y repite el comando.';
        await logSet(toKg(command.weight, now.unit), command.reps, { rpe: command.rpe });
        return setLoggedReply(command.weight, now.unit, command.reps, now.name);
      }
      case 'pantry':
        return changePantry(command);
    }
  };

  const already = async ({ command, date, target: confirmed }: Pending): Promise<string> => {
    if (command.kind === 'set')
      return ` Va a ${confirmed?.name ?? target.current.name}, en ${confirmed?.unit ?? target.current.unit}.`;
    if (command.kind === 'pantry') {
      const item = findPantryItem(await loadPantry(), command.item);
      return typeof item === 'string' ? '' : ` Ahora dice ${item.name}: ${stockOf(item)}.`;
    }
    const log = (await loadDay(date)).day.log;
    if (command.kind === 'water')
      return log?.water_ml == null
        ? ' Todavía no hay agua anotada.'
        : ` Ahora lleva ${(log.water_ml / 1000).toFixed(2)} L.`;
    if (command.kind === 'creatine')
      return log?.creatine_taken == null
        ? ' La creatina no está anotada.'
        : log.creatine_taken === 1
          ? ' La creatina ya está tomada.'
          : ' Ahora dice que no la tomaste.';
    if (log == null) return '';
    if (command.kind === 'steps' && log.steps != null) return ` Ahora dice ${log.steps} pasos.`;
    if (command.kind === 'weight' && log.weight_kg != null)
      return ` Ahora dice ${log.weight_kg} kg.`;
    if (command.kind === 'sleep' && log.sleep_minutes != null)
      return ` Ahora dice ${Math.floor(log.sleep_minutes / 60)} h ${log.sleep_minutes % 60} min.`;
    return '';
  };

  const read = async (request: Request, asked: ReadRequest, text: string, into: string) => {
    let reply: string;
    if (asked.question === 'receta') {
      setActivity('Buscando recetas en internet con Groq y Tavily…');
      const pantry = await loadPantry();
      if (!valid(request)) return;
      const combined =
        previousQuestion.current?.question === 'receta' && recipeRequest.current !== null
          ? `${recipeRequest.current}\nCambio pedido: ${text}`
          : text;
      reply = await suggestRecipe({
        request: text,
        previousRequest:
          previousQuestion.current?.question === 'receta'
            ? (recipeRequest.current ?? undefined)
            : undefined,
        pantry,
        signal: request.controller.signal,
      });
      if (valid(request)) recipeRequest.current = combined;
    } else {
      setActivity('Consultando tus registros…');
      reply = await askLocal(asked);
    }
    if (!valid(request)) return;
    previousQuestion.current = asked;
    await say(request, 'app', reply, into);
  };

  const processCommand = async (
    request: Request,
    command: Command,
    date: IsoDate,
    into: string,
    interpreted?: string,
  ) => {
    const entry: Pending = {
      command,
      date,
      target: command.kind === 'set' ? { ...target.current } : null,
    };
    if (command.kind === 'set' && date !== todayIso()) {
      await say(request, 'app', await run(entry, request), into);
      return;
    }
    // Lo que no se puede escribir se dice antes de preguntar si se escribe.
    if (command.kind === 'pantry') {
      const item = findPantryItem(await loadPantry(), command.item);
      if (!valid(request)) return;
      const change = typeof item === 'string' ? item : changePantryItem(item, command);
      if (typeof change === 'string') {
        await say(request, 'app', change, into);
        return;
      }
    }
    if (command.kind !== 'help' && (interpreted !== undefined || date !== todayIso())) {
      const note = await already(entry);
      if (!valid(request)) return;
      const when = date === todayIso() ? 'hoy' : `al ${shortDate(date)}`;
      const prefix =
        interpreted === undefined ? `Eso va ${when}.` : `Entendí: ${interpreted}. Va ${when}.`;
      await say(request, 'app', `${prefix}${note} ¿Lo escribo?`, into);
      if (valid(request)) setPending(entry);
      return;
    }
    await say(request, 'app', await run(entry, request), into);
  };

  const interpret = async (request: Request, text: string, into: string) => {
    const status = await modelStatus();
    if (!valid(request)) return;
    if (!status.ready) {
      await say(
        request,
        'app',
        `${status.reason ?? 'El modelo no está disponible.'} Puedes consultar tus registros y usar los comandos de ayuda.`,
        into,
      );
      return;
    }
    setActivity(
      status.provider === 'groq'
        ? 'Consultando con Groq en internet…'
        : 'Consultando en el teléfono…',
    );
    const answer = await askModel(
      [{ role: 'user', content: text }],
      INTENT_SCHEMA,
      [
        instructions(todayIso(), target.current.unit),
        previousQuestion.current === null
          ? ''
          : `Última consulta del chat, solo como contexto para referencias: ${JSON.stringify(previousQuestion.current)}.`,
      ].join('\n'),
      { signal: request.controller.signal },
    );
    if (!valid(request)) return;
    const intent = readIntent(answer);
    if (intent.kind === 'ask') {
      await read(
        request,
        { ...intent, date: extractQuestionDate(text, todayIso()) ?? intent.date },
        text,
        into,
      );
    } else if (intent.kind === 'none') {
      await say(request, 'app', intent.reply, into);
    } else {
      const parsed = interpretedCommand(text, intent.line, todayIso(), target.current.unit);
      if (!parsed.ok) {
        await say(request, 'app', `No anoté nada: ${parsed.reason}`, into);
        return;
      }
      await processCommand(
        request,
        parsed.command,
        parsed.date,
        into,
        `${parsed.date} ${commandLine(parsed.command)}`,
      );
    }
  };

  const perform = async (message: string, confirmation?: boolean) => {
    if (active.current !== null || message.trim() === '') return;
    const request: Request = { generation: generation.current, controller: new AbortController() };
    active.current = request;
    setNotice(null);
    setActivity('Un momento…');
    setDraft('');
    const outstanding = pending;
    setPending(null);
    try {
      const into = await say(request, 'me', message);
      if (into === null || !valid(request)) return;
      const accepted =
        confirmation ??
        (YES.includes(plain(message)) ? true : NO.includes(plain(message)) ? false : undefined);
      if (outstanding !== null && accepted !== undefined) {
        const reply = accepted ? await run(outstanding, request) : 'Listo, no escribí nada.';
        await say(request, 'app', reply, into);
        return;
      }
      const social = message
        .toLowerCase()
        .trim()
        .replace(/[¡!¿?.]/g, '');
      if (/^(hola|buenas|buenos días|buenos dias|buenas tardes|buenas noches)$/.test(social)) {
        await say(
          request,
          'app',
          'Hola. Puedes preguntarme por tus registros o tu despensa, pedir una receta nueva o anotar un dato.',
          into,
        );
        return;
      }
      if (/^(gracias|muchas gracias)$/.test(social)) {
        await say(request, 'app', 'De nada.', into);
        return;
      }
      const asked = readQuestion(message, previousQuestion.current, todayIso());
      if (asked !== null) {
        await read(request, asked, message, into);
        return;
      }
      const parsed = parseCommand(message, todayIso());
      if (parsed.ok) await processCommand(request, parsed.command, parsed.date, into);
      else await interpret(request, message, into);
    } catch (error) {
      if (!valid(request)) return;
      setPending(null);
      const detail = error instanceof Error ? error.message : String(error);
      try {
        await say(request, 'app', `No pude completar la solicitud: ${detail}`);
      } catch {
        if (valid(request)) setNotice(`No se pudo guardar el mensaje: ${detail}`);
      }
    } finally {
      if (active.current === request) {
        active.current = null;
        setActivity(null);
      }
    }
  };

  const submit = () => perform(draft.trim());
  const answer = (yes: boolean) =>
    pending === null ? Promise.resolve() : perform(yes ? 'sí' : 'no', yes);
  const resetContext = () => {
    previousQuestion.current = null;
    recipeRequest.current = null;
  };
  const fresh = () => {
    cancel();
    currentChat.current = null;
    setChatId(null);
    setSaid([]);
    setOlder(false);
    setHistory(null);
    resetContext();
  };
  const openHistory = async () => {
    cancel();
    Keyboard.dismiss();
    const version = generation.current;
    try {
      const chats = await loadChats();
      if (version === generation.current) setHistory(chats);
    } catch (error) {
      if (version === generation.current)
        setNotice(
          `No se pudo abrir el historial: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  };
  const resume = async (id: string) => {
    cancel();
    resetContext();
    currentChat.current = id;
    setChatId(id);
    setSaid([]);
    setHistory(null);
    try {
      await showPage(id, CHAT_PAGE);
    } catch (error) {
      setNotice(
        `No se pudo abrir el chat: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const openSource = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      setNotice('No se pudo abrir la fuente. Intenta abrir el enlace en tu navegador.');
    }
  };
  const close = () => {
    cancel();
    onClose();
  };
  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <Text style={styles.title}>{history === null ? 'asistente' : 'chats'}</Text>
        <View style={styles.headActions}>
          <IconButton icon={Plus} accessibilityLabel="Chat nuevo" onPress={fresh} />
          <IconButton
            icon={List}
            selected={history !== null}
            accessibilityLabel="Chats anteriores"
            onPress={history === null ? openHistory : () => setHistory(null)}
          />
          <IconButton icon={X} accessibilityLabel="Cerrar el chat" onPress={close} />
        </View>
      </View>

      {notice !== null && <Text style={styles.empty}>{notice}</Text>}
      {history !== null ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
          {history.length === 0 && <Text style={styles.empty}>Todavía no hay ningún chat.</Text>}
          {history.map((chat) => (
            <Pressable
              key={chat.id}
              accessibilityRole="button"
              accessibilityLabel={`Abrir el chat del ${todayIso(new Date(chat.startedAt))}`}
              onPress={() => resume(chat.id)}
              style={({ pressed }) => [styles.chatRow, pressed && styles.chatRowPressed]}
            >
              <Text style={styles.chatDate}>{shortDate(todayIso(new Date(chat.startedAt)))}</Text>
              <Text style={styles.chatOpener} numberOfLines={1}>
                {chat.opener === '' ? 'sin nada escrito' : chat.opener}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <ScrollView
          ref={scroll}
          style={styles.scroll}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        >
          {said.length === 0 && (
            <Text style={styles.empty}>
              Pregunta por tus registros, tu despensa o una receta nueva. Por ejemplo &quot;proteína
              de ayer&quot; o &quot;mi máximo press inclinado&quot;. También puedes anotar:
              &quot;agua 710&quot;.
            </Text>
          )}
          {older && chatId !== null && (
            <Button
              label="Ver anteriores"
              variant="ghost"
              accessibilityLabel="Ver los mensajes anteriores"
              disabled={activity !== null}
              onPress={() => {
                const version = generation.current;
                void showPage(chatId, shown + CHAT_PAGE, version).catch(() => {
                  if (version === generation.current)
                    setNotice('No se pudieron cargar los mensajes anteriores.');
                });
              }}
            />
          )}
          {said.map((message) => (
            <Bubble
              key={message.id}
              role={message.role}
              body={message.body}
              onSource={openSource}
            />
          ))}
          {activity !== null && (
            <View style={[styles.bubble, styles.theirs]}>
              <Text style={styles.theirsText}>{activity}</Text>
            </View>
          )}
          {pending !== null && (
            <View style={styles.answers}>
              <Button label="Sí, escríbelo" accessibilityLabel="Sí" onPress={() => answer(true)} />
              <Button
                label="No"
                variant="ghost"
                accessibilityLabel="No"
                onPress={() => answer(false)}
              />
            </View>
          )}
        </ScrollView>
      )}

      {history === null && (
        <View style={styles.composer}>
          <TextField
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            autoCapitalize="none"
            accessibilityLabel="Lo que le dices al asistente"
            placeholder="proteína de ayer, receta con pollo…"
            style={styles.input}
          />
          <IconButton
            icon={Send}
            tone="accent"
            accessibilityLabel="Enviar"
            onPress={submit}
            disabled={draft.trim() === '' || activity !== null}
          />
        </View>
      )}
    </View>
  );
}

const styles = sheet((theme) => ({
  panel: {
    flex: 1,
    backgroundColor: theme.bg,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusLarge,
    padding: 12,
    gap: 10,
    ...hardShadow(theme),
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderBottomWidth: shape.border,
    borderBottomColor: theme.line,
    paddingBottom: 10,
  },
  title: {
    fontSize: 20,
    fontFamily: font.display,
    letterSpacing: -0.5,
    color: theme.text,
  },
  headActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scroll: {
    flex: 1,
  },
  list: {
    gap: 8,
    paddingBottom: 4,
  },
  empty: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textDim,
    paddingVertical: 8,
  },
  // Sin sombra y con el borde mas fino que el resto de la app: un globo no se toca. La
  // sombra dura es de lo que se aprieta, y con una por mensaje la conversacion entera
  // parecia una columna de botones.
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1.5,
    borderColor: theme.line,
    borderRadius: shape.radius,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: theme.accent,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: theme.surface,
  },
  mineText: {
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.accentInk,
  },
  theirsText: {
    fontSize: 14,
    fontFamily: font.regular,
    color: theme.text,
  },
  answers: {
    flexDirection: 'row',
    gap: 8,
    alignSelf: 'flex-start',
  },
  chatRow: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  chatRowPressed: {
    backgroundColor: theme.surfaceHigh,
  },
  chatDate: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.textFaint,
  },
  chatOpener: {
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.text,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 10,
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.text,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
  },
}));
