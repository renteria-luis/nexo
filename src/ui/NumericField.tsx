import { useEffect, useRef, useState } from 'react';
import { TextInput, type StyleProp, type TextStyle } from 'react-native';

import { useNumberPad } from './NumberPadHost.tsx';
import { theme } from './theme.ts';

/**
 * Un campo de numeros que no llama al teclado de Apple.
 *
 * El texto que se esta escribiendo vive aqui y no en el teclado: cada tecla se
 * aplica sobre lo que habia un instante antes, asi que tecleando rapido no se pierde
 * ningun digito. Hacia afuera avisa el valor ya armado.
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
}: NumericFieldProps) {
  const pad = useNumberPad();
  const input = useRef<TextInput>(null);
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
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

  const apply = (key: string) => {
    setDraft((prev) => {
      if (key === 'clear') return '';
      if (key === 'del') return prev.slice(0, -1);
      if (key === '.') return !allowDecimal || prev.includes('.') ? prev : `${prev || '0'}.`;
      // Un cero a la izquierda no significa nada y ensucia el campo.
      if (prev === '0') return key;
      return prev + key;
    });
  };

  return (
    <TextInput
      ref={input}
      value={draft}
      onChangeText={setDraft}
      showSoftInputOnFocus={false}
      keyboardType="numeric"
      accessibilityLabel={accessibilityLabel}
      placeholder={placeholder}
      placeholderTextColor={theme.textGhost}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
        pad.open({
          onKey: apply,
          allowDecimal,
          onClose: () => {
            setFocused(false);
            input.current?.blur();
          },
        });
      }}
      onBlur={() => {
        setFocused(false);
        onBlur?.();
        onCommit?.();
      }}
      style={[style, focused && focusedStyle]}
    />
  );
}
