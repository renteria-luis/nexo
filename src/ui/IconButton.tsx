import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import type { LucideIcon } from './icons.ts';
import { glass, gloss, pressed as pressedInto, sheet, shape, theme } from './theme.ts';

/**
 * Un boton que solo es un icono: un circulo de vidrio.
 *
 * Existe porque la (i) de una porcion, el quitar de una fila y el borrar de una
 * busqueda son todos lo mismo, y con el Button normal salian tres botones de anchos
 * distintos con una letra dentro. Lleva el area de toque por fuera del dibujo, que es
 * lo que lo hace tocable con el telefono en una mano.
 */
export type IconButtonProps = {
  icon: LucideIcon;
  onPress: () => void;
  accessibilityLabel: string;
  /** Prendido se pinta de ambar, que es lo que dice "esto esta abierto". */
  selected?: boolean;
  tone?: 'paper' | 'accent' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

const SIZE = 34;

export function IconButton({
  icon: Icon,
  onPress,
  accessibilityLabel,
  selected = false,
  tone = 'paper',
  disabled = false,
  style,
}: IconButtonProps) {
  // La tinta oscura solo sobre un color lleno; sobre la tarjeta translucida, clara.
  const filled = selected || tone !== 'paper';
  const tint = disabled ? theme.textGhost : filled ? theme.accentInk : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
      style={({ pressed }) => [
        styles.button,
        selected ? styles.on : styles[tone],
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      <Icon size={17} color={tint} strokeWidth={2.5} />
    </Pressable>
  );
}

const styles = sheet((theme) => ({
  button: {
    width: SIZE,
    height: SIZE,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paper: glass.control,
  accent: gloss(theme.accent),
  danger: gloss(theme.danger),
  on: gloss(theme.accent),
  disabled: {
    ...glass.none,
    backgroundColor: 'transparent',
    borderColor: theme.lineSoft,
  },
  pressed: pressedInto(),
}));
