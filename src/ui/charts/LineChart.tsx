import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { shortDate } from '../../core/dates.ts';
import type { Point } from '../../shell/charts.ts';
import { mono, theme } from '../theme.ts';

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
 */
export function LineChart({
  series,
  width,
  format,
}: {
  series: LineSeries[];
  width: number;
  format: (value: number) => string;
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

  return (
    <View>
      <Svg width={width} height={HEIGHT}>
        <Line
          x1={0}
          y1={HEIGHT - 1}
          x2={width}
          y2={HEIGHT - 1}
          stroke={theme.line}
          strokeWidth={1}
        />
        {series.map((line, index) => (
          <Path
            key={index}
            d={line.points
              .map((point, i) => `${i === 0 ? 'M' : 'L'} ${x(point.date)} ${y(point.value)}`)
              .join(' ')}
            stroke={line.color}
            strokeWidth={1.75}
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
                r={2}
                fill={line.color}
              />
            )),
          )}
      </Svg>

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

const styles = StyleSheet.create({
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
