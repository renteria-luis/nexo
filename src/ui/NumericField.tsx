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
  /** Se llama al soltar el campo, para guardar lo escrito de una sola vez. */
  onCommit?: () => void;
  style?: StyleProp<TextStyle>;
  focusedStyle?: StyleProp<TextStyle>;
};

export function NumericField({
  value,
  onChange,
  allowDecimal = false,
  accessibilityLabel,
  placeholder,
  onCommit,
  style,
  focusedStyle,
}: NumericFieldProps) {
  const pad = useNumberPad();
  const input = useRef<TextInput>(null);
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const notify = useRef(onChange);

  useEffect(() => {
    notify.current = onChange;
  }, [onChange]);

  // El padre manda cuando cambia por otro camino: las flechas de mas y menos
  // escriben en el mismo sitio que este campo. Se ajusta durante el render, que es
  // como React pide sincronizar un estado con una prop.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft !== value) notify.current(draft);
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
        onCommit?.();
      }}
      style={[style, focused && focusedStyle]}
    />
  );
}
