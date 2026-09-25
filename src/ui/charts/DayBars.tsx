import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { shortDate, type IsoDate } from '../../core/dates.ts';
import type { Band, Point } from '../../shell/charts.ts';
import { mono, theme } from '../theme.ts';

const HEIGHT = 110;
/** Lo que mide el globito, para poder centrarlo sobre la barra sin salirse. */
const BUBBLE_WIDTH = 116;

/**
 * Una barra por dia, con la banda objetivo pintada por detras.
 *
 * Asi la pregunta deja de ser "cuanta proteina comi el martes" y pasa a ser "cuantos
 * dias cai dentro", que es la que de verdad cambia algo.
 */
export function DayBars({
  points,
  width,
  band,
  max,
  format,
  selected = null,
  onSelect,
  onOpenDay,
}: {
  points: Point[];
  width: number;
  band?: Band | null;
  max?: number;
  format: (value: number) => string;
  /** El dia abierto en el globito, o null. Lo lleva la pantalla para que solo haya uno. */
  selected?: number | null;
  onSelect?: (index: number | null) => void;
  onOpenDay?: (date: IsoDate) => void;
}) {
  if (points.length === 0 || width <= 0) {
    return <Text style={styles.empty}>Todavía no hay datos.</Text>;
  }

  const top = Math.max(max ?? 0, ...points.map((point) => point.value), band?.to ?? 0) || 1;
  const step = width / points.length;
  const barWidth = Math.max(2, step - 2);
  const y = (value: number) => HEIGHT - (value / top) * HEIGHT;

  const inside = (value: number) => !band || (value >= band.from && value <= band.to);

  const open = selected !== null && selected >= 0 && selected < points.length ? selected : null;
  const bubbleLeft =
    open === null
      ? 0
      : Math.min(Math.max(0, open * step + step / 2 - BUBBLE_WIDTH / 2), width - BUBBLE_WIDTH);

  return (
    <View>
      <Svg width={width} height={HEIGHT}>
        {band && (
          <Rect
            x={0}
            y={y(band.to)}
            width={width}
            height={Math.max(1, y(band.from) - y(band.to))}
            fill={theme.okBg}
          />
        )}
        {points.map((point, index) => (
          <Rect
            key={point.date}
            x={index * step + 1}
            y={y(point.value)}
            width={barWidth}
            height={Math.max(1, HEIGHT - y(point.value))}
            fill={
              open === index ? theme.accent : inside(point.value) ? theme.ok : theme.textGhost
            }
            rx={1}
          />
        ))}
      </Svg>

      {/* Las zonas de toque van encima del dibujo: una por barra y del ancho del
          hueco, porque una barra de dos pixeles no se acierta con el pulgar. */}
      {onSelect && (
        <View style={[styles.touch, { width, height: HEIGHT }]}>
          {points.map((point, index) => (
            <Pressable
              key={point.date}
              accessibilityLabel={`Ver el ${point.date}`}
              onPress={() => onSelect(open === index ? null : index)}
              style={{ width: step, height: HEIGHT }}
            />
          ))}
        </View>
      )}

      {open !== null && (
        <View style={[styles.bubble, { left: bubbleLeft, width: BUBBLE_WIDTH }]}>
          <Text style={styles.bubbleDate}>{shortDate(points[open].date)}</Text>
          <Text style={styles.bubbleValue}>{format(points[open].value)}</Text>
          {onOpenDay && (
            <Pressable
              accessibilityLabel={`Ver los detalles del ${points[open].date}`}
              onPress={() => onOpenDay(points[open].date)}
            >
              <Text style={styles.bubbleLink}>detalles ›</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.axis}>
        <Text style={styles.axisText}>{shortDate(points[0].date)}</Text>
        <Text style={styles.axisText}>
          {band ? `banda ${format(band.from)} a ${format(band.to)}` : `máx ${format(top)}`}
        </Text>
        <Text style={styles.axisText}>{shortDate(points[points.length - 1].date)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  touch: {
    position: 'absolute',
    top: 0,
    left: 0,
    flexDirection: 'row',
  },
  bubble: {
    position: 'absolute',
    top: 6,
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: 8,
    backgroundColor: theme.bg,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  bubbleDate: {
    fontSize: 10,
    color: theme.textGhost,
    fontFamily: mono,
  },
  bubbleValue: {
    fontSize: 15,
    color: theme.text,
    fontFamily: mono,
  },
  bubbleLink: {
    fontSize: 11,
    color: theme.accent,
    fontFamily: mono,
    paddingTop: 4,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  axisText: {
    fontSize: 10,
    color: theme.textGhost,
    fontFamily: mono,
  },
  empty: {
    fontSize: 12,
    color: theme.textGhost,
    paddingVertical: 12,
  },
});
