import { useEffect, useRef, useState, type RefObject } from 'react';
import { TextInput, View, type StyleProp, type TextStyle } from 'react-native';

import { KEYBOARD_BAR } from './KeyboardBar.tsx';
import { useReveal } from './screens/Screen.tsx';
import { theme } from './theme.ts';

/**
 * Un campo de texto con el teclado de iOS.
 *
 * Con el del sistema vienen el autocorrector, el dictado, las tildes y escribir
 * deslizando, que es todo lo que un teclado propio tendria que imitar a mano y nunca
 * igualaria. Lo nuestro es lo de alrededor: subir el contenido para que no lo tape, y la
 * barra de encima con la tecla de listo.
 */
export type TextFieldProps = {
  /** Lo que manda el padre. Sin esto el campo se lleva su propio texto. */
  value?: string;
  defaultValue?: string;
  onChange?: (next: string) => void;
  accessibilityLabel: string;
  placeholder?: string;
  /** Se llama al soltar el campo, con lo que quedo escrito. */
  onCommit?: (text: string) => void;
  /** La tecla de retorno, para el campo que hace algo con lo escrito. */
  onSubmit?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  style?: StyleProp<TextStyle>;
  focusedStyle?: StyleProp<TextStyle>;
  /** Lo que tiene que quedar encima del teclado al enfocar. */
  reveals?: RefObject<View | null>;
};

export function TextField({
  value,
  defaultValue,
  onChange,
  accessibilityLabel,
  placeholder,
  onCommit,
  onSubmit,
  onFocus,
  onBlur,
  multiline = false,
  autoCapitalize = 'sentences',
  style,
  focusedStyle,
  reveals,
}: TextFieldProps) {
  const reveal = useReveal();
  const input = useRef<TextInput>(null);
  const [draft, setDraft] = useState(value ?? defaultValue ?? '');
  const [writing, setWriting] = useState(false);
  // Lo ultimo escrito, para poder entregarlo al soltar el campo sin depender de que el
  // render ya haya pasado.
  const text = useRef(draft);

  // El padre manda cuando cambia por otro camino.
  const [seen, setSeen] = useState(value);
  if (value !== undefined && value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  useEffect(() => {
    text.current = draft;
  }, [draft]);

  return (
    <TextInput
      ref={input}
      value={draft}
      onChangeText={(next) => {
        text.current = next;
        setDraft(next);
        onChange?.(next);
      }}
      multiline={multiline}
      autoCapitalize={autoCapitalize}
      autoCorrect={false}
      inputAccessoryViewID={KEYBOARD_BAR}
      returnKeyType={onSubmit ? 'send' : 'done'}
      onSubmitEditing={() => {
        if (onSubmit) onSubmit();
        else input.current?.blur();
      }}
      accessibilityLabel={accessibilityLabel}
      placeholder={placeholder}
      placeholderTextColor={theme.textGhost}
      onFocus={() => {
        setWriting(true);
        onFocus?.();
        reveal(reveals?.current ?? input.current);
      }}
      onBlur={() => {
        setWriting(false);
        onBlur?.();
        onCommit?.(text.current);
      }}
      style={[style, writing && focusedStyle]}
    />
  );
}
