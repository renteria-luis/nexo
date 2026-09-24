import { StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { shortDate } from '../../core/dates.ts';
import type { Band, Point } from '../../shell/charts.ts';
import { mono, theme } from '../theme.ts';

const HEIGHT = 110;

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
}: {
  points: Point[];
  width: number;
  band?: Band | null;
  max?: number;
  format: (value: number) => string;
}) {
  if (points.length === 0 || width <= 0) {
    return <Text style={styles.empty}>Todavía no hay datos.</Text>;
  }

  const top = Math.max(max ?? 0, ...points.map((point) => point.value), band?.to ?? 0) || 1;
  const step = width / points.length;
  const barWidth = Math.max(2, step - 2);
  const y = (value: number) => HEIGHT - (value / top) * HEIGHT;

  const inside = (value: number) => !band || (value >= band.from && value <= band.to);

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
            fill={inside(point.value) ? theme.ok : theme.textGhost}
            rx={1}
          />
        ))}
      </Svg>

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
