import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import type { LucideIcon } from './icons.ts';
import { hardShadow, pressed as pressedInto, sheet, shape, theme } from './theme.ts';

/**
 * Un boton que solo es un icono: el cuadrito con borde de tinta y su sombra dura.
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
  /** Prendido se pinta de amarillo, que es lo que dice "esto esta abierto". */
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
  const tint = disabled ? theme.textGhost : theme.accentInk;

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
    borderRadius: shape.radiusSmall,
    alignItems: 'center',
    justifyContent: 'center',
    ...hardShadow(theme, 3),
  },
  paper: {
    backgroundColor: theme.surface,
  },
  accent: {
    backgroundColor: theme.accent,
  },
  danger: {
    backgroundColor: theme.danger,
  },
  on: {
    backgroundColor: theme.accent,
  },
  disabled: {
    backgroundColor: 'transparent',
    borderColor: theme.lineSoft,
    shadowOpacity: 0,
  },
  pressed: pressedInto(3),
}));
