import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from './Button.tsx';
import type { LucideIcon } from './icons.ts';
import { IconButton } from './IconButton.tsx';
import { font, hardShadow, sheet, shape } from './theme.ts';

/**
 * La (i) de toda la app, y el globito que abre.
 *
 * Habia dos: un cuadrito con borde en Comida y una letra suelta en Entreno, y las dos
 * abrian su texto *dentro* de la pantalla, empujando hacia abajo todo lo que tenian
 * debajo. Leer dos lineas no deberia mover el resto de la pantalla de sitio.
 *
 * Ahora es una sola: un circulo blanco con la i, y lo que dice sale flotando encima de
 * lo demas, como el globito de las graficas. Se cierra tocando fuera.
 *
 * El globo se dibuja fuera de la pantalla que lo pidio, en la raiz de la app, porque
 * dentro de una lista que se desplaza lo recortaria el borde de la lista. Se coloca con
 * lo que mide la (i) en la ventana: por debajo si hay sitio, y si no por encima. El
 * lado que se fija es el que toca a la (i), asi no hace falta saber cuanto mide el globo
 * antes de dibujarlo, que es lo que obligaria a pintarlo dos veces.
 */
type Spot = { x: number; y: number; width: number; height: number };

const WIDE = 280;
const GAP = 8;

type InfoApi = { show: (content: ReactNode, from: Spot) => void; hide: () => void };

const Context = createContext<InfoApi>({ show: () => undefined, hide: () => undefined });

export function useInfo(): InfoApi {
  return useContext(Context);
}

export function InfoProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ content: ReactNode; from: Spot } | null>(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const api = useMemo<InfoApi>(
    () => ({
      show: (content, from) => setShown({ content, from }),
      hide: () => setShown(null),
    }),
    [],
  );

  const place = (from: Spot) => {
    const wide = Math.min(WIDE, width - 2 * GAP);
    const left = Math.min(Math.max(from.x + from.width / 2 - wide / 2, GAP), width - wide - GAP);
    const under = height - (from.y + from.height) - insets.bottom - GAP;
    const over = from.y - insets.top - GAP;

    if (under >= over) {
      return { width: wide, left, top: from.y + from.height + GAP, maxHeight: under };
    }
    return { width: wide, left, bottom: height - from.y + GAP, maxHeight: over };
  };

  return (
    <Context.Provider value={api}>
      {children}
      {shown !== null && (
        <View style={StyleSheet.absoluteFill}>
          <Pressable
            accessibilityLabel="Cerrar"
            onPress={api.hide}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.bubble, place(shown.from)]}>
            <ScrollView>{shown.content}</ScrollView>
          </View>
        </View>
      )}
    </Context.Provider>
  );
}

export function InfoDot({
  accessibilityLabel,
  children,
  style,
}: {
  accessibilityLabel: string;
  /** Lo que dice el globito: texto suelto o una cartilla entera. */
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const spot = useRef<View>(null);
  const { show } = useInfo();

  return (
    <View ref={spot} collapsable={false} style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={8}
        onPress={() =>
          spot.current?.measureInWindow((x, y, width, height) =>
            show(children, { x, y, width, height }),
          )
        }
        style={({ pressed }) => [styles.dot, pressed && styles.dotPressed]}
      >
        <Text style={styles.letter}>i</Text>
      </Pressable>
    </View>
  );
}

/**
 * Preguntar antes de borrar, en el mismo globo y pegado al boton que se toco.
 *
 * Sin esto, un toque sin querer en una papelera borraba una serie o una comida sin mas.
 * La pregunta sale donde esta el dedo, es corta, y tocar fuera es que no.
 */
function Ask({ question, yes, onYes }: { question: string; yes: string; onYes: () => void }) {
  const { hide } = useInfo();
  return (
    <View style={styles.ask}>
      <Text style={styles.line}>{question}</Text>
      <View style={styles.askButtons}>
        <Button
          label={yes}
          accessibilityLabel={yes}
          variant="danger"
          onPress={() => {
            hide();
            onYes();
          }}
        />
        <Button label="No" accessibilityLabel="No" variant="ghost" onPress={hide} />
      </View>
    </View>
  );
}

function useAsk() {
  const { show } = useInfo();
  return (spot: View | null, question: string, yes: string, onYes: () => void) =>
    spot?.measureInWindow((x, y, width, height) =>
      show(<Ask question={question} yes={yes} onYes={onYes} />, { x, y, width, height }),
    );
}

/** Una papelera (o lo que sea) que pregunta antes de hacerlo. */
export function ConfirmButton({
  icon,
  question,
  accessibilityLabel,
  onConfirm,
  yes = 'Sí, borra',
  tone = 'danger',
  disabled = false,
}: {
  icon: LucideIcon;
  question: string;
  accessibilityLabel: string;
  onConfirm: () => void;
  yes?: string;
  tone?: 'paper' | 'accent' | 'danger';
  disabled?: boolean;
}) {
  const spot = useRef<View>(null);
  const ask = useAsk();

  return (
    <View ref={spot} collapsable={false}>
      <IconButton
        icon={icon}
        tone={tone}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel}
        onPress={() => ask(spot.current, question, yes, onConfirm)}
      />
    </View>
  );
}

/** Lo mismo para un boton con palabras, como "Hoy descanso". */
export function ConfirmAction({
  label,
  icon,
  question,
  accessibilityLabel,
  onConfirm,
  yes = 'Sí',
  variant = 'secondary',
  block = false,
}: {
  label: string;
  icon?: LucideIcon;
  question: string;
  accessibilityLabel: string;
  onConfirm: () => void;
  yes?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  block?: boolean;
}) {
  const spot = useRef<View>(null);
  const ask = useAsk();

  return (
    <View ref={spot} collapsable={false} style={block ? styles.block : undefined}>
      <Button
        label={label}
        icon={icon}
        variant={variant}
        block={block}
        accessibilityLabel={accessibilityLabel}
        onPress={() => ask(spot.current, question, yes, onConfirm)}
      />
    </View>
  );
}

/** Una linea de texto dentro del globo, para lo que no trae su propia cartilla. */
export function InfoText({ children }: { children: string }) {
  return (
    <View style={styles.lines}>
      {children.split('\n').map((line) => (
        <Text key={line} style={styles.line}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const SIZE = 26;

const styles = sheet((theme) => ({
  bubble: {
    position: 'absolute',
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    ...hardShadow(theme, 3),
  },
  dot: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: shape.border,
    borderColor: theme.line,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotPressed: {
    backgroundColor: theme.surfaceHigh,
  },
  letter: {
    fontSize: 14,
    lineHeight: 17,
    fontFamily: font.black,
    color: theme.text,
  },
  lines: {
    gap: 4,
  },
  ask: {
    gap: 10,
  },
  askButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  block: {
    alignSelf: 'stretch',
  },
  line: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: font.regular,
    color: theme.text,
  },
}));
