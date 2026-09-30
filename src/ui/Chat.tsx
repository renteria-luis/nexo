import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Text, View } from 'react-native';

import type { ChatMessage, ChatSummary } from '../core/assistant.ts';
import { COMMAND_HELP, dateFrom, parseCommand, type Command } from '../core/commands.ts';
import { scoreText } from '../core/day-report.ts';
import { shortDate, todayIso, type IsoDate } from '../core/dates.ts';
import { currentStreak } from '../core/discipline.ts';
import { INTENT_SCHEMA, instructions, readIntent, type Intent } from '../core/intent.ts';
import { toKg, withUnit } from '../core/units.ts';
import { fold } from '../nutrition/picker.ts';
import { useAppData } from '../shell/AppData.tsx';
import { askModel, modelReady } from '../shell/model.ts';

import { Button } from './Button.tsx';
import { List, Plus, Send, X } from './icons.ts';
import { IconButton } from './IconButton.tsx';
import { TextField } from './TextField.tsx';
import { font, hardShadow, sheet, shape } from './theme.ts';

/**
 * El chat con el asistente, que es lo que la bola abre.
 *
 * Lo que escribe pasa primero por el parser de comandos, que es codigo: "25 set pasos
 * 5000" no necesita modelo ninguno y es instantaneo. Solo cuando el parser no lo
 * reconoce entra el modelo del telefono (spec 20.3), y lo unico que se le pide es que
 * traduzca la frase a una linea de esa misma gramatica, que vuelve a pasar por el
 * parser. El modelo nunca escribe: propone una linea y el parser decide.
 *
 * Nada se escribe en otro dia sin preguntar, y nada de lo que interprete el modelo se
 * escribe sin preguntar. Corregir hoy es barato de ver; cambiar un martes de hace tres
 * semanas no se nota hasta que la cuadricula ya cambio de color, y un modelo pequeño que
 * lee "seis y media" como seis minutos lo hace sin avisar.
 *
 * Solo la conversacion: donde se pone la ventana y como se mueve es cosa de
 * `Assistant`, que es quien la lleva pegada a la bola.
 */
type Pending = { command: Command; date: IsoDate };

const YES = ['si', 'sí', 'dale', 'ok', 'hazlo'];
const NO = ['no', 'cancela', 'nada'];

function plain(text: string): string {
  return text.toLowerCase().trim();
}

export function Chat({ onClose }: { onClose: () => void }) {
  const {
    state,
    exerciseId,
    logDay,
    logSet,
    editDay,
    loadDay,
    loadCharts,
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
  const [thinking, setThinking] = useState(false);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    let alive = true;
    lastChatId().then(async (id) => {
      if (!alive) return;
      setChatId(id);
      if (id !== null) setSaid(await loadChat(id));
    });
    return () => {
      alive = false;
    };
  }, [lastChatId, loadChat]);

  const say = useCallback(
    async (role: 'me' | 'app', body: string, into?: string) => {
      const id = into ?? chatId ?? (await openChat());
      if (id !== chatId) setChatId(id);
      const message = await sayInChat(id, role, body);
      setSaid((before) => [...before, message]);
      return id;
    },
    [chatId, openChat, sayInChat],
  );

  if (state.phase !== 'ready') return null;
  const { loaded } = state;

  const dayOf = (date: IsoDate) => (date === todayIso() ? 'hoy' : `el ${shortDate(date)}`);

  /** Escribe el comando y devuelve la frase que dice que quedo guardado. */
  const run = async (command: Command, date: IsoDate): Promise<string> => {
    const today = date === todayIso();
    const when = dayOf(date);

    switch (command.kind) {
      case 'help':
        return ['Esto es lo que entiendo:', ...COMMAND_HELP].join('\n');

      case 'water': {
        const had = today
          ? (loaded.today.log?.water_ml ?? 0)
          : ((await loadDay(date)).day.log?.water_ml ?? 0);
        const total = had + command.ml;
        if (today) logDay({ waterMl: total });
        else await editDay(date, { waterMl: total });
        return `Agua +${command.ml} ml ${when}, van ${(total / 1000).toFixed(2)} L`;
      }

      case 'weight': {
        const kg = toKg(command.value, loaded.unit);
        if (today) logDay({ weightKg: kg });
        else await editDay(date, { weightKg: kg });
        return `Peso de ${when}: ${command.value} ${loaded.unit}`;
      }

      case 'steps':
        if (today) logDay({ steps: command.steps });
        else await editDay(date, { steps: command.steps });
        return `${command.steps} pasos ${when}`;

      case 'sleep': {
        const entry = {
          sleepMinutes: command.minutes,
          sleepSource: loaded.today.log?.sleep_source ?? ('manual' as const),
        };
        if (today) logDay(entry);
        else await editDay(date, { ...entry, sleepSource: 'manual' });
        return `Sueño de ${when}: ${Math.floor(command.minutes / 60)} h ${command.minutes % 60} min`;
      }

      case 'creatine':
        if (today) logDay({ creatineTaken: command.taken });
        else await editDay(date, { creatineTaken: command.taken });
        return command.taken ? `Creatina tomada ${when}` : `Creatina no tomada ${when}`;

      case 'set': {
        if (!today) return 'Las series de otro día se anotan en la pantalla de ese día.';
        if (loaded.today.session === null) return 'No hay entreno abierto, no anoté nada.';
        if (exerciseId === null) return 'Elige el ejercicio en Entreno y repite el comando.';
        logSet(toKg(command.weight, loaded.unit), command.reps, { rpe: command.rpe });
        return `Serie de ${command.weight} ${loaded.unit} por ${command.reps} anotada`;
      }
    }
  };

  /** Lo que ese dia ya tiene escrito, para que la pregunta diga que se va a pisar. */
  const already = async (command: Command, date: IsoDate): Promise<string> => {
    const log = (await loadDay(date)).day.log;
    if (log === null) return '';
    if (command.kind === 'steps' && log.steps !== null) return ` Ahora dice ${log.steps} pasos.`;
    if (command.kind === 'weight' && log.weight_kg !== null) {
      return ` Ahora dice ${log.weight_kg} kg.`;
    }
    if (command.kind === 'sleep' && log.sleep_minutes !== null) {
      return ` Ahora dice ${Math.floor(log.sleep_minutes / 60)} h ${log.sleep_minutes % 60} min.`;
    }
    return '';
  };

  /** Lo que sabe contestar de su propia informacion. Spec 20.2 punto 4. */
  const lookUp = async (asked: Extract<Intent, { kind: 'ask' }>): Promise<string> => {
    switch (asked.question) {
      case 'racha': {
        const streak = currentStreak(loaded.days, todayIso());
        if (streak === 0) return 'Hoy no llevas racha.';
        return `Llevas ${streak} ${streak === 1 ? 'día' : 'días'} de racha.`;
      }

      case 'proteina': {
        const eaten = Math.round(loaded.today.nutrition?.proteinG ?? 0);
        const target = loaded.today.targets?.proteinG ?? null;
        if (target === null) return `Hoy llevas ${eaten} g de proteína.`;
        const left = Math.round(target - eaten);
        if (left > 0) return `Hoy llevas ${eaten} g de proteína, te faltan ${left} para la meta.`;
        return `Hoy llevas ${eaten} g de proteína, ${-left} por encima de la meta.`;
      }

      case 'nota': {
        const date = (asked.date === null ? null : dateFrom(asked.date, todayIso())) ?? todayIso();
        const { report } = await loadDay(date);
        if (report.score === null) return `${dayOf(date)} no tiene nota todavía.`;
        return `La nota de ${dayOf(date)} es ${scoreText(report.score)} de 100.`;
      }

      case 'marca': {
        if (asked.exercise === null) return '¿De qué ejercicio?';
        const { trends } = await loadCharts(90);
        const wanted = fold(asked.exercise);
        const trend = trends.find((one) => {
          const name = fold(one.name);
          return name.includes(wanted) || wanted.includes(name);
        });
        if (trend === undefined || trend.points.length === 0) {
          return `No tengo marcas de "${asked.exercise}" en los últimos 90 días.`;
        }
        const best = trend.points.reduce((top, one) => (one.value > top.value ? one : top));
        return `Tu mejor ${trend.name}: ${withUnit(best.value, loaded.unit)} estimados, el ${shortDate(best.date)}.`;
      }
    }
  };

  /**
   * Lo que no es un comando se lo lleva el modelo del telefono, que solo puede contestar
   * con una linea de la misma gramatica. Esa linea vuelve al parser, y lo que salga de
   * ahi se pregunta antes de escribirlo.
   */
  const interpret = async (text: string, into: string, why: string) => {
    if (!modelReady()) {
      await say('app', `${why}\n\nY el modelo del teléfono no está disponible.`, into);
      return;
    }

    setThinking(true);
    try {
      const recent = said.slice(-4).map((message) => ({
        role: message.role === 'me' ? ('user' as const) : ('assistant' as const),
        content: message.body.slice(0, 200),
      }));
      const answer = await askModel(
        [...recent, { role: 'user', content: text }],
        INTENT_SCHEMA,
        instructions(todayIso(), loaded.unit),
      );
      const intent = readIntent(answer);

      if (intent.kind === 'ask') {
        await say('app', await lookUp(intent), into);
        return;
      }
      if (intent.kind === 'none') {
        await say('app', intent.reply, into);
        return;
      }

      const parsed = parseCommand(intent.line, todayIso());
      if (!parsed.ok) {
        await say('app', `Entendí "${intent.line}", pero no me cuadra: ${parsed.reason}`, into);
        return;
      }
      if (parsed.command.kind === 'help') {
        await say('app', await run(parsed.command, parsed.date), into);
        return;
      }

      setPending({ command: parsed.command, date: parsed.date });
      const note = await already(parsed.command, parsed.date);
      const when = parsed.date === todayIso() ? '' : ` Va al ${shortDate(parsed.date)}.`;
      await say('app', `Entendí: ${intent.line}.${when}${note} ¿Lo escribo?`, into);
    } catch (error) {
      // Una frase suya que no llego a ninguna parte tiene que decirlo, no quedarse en un
      // "no entendí" que parece que la culpa es de como lo escribio.
      await say('app', `El modelo falló: ${(error as Error).message}`, into);
    } finally {
      setThinking(false);
    }
  };

  const submit = async () => {
    const text = draft.trim();
    if (text === '') return;
    setDraft('');
    const into = await say('me', text);

    if (pending !== null) {
      if (YES.includes(plain(text))) {
        const { command, date } = pending;
        setPending(null);
        await say('app', await run(command, date), into);
        return;
      }
      if (NO.includes(plain(text))) {
        setPending(null);
        await say('app', 'Listo, no escribí nada.', into);
        return;
      }
      setPending(null);
    }

    const parsed = parseCommand(text, todayIso());
    if (!parsed.ok) {
      await interpret(text, into, parsed.reason);
      return;
    }

    // Otro dia se pregunta antes. Hoy se ve y se corrige; un dia de hace tres semanas no.
    if (parsed.date !== todayIso() && parsed.command.kind !== 'help') {
      setPending({ command: parsed.command, date: parsed.date });
      const note = await already(parsed.command, parsed.date);
      await say('app', `Eso va al ${shortDate(parsed.date)}.${note} ¿Lo escribo?`, into);
      return;
    }

    await say('app', await run(parsed.command, parsed.date), into);
  };

  const answer = async (yes: boolean) => {
    if (pending === null) return;
    const { command, date } = pending;
    setPending(null);
    const into = await say('me', yes ? 'sí' : 'no');
    await say('app', yes ? await run(command, date) : 'Listo, no escribí nada.', into);
  };

  const fresh = () => {
    setChatId(null);
    setSaid([]);
    setPending(null);
    setHistory(null);
  };

  const openHistory = async () => {
    Keyboard.dismiss();
    setHistory(await loadChats());
  };

  const resume = async (id: string) => {
    setChatId(id);
    setSaid(await loadChat(id));
    setPending(null);
    setHistory(null);
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
          <IconButton icon={X} accessibilityLabel="Cerrar el chat" onPress={onClose} />
        </View>
      </View>

      {history !== null ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
          {history.length === 0 && <Text style={styles.empty}>Todavía no hay ningún chat.</Text>}
          {history.map((chat) => (
            <Pressable
              key={chat.id}
              accessibilityRole="button"
              accessibilityLabel={`Abrir el chat del ${chat.startedAt.slice(0, 10)}`}
              onPress={() => resume(chat.id)}
              style={({ pressed }) => [styles.chatRow, pressed && styles.chatRowPressed]}
            >
              <Text style={styles.chatDate}>{shortDate(chat.startedAt.slice(0, 10))}</Text>
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
              Escribe lo que anotaste. Por ejemplo &quot;agua 710&quot;, &quot;pasos 8200&quot; o
              &quot;25 set pasos 5000&quot;. &quot;ayuda&quot; lista todo.
            </Text>
          )}
          {said.map((message) => (
            <View
              key={message.id}
              style={[styles.bubble, message.role === 'me' ? styles.mine : styles.theirs]}
            >
              <Text style={message.role === 'me' ? styles.mineText : styles.theirsText}>
                {message.body}
              </Text>
            </View>
          ))}
          {thinking && (
            <View style={[styles.bubble, styles.theirs]}>
              <Text style={styles.theirsText}>pensando…</Text>
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
            placeholder="agua 710, 25 set pasos 5000"
            style={styles.input}
          />
          <IconButton
            icon={Send}
            tone="accent"
            accessibilityLabel="Enviar"
            onPress={submit}
            disabled={draft.trim() === '' || thinking}
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
