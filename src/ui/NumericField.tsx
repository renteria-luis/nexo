import { useEffect, useRef, useState, type RefObject } from 'react';
import { TextInput, View, type StyleProp, type TextStyle } from 'react-native';

import { KEYBOARD_BAR } from './KeyboardBar.tsx';
import { useReveal } from './screens/Screen.tsx';
import { theme } from './theme.ts';

/**
 * Un campo de numeros con el teclado de numeros de iOS.
 *
 * Hubo un teclado propio y se quito el 2026-09-27: se veia mejor y se escribia peor. Lo
 * que queda de aquello es lo que si valia, y esta fuera del campo: el contenido se sube
 * para que el teclado no lo tape, y encima del teclado va nuestra barra con la tecla de
 * listo, que el teclado de numeros de Apple no trae.
 */
export type NumericFieldProps = {
  value: string;
  onChange: (next: string) => void;
  /** El peso lleva decimales; las repeticiones y los pasos no. */
  allowDecimal?: boolean;
  accessibilityLabel: string;
  placeholder?: string;
  /**
   * Se llama al soltar el campo y, mientras escribe, poco despues de la ultima
   * tecla: el numero tiene que estar guardado y la nota al dia sin cerrar nada.
   */
  onCommit?: () => void;
  /** Para que el padre sepa cual se esta escribiendo, y no lo tape mientras tanto. */
  onFocus?: () => void;
  onBlur?: () => void;
  style?: StyleProp<TextStyle>;
  focusedStyle?: StyleProp<TextStyle>;
  /**
   * Lo que tiene que quedar encima del teclado al enfocar. Sin esto se sube el campo
   * solo; con esto se sube el bloque entero, que es lo que hace falta cuando el campo
   * no sirve de nada sin lo que tiene al lado.
   */
  reveals?: RefObject<View | null>;
};

/** Lo que se espera desde la ultima tecla: pasado esto ya no esta escribiendo. */
const SETTLE_MS = 700;

export function NumericField({
  value,
  onChange,
  allowDecimal = false,
  accessibilityLabel,
  placeholder,
  onCommit,
  onFocus,
  onBlur,
  style,
  focusedStyle,
  reveals,
}: NumericFieldProps) {
  const reveal = useReveal();
  const input = useRef<TextInput>(null);
  const [draft, setDraft] = useState(value);
  const [writing, setWriting] = useState(false);
  const notify = useRef(onChange);
  const commit = useRef(onCommit);

  useEffect(() => {
    notify.current = onChange;
  }, [onChange]);

  useEffect(() => {
    commit.current = onCommit;
  }, [onCommit]);

  // El padre manda cuando cambia por otro camino: las flechas de mas y menos
  // escriben en el mismo sitio que este campo. Se ajusta durante el render, que es
  // como React pide sincronizar un estado con una prop.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === value) return;
    notify.current(draft);

    // Y se guarda solo al parar de teclear. Antes solo se guardaba al soltar el
    // campo, asi que escribir 5 h 30 y quedarse mirando la nota no cambiaba nada
    // hasta cerrar el teclado, que es justo cuando ya dejo de mirarla.
    const timer = setTimeout(() => commit.current?.(), SETTLE_MS);
    return () => clearTimeout(timer);
    // El valor del padre no entra en las dependencias: esto solo dispara cuando se
    // teclea, no cuando el padre responde con lo mismo que acaba de recibir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <TextInput
      ref={input}
      value={draft}
      // El teclado de Apple escribe coma o punto segun el idioma del telefono, y las
      // cuentas de la app esperan punto.
      onChangeText={(text) => setDraft(text.replace(',', '.'))}
      keyboardType={allowDecimal ? 'decimal-pad' : 'number-pad'}
      inputAccessoryViewID={KEYBOARD_BAR}
      accessibilityLabel={accessibilityLabel}
      placeholder={placeholder}
      placeholderTextColor={theme.textGhost}
      onFocus={() => {
        setWriting(true);
        onFocus?.();
        // El teclado tapa la mitad de abajo de la pantalla: lo que se escribe se sube.
        reveal(reveals?.current ?? input.current);
      }}
      onBlur={() => {
        setWriting(false);
        onBlur?.();
        onCommit?.();
      }}
      style={[style, writing && focusedStyle]}
    />
  );
}
