import { Pressable, Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { shortDate, type IsoDate } from '../../core/dates.ts';
import type { Band, Point } from '../../shell/charts.ts';
import { font, sheet, theme } from '../theme.ts';

import { Bubble, BUBBLE_WIDTH } from './Bubble.tsx';

const HEIGHT = 110;
/** Sitio arriba para el trazo del contorno: la barra mas alta se cortaba por la mitad. */
const PAD = 2;
/** El contorno de una barra, mas fino que el borde de la app (decision suya, 30-09). */
const STROKE = 1.2;

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
  // El borde se dibuja a caballo del contorno, asi que la barra se estrecha lo que
  // mide ese trazo para que dos barras vecinas no se toquen.
  const barWidth = Math.max(2, step - 3);
  // Con noventa dias la barra mide cuatro puntos y hasta este trazo se la come, asi que
  // ahi adelgaza todavia mas.
  const stroke = barWidth > 10 ? STROKE : 1;
  const y = (value: number) => PAD + (HEIGHT - PAD) - (value / top) * (HEIGHT - PAD);

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
            x={index * step + 1.5}
            y={y(point.value)}
            width={barWidth}
            height={Math.max(2, HEIGHT - y(point.value))}
            rx={1}
            fill={open === index ? theme.accent : inside(point.value) ? theme.ok : theme.lineSoft}
            stroke={theme.line}
            strokeWidth={stroke}
          />
        ))}
        {/* La linea de base va encima de las barras: es el suelo del dibujo. */}
        <Line
          x1={0}
          y1={HEIGHT - 0.6}
          x2={width}
          y2={HEIGHT - 0.6}
          stroke={theme.line}
          strokeWidth={STROKE}
        />
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
        <Bubble
          date={shortDate(points[open].date)}
          value={format(points[open].value)}
          width={BUBBLE_WIDTH}
          left={bubbleLeft}
          onOpenDay={onOpenDay ? () => onOpenDay(points[open].date) : undefined}
        />
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

const styles = sheet((theme) => ({
  touch: {
    position: 'absolute',
    top: 0,
    left: 0,
    flexDirection: 'row',
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  axisText: {
    fontSize: 11,
    color: theme.textFaint,
    fontFamily: font.bold,
    fontVariant: ['tabular-nums'],
  },
  empty: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.textFaint,
    paddingVertical: 12,
  },
}));
