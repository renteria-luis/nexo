import { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Delete, X } from 'lucide-react-native';

import { mono, theme } from './theme.ts';

/**
 * El teclado de la app: las teclas y el gesto para esconderlo.
 *
 * Las teclas escriben con onTouchStart, que es el evento crudo de "un dedo toco
 * aqui". No pasa por el sistema de responder, y esa es toda la diferencia: el
 * responder es uno solo para toda la pantalla, asi que mientras un dedo sujetaba el
 * 6, el 4 no existia. Escribiendo rapido el segundo dedo llega antes de que el
 * primero se levante, y asi los dos cuentan.
 *
 * Arrastrando hacia abajo se esconde siguiendo al dedo. Pasada la mitad de su alto,
 * o con un tiron rapido, se va; si no, vuelve a su sitio. Si el arrastre empezo
 * encima de una tecla, ese digito se deshace: querias cerrar, no escribir.
 */
export type PadKey = string;

export type NumberPadProps = {
  onKey: (key: PadKey) => void;
  onClose: () => void;
  /** Las repeticiones son enteras; el peso no. */
  allowDecimal: boolean;
  /** Lo que mide el area del gesto del telefono, para no quedar debajo. */
  bottomInset: number;
};

const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

/** Hasta aqui el dedo solo se apoyo; pasado esto, esta arrastrando. */
const DRAG_SLOP = 6;

export function NumberPad({ onKey, onClose, allowDecimal, bottomInset }: NumberPadProps) {
  const [held, setHeld] = useState<string | null>(null);
  const [slide] = useState(() => new Animated.Value(0));
  const [padHeight, setPadHeight] = useState(220);
  // Si el gesto empezo escribiendo, hay un digito que deshacer cuando resulta ser
  // un arrastre y no un toque.
  const typedInGesture = useRef(false);

  const drag = useMemo(() => {
    // Los manejadores corren al tocar, nunca durante el render, que es lo unico que
    // la regla de las referencias quiere evitar.
    // eslint-disable-next-line react-hooks/refs
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) => {
        const dragging = gesture.dy > DRAG_SLOP && Math.abs(gesture.dy) > Math.abs(gesture.dx);
        if (dragging && typedInGesture.current) {
          typedInGesture.current = false;
          onKey('del');
        }
        return dragging;
      },
      onPanResponderGrant: () => setHeld(null),
      onPanResponderMove: (_event, gesture) => slide.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > padHeight / 2 || gesture.vy > 1.1) {
          // Cerrar primero y animar despues dejaba ver el teclado de vuelta arriba
          // un cuadro antes de desaparecer.
          Animated.timing(slide, {
            toValue: padHeight,
            duration: 130,
            useNativeDriver: true,
          }).start(onClose);
          return;
        }
        Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    });
  }, [onClose, onKey, padHeight, slide]);

  const key = (id: string, label: string, press: () => void, enabled = true) => ({
    accessibilityLabel: label,
    accessibilityState: { disabled: !enabled },
    onTouchStart: () => {
      if (!enabled) return;
      setHeld(id);
      typedInGesture.current = true;
      press();
    },
    onTouchEnd: () => setHeld(null),
    onTouchCancel: () => setHeld(null),
  });

  return (
    <Animated.View
      onLayout={(event) => setPadHeight(event.nativeEvent.layout.height)}
      style={[styles.pad, { paddingBottom: bottomInset + 8, transform: [{ translateY: slide }] }]}
      {...drag.panHandlers}
    >
      <View style={styles.grip} />

      {ROWS.map((row) => (
        <View key={row.join('')} style={styles.row}>
          {row.map((digit) => (
            <View
              key={digit}
              {...key(digit, `Tecla ${digit}`, () => onKey(digit))}
              style={[styles.key, held === digit && styles.keyPressed]}
            >
              <Text style={[styles.keyText, held === digit && styles.keyTextPressed]}>{digit}</Text>
            </View>
          ))}
        </View>
      ))}

      <View style={styles.row}>
        <View
          {...key('.', 'Tecla punto', () => onKey('.'), allowDecimal)}
          style={[styles.key, !allowDecimal && styles.keyOff, held === '.' && styles.keyPressed]}
        >
          <Text style={[styles.keyText, !allowDecimal && styles.keyTextOff]}>.</Text>
        </View>
        <View
          {...key('0', 'Tecla 0', () => onKey('0'))}
          style={[styles.key, held === '0' && styles.keyPressed]}
        >
          <Text style={[styles.keyText, held === '0' && styles.keyTextPressed]}>0</Text>
        </View>
        <View
          {...key('del', 'Borrar un digito', () => onKey('del'))}
          style={[styles.key, held === 'del' && styles.keyPressed]}
        >
          <Delete
            size={19}
            color={held === 'del' ? theme.accentInk : theme.text}
            strokeWidth={1.75}
          />
        </View>
      </View>

      {/* Debajo del cero, donde el pulgar ya esta. */}
      <View style={styles.row}>
        <View
          {...key('clear', 'Borrar todo', () => onKey('clear'))}
          style={[styles.key, held === 'clear' && styles.keyPressed]}
        >
          <Text style={[styles.clearText, held === 'clear' && styles.keyTextPressed]}>C</Text>
        </View>
        <View
          accessibilityLabel="Cerrar el teclado"
          // Al levantar y no al apoyar: rozarlo de paso no deberia cerrar nada.
          onTouchStart={() => setHeld('close')}
          onTouchEnd={() => {
            setHeld(null);
            onClose();
          }}
          onTouchCancel={() => setHeld(null)}
          style={[styles.key, held === 'close' && styles.keyPressed]}
        >
          <X
            size={19}
            color={held === 'close' ? theme.accentInk : theme.textFaint}
            strokeWidth={2}
          />
        </View>
        <View style={styles.key} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pad: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 6,
    backgroundColor: theme.bg,
    borderTopWidth: 1,
    borderTopColor: theme.line,
  },
  grip: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.line,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  key: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 8,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  keyOff: {
    borderColor: theme.lineSoft,
    backgroundColor: 'transparent',
  },
  keyText: {
    fontSize: 20,
    color: theme.text,
    fontFamily: mono,
  },
  keyTextPressed: {
    color: theme.accentInk,
  },
  keyTextOff: {
    color: theme.textGhost,
  },
  clearText: {
    fontSize: 16,
    color: theme.textFaint,
    fontFamily: mono,
  },
});
