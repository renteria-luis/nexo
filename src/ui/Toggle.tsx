import { Switch, type StyleProp, type ViewStyle } from 'react-native';

import { theme } from './theme.ts';

/**
 * El interruptor: una sola cosa que se prende y se apaga.
 *
 * Es el de iOS (2026-10-18). Compilado con Xcode 26, iOS le pone solo su bolita de
 * vidrio que se agranda y se desliza bajo el dedo; uno dibujado a mano no llega a eso y
 * el nuestro, encima, perdia la forma de pastilla al prenderse. Prendido va en ambar,
 * el acento de la app, con la bolita blanca de siempre.
 *
 * Para elegir entre tres cosas o mas, esto no sirve: eso son chips. Y para un dato que
 * puede estar sin anotar, tampoco, porque apagado y sin anotar se verian igual.
 */
export type ToggleProps = {
  value: boolean;
  onChange: (next: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Toggle({
  value,
  onChange,
  accessibilityLabel,
  disabled = false,
  style,
}: ToggleProps) {
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      trackColor={{ true: theme.accent }}
      style={style}
    />
  );
}
