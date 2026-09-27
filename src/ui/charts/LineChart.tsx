import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { shortDate, type IsoDate } from '../../core/dates.ts';
import type { Point } from '../../shell/charts.ts';
import { font, sheet, theme } from '../theme.ts';

import { Bubble, BUBBLE_WIDTH } from './Bubble.tsx';

const HEIGHT = 130;
const PADDING = 6;

export type LineSeries = {
  points: Point[];
  color: string;
  /** Los puntos sueltos se marcan; la media no, que si no parece otra serie de datos. */
  dots?: boolean;
};

/**
 * Una linea en el tiempo, sin ejes ni rejilla.
 *
 * El eje de abajo son dos fechas y el de la izquierda dos numeros, que es lo unico
 * que hace falta para leer una tendencia en un telefono. Todo lo demas es tinta que
 * tapa la linea.
 *
 * Y se toca, igual que las barras: una columna por fecha, el punto de esa fecha se
 * agranda y el globito dice cual fue. Una linea sin eso obliga a adivinar el numero
 * mirando de reojo el borde de la pantalla.
 */
export function LineChart({
  series,
  width,
  format,
  selected = null,
  onSelect,
  onOpenDay,
}: {
  series: LineSeries[];
  width: number;
  format: (value: number) => string;
  /** La fecha abierta en el globito, o null. La lleva la pantalla: solo hay uno. */
  selected?: number | null;
  onSelect?: (index: number | null) => void;
  onOpenDay?: (date: IsoDate) => void;
}) {
  const all = series.flatMap((line) => line.points);
  if (all.length < 2 || width <= 0) {
    return <Text style={styles.empty}>Todavía no hay suficientes datos.</Text>;
  }

  const dates = [...new Set(all.map((point) => point.date))].sort();
  const values = all.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  // Una serie plana dividiria entre cero y ademas no tiene nada que mostrar arriba
  // ni abajo: se le da un margen para que quede centrada.
  const span = high - low || Math.max(1, high * 0.1);

  const x = (date: string) =>
    PADDING + (dates.indexOf(date) / Math.max(1, dates.length - 1)) * (width - PADDING * 2);
  const y = (value: number) => PADDING + (1 - (value - low) / span) * (HEIGHT - PADDING * 2);

  // El globito habla de la serie con puntos, que es la de los datos de verdad; la otra
  // suele ser una media, y de una media no se pregunta "que dia fue".
  const main = series.find((line) => line.dots) ?? series[0];
  const open = selected !== null && selected >= 0 && selected < dates.length ? selected : null;
  const shown =
    open === null
      ? null
      : (main.points.find((point) => point.date === dates[open]) ??
        all.find((point) => point.date === dates[open]) ??
        null);
  const column = width / dates.length;
  const bubbleLeft =
    open === null
      ? 0
      : Math.min(Math.max(0, x(dates[open]) - BUBBLE_WIDTH / 2), width - BUBBLE_WIDTH);

  return (
    <View>
      <Svg width={width} height={HEIGHT}>
        <Line
          x1={0}
          y1={HEIGHT - 1}
          x2={width}
          y2={HEIGHT - 1}
          stroke={theme.line}
          strokeWidth={2}
        />
        {series.map((line, index) => (
          <Path
            key={index}
            d={line.points
              .map((point, i) => `${i === 0 ? 'M' : 'L'} ${x(point.date)} ${y(point.value)}`)
              .join(' ')}
            stroke={line.color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
        {series
          .filter((line) => line.dots)
          .flatMap((line) =>
            line.points.map((point) => (
              <Circle
                key={`${line.color}-${point.date}`}
                cx={x(point.date)}
                cy={y(point.value)}
                r={3.5}
                fill={line.color}
                stroke={theme.line}
                strokeWidth={1.5}
              />
            )),
          )}
        {shown && (
          <Circle
            cx={x(shown.date)}
            cy={y(shown.value)}
            r={6}
            fill={theme.accent}
            stroke={theme.line}
            strokeWidth={2}
          />
        )}
      </Svg>

      {/* Las zonas de toque van encima del dibujo: una columna por fecha, porque un
          punto de tres pixeles y medio no se acierta con el pulgar. */}
      {onSelect && (
        <View style={[styles.touch, { width, height: HEIGHT }]}>
          {dates.map((date, index) => (
            <Pressable
              key={date}
              accessibilityLabel={`Ver el ${date}`}
              onPress={() => onSelect(open === index ? null : index)}
              style={{ width: column, height: HEIGHT }}
            />
          ))}
        </View>
      )}

      {shown && (
        <Bubble
          date={shortDate(shown.date)}
          value={format(shown.value)}
          width={BUBBLE_WIDTH}
          left={bubbleLeft}
          onOpenDay={onOpenDay ? () => onOpenDay(shown.date) : undefined}
        />
      )}

      <View style={styles.axis}>
        <Text style={styles.axisText}>{shortDate(dates[0])}</Text>
        <Text style={styles.axisText}>
          {format(low)} a {format(high)}
        </Text>
        <Text style={styles.axisText}>{shortDate(dates[dates.length - 1])}</Text>
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
