import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { addDays, daysBetween, shortDate, type IsoDate } from '../../core/dates.ts';
import type { Point } from '../../shell/charts.ts';
import { font, sheet, theme } from '../theme.ts';

import { Bubble, BUBBLE_WIDTH } from './Bubble.tsx';
import { DayScroll } from './DayScroll.tsx';

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
 * Y se toca, igual que las barras: una columna por dia, el punto de ese dia se agranda
 * y el globito dice cual fue. Una linea sin eso obliga a adivinar el numero mirando de
 * reojo el borde de la pantalla. Cada dia ocupa su sitio aunque no se pesara, asi que
 * la linea se desliza igual que las barras (2026-10-10).
 */
export function LineChart({
  series,
  days,
  to,
  width,
  format,
  selected = null,
  onSelect,
  onOpenDay,
}: {
  series: LineSeries[];
  /** Los dias que caben a la vez: el rango que eligio con los circulitos. */
  days: number;
  /** Hoy. La grafica abre en los dias que terminan aqui. */
  to: IsoDate;
  width: number;
  format: (value: number) => string;
  /** El dia abierto en el globito, o null. La lleva la pantalla: solo hay uno. */
  selected?: number | null;
  onSelect?: (index: number | null) => void;
  onOpenDay?: (date: IsoDate) => void;
}) {
  const chart = useMemo(() => {
    const all = series.flatMap((line) => line.points);
    const from = all.reduce((low, point) => (point.date < low ? point.date : low), to);
    // El globito habla de la serie con puntos, que es la de los datos de verdad; la otra
    // suele ser una media, y de una media no se pregunta "que dia fue".
    const main = series.find((line) => line.dots) ?? series[0];
    const byDay: (Point | undefined)[] = Array.from({ length: daysBetween(from, to) + 1 });
    for (const line of [main, ...series]) {
      for (const point of line?.points ?? []) byDay[daysBetween(from, point.date)] ??= point;
    }
    const values = all.map((point) => point.value);
    return {
      count: all.length,
      from,
      byDay,
      low: Math.min(...values),
      high: Math.max(...values),
      lines: series.map((line) => ({
        ...line,
        marks: line.points.map((point) => ({
          day: daysBetween(from, point.date),
          value: point.value,
        })),
      })),
    };
  }, [series, to]);

  const total = chart.byDay.length;
  const visible = Math.max(1, Math.min(days, total));
  const [first, setFirst] = useState(() => total - visible);
  const step = width / visible;
  const { low, high } = chart;
  // Una serie plana dividiria entre cero y ademas no tiene nada que mostrar arriba
  // ni abajo: se le da un margen para que quede centrada.
  const span = high - low || Math.max(1, high * 0.1);
  const open = selected !== null && chart.byDay[selected] !== undefined ? selected : null;

  const renderPage = useCallback(
    (start: number, count: number) => {
      const x = (day: number) => (day - start + 0.5) * step;
      const y = (value: number) => PADDING + (1 - (value - low) / span) * (HEIGHT - PADDING * 2);
      const picked = open === null ? undefined : chart.byDay[open];
      return (
        <>
          <Svg width={count * step} height={HEIGHT}>
            {chart.lines.map((line, index) => (
              <Path
                key={index}
                d={line.marks
                  .map((mark, i) => `${i === 0 ? 'M' : 'L'} ${x(mark.day)} ${y(mark.value)}`)
                  .join(' ')}
                stroke={line.color}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
            {chart.lines
              .filter((line) => line.dots)
              .flatMap((line) =>
                line.marks.map((mark) => (
                  <Circle
                    key={`${line.color}-${mark.day}`}
                    cx={x(mark.day)}
                    cy={y(mark.value)}
                    r={3.5}
                    fill={line.color}
                    stroke={theme.line}
                    strokeWidth={1.2}
                  />
                )),
              )}
            {open !== null && picked && (
              <Circle
                cx={x(open)}
                cy={y(picked.value)}
                r={6}
                fill={theme.accent}
                stroke={theme.line}
                strokeWidth={2}
              />
            )}
          </Svg>

          {/* Las zonas de toque van encima del dibujo: una columna por dia, porque un
              punto de tres pixeles y medio no se acierta con el pulgar. */}
          {onSelect && (
            <View style={[styles.touch, { width: count * step, height: HEIGHT }]}>
              {chart.byDay
                .slice(start, start + count)
                .map((point, offset) =>
                  point === undefined ? (
                    <View
                      key={start + offset}
                      pointerEvents="none"
                      style={{ width: step, height: HEIGHT }}
                    />
                  ) : (
                    <Pressable
                      key={start + offset}
                      accessibilityLabel={`Ver el ${point.date}`}
                      onPress={() => onSelect(open === start + offset ? null : start + offset)}
                      style={{ width: step, height: HEIGHT }}
                    />
                  ),
                )}
            </View>
          )}
        </>
      );
    },
    [chart, step, low, span, open, onSelect],
  );

  if (chart.count < 2 || width <= 0) {
    return <Text style={styles.empty}>Todavía no hay suficientes datos.</Text>;
  }

  const at = Math.min(first, total - visible);
  const picked = open === null ? null : (chart.byDay[open] as Point);
  const bubbleLeft =
    open === null
      ? 0
      : Math.min(
          Math.max(0, (open - at) * step + step / 2 - BUBBLE_WIDTH / 2),
          width - BUBBLE_WIDTH,
        );

  return (
    <View>
      <View style={{ width, height: HEIGHT }}>
        <View style={styles.floor} />
        <DayScroll
          total={total}
          visible={visible}
          first={at}
          width={width}
          height={HEIGHT}
          renderPage={renderPage}
          onMove={setFirst}
          onDragStart={onSelect && (() => onSelect(null))}
        />
      </View>

      <View style={styles.axis}>
        <Text style={styles.axisText}>{shortDate(addDays(chart.from, at))}</Text>
        <Text style={styles.axisText}>
          {format(low)} a {format(high)}
        </Text>
        <Text style={styles.axisText}>{shortDate(addDays(chart.from, at + visible - 1))}</Text>
      </View>

      {/* Despues del eje: lo que va despues se pinta encima, y la fecha tapaba su boton. */}
      {picked && (
        <Bubble
          date={shortDate(picked.date)}
          value={format(picked.value)}
          width={BUBBLE_WIDTH}
          left={bubbleLeft}
          onOpenDay={onOpenDay ? () => onOpenDay(picked.date) : undefined}
        />
      )}
    </View>
  );
}

const styles = sheet((theme) => ({
  floor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0.4,
    height: 1.2,
    backgroundColor: theme.line,
  },
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
