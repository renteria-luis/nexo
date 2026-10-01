import { Pressable, Text, View } from 'react-native';

import { font, hardShadow, sheet, shape } from '../theme.ts';

/**
 * El globito de una grafica: que dia es, cuanto marco, y la salida a ese dia.
 *
 * Lo comparten las barras y las lineas porque es la misma pregunta en los dos sitios,
 * y porque un globito distinto en cada grafica se lee como si fueran dos apps.
 */
export function Bubble({
  date,
  value,
  note,
  width,
  left,
  onOpenDay,
}: {
  date: string;
  value: string;
  /** Lo que ese dia fue, cuando el numero solo no lo dice: la rutina, las series. */
  note?: string;
  width: number;
  left: number;
  onOpenDay?: () => void;
}) {
  return (
    <View style={[styles.bubble, { left, width }]}>
      <Text style={styles.date}>{date}</Text>
      <Text style={styles.value}>{value}</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {onOpenDay && (
        <Pressable
          accessibilityLabel={`Ver los detalles del ${date}`}
          onPress={onOpenDay}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.link}>Detalles</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Lo que mide, para poder centrarlo sobre la barra sin que se salga por un lado. */
export const BUBBLE_WIDTH = 116;

const styles = sheet((theme) => ({
  bubble: {
    position: 'absolute',
    top: 6,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3,
    alignItems: 'flex-start',
    ...hardShadow(theme, 3),
  },
  date: {
    fontSize: 11,
    color: theme.textFaint,
    fontFamily: font.bold,
  },
  value: {
    fontSize: 18,
    color: theme.text,
    fontFamily: font.black,
    fontVariant: ['tabular-nums'],
  },
  note: {
    fontSize: 11,
    color: theme.textDim,
    fontFamily: font.bold,
  },
  button: {
    marginTop: 2,
    backgroundColor: theme.accent,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  link: {
    fontSize: 11,
    color: theme.accentInk,
    fontFamily: font.black,
  },
}));
