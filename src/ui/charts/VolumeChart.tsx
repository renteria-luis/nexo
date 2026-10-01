import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { shortDate, type IsoDate } from '../../core/dates.ts';
import type { Point } from '../../shell/charts.ts';
import { font, sheet, theme } from '../theme.ts';

import { Bubble, BUBBLE_WIDTH } from './Bubble.tsx';

const HEIGHT = 130;
const PAD = 2;
const STROKE = 1.2;

/**
 * Las dos cosas de un ejercicio en el mismo dibujo: lo que movio cada dia y lo que
 * levanta en una sola repeticion.
 *
 * Las barras son el volumen del dia, que es peso por repeticiones sumando todas las
 * series: sube cuando hace mas series o mas repeticiones, aunque el peso no se mueva. La
 * linea es el 1RM estimado, que solo mira el peso. Separadas contaban media historia
 * cada una: subir el volumen con el mismo peso es trabajo, y subir el peso bajando el
 * volumen es fuerza, y las dos cosas pasan a la vez.
 *
 * Cada una tiene su propia escala, porque un kilo y un kilo por repeticion no son el
 * mismo numero; lo que se compara es la forma, no la altura. El globito dice los dos
 * numeros del dia que se toque, que es donde se leen de verdad.
 */
export function VolumeChart({
  volume,
  strength,
  width,
  formatVolume,
  formatStrength,
  selected = null,
  onSelect,
  onOpenDay,
}: {
  volume: Point[];
  strength: Point[];
  width: number;
  formatVolume: (value: number) => string;
  formatStrength: (value: number) => string;
  selected?: number | null;
  onSelect?: (index: number | null) => void;
  onOpenDay?: (date: IsoDate) => void;
}) {
  if (volume.length === 0 || width <= 0) {
    return <Text style={styles.empty}>Todavía no hay datos de este ejercicio.</Text>;
  }

  const step = width / volume.length;
  const barWidth = Math.max(2, step - 3);
  const stroke = barWidth > 10 ? STROKE : 1;
  const topVolume = Math.max(...volume.map((point) => point.value)) || 1;
  const y = (value: number) => PAD + (HEIGHT - PAD) - (value / topVolume) * (HEIGHT - PAD);

  // La linea vive en su propia escala, con un respiro arriba y abajo para que no toque
  // los bordes del dibujo.
  const byDate = new Map(volume.map((point, index) => [point.date, index]));
  const lifted = strength.filter((point) => byDate.has(point.date));
  const values = lifted.map((point) => point.value);
  const low = values.length > 0 ? Math.min(...values) : 0;
  const high = values.length > 0 ? Math.max(...values) : 1;
  const span = high - low || Math.max(1, high * 0.1);
  const lineY = (value: number) => 14 + (1 - (value - low) / span) * (HEIGHT - 34);
  const lineX = (date: IsoDate) => (byDate.get(date) ?? 0) * step + step / 2;

  const open = selected !== null && selected >= 0 && selected < volume.length ? selected : null;
  const shown = open === null ? null : volume[open];
  const strengthOf = (date: IsoDate) => lifted.find((point) => point.date === date) ?? null;
  const bubbleLeft =
    open === null
      ? 0
      : Math.min(Math.max(0, open * step + step / 2 - BUBBLE_WIDTH / 2), width - BUBBLE_WIDTH);

  return (
    <View>
      <Svg width={width} height={HEIGHT}>
        {volume.map((point, index) => (
          <Rect
            key={point.date}
            x={index * step + 1.5}
            y={y(point.value)}
            width={barWidth}
            height={Math.max(2, HEIGHT - y(point.value))}
            rx={1}
            fill={open === index ? theme.accent : theme.okBg}
            stroke={theme.line}
            strokeWidth={stroke}
          />
        ))}

        <Line
          x1={0}
          y1={HEIGHT - 0.6}
          x2={width}
          y2={HEIGHT - 0.6}
          stroke={theme.line}
          strokeWidth={STROKE}
        />

        {lifted.length >= 2 && (
          <Path
            d={lifted
              .map(
                (point, index) =>
                  `${index === 0 ? 'M' : 'L'} ${lineX(point.date)} ${lineY(point.value)}`,
              )
              .join(' ')}
            stroke={theme.line}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
        {lifted.map((point) => (
          <Circle
            key={point.date}
            cx={lineX(point.date)}
            cy={lineY(point.value)}
            r={point.date === shown?.date ? 5 : 3}
            fill={theme.accent}
            stroke={theme.line}
            strokeWidth={1.2}
          />
        ))}
      </Svg>

      {onSelect && (
        <View style={[styles.touch, { width, height: HEIGHT }]}>
          {volume.map((point, index) => (
            <Pressable
              key={point.date}
              accessibilityLabel={`${shortDate(point.date)}: ${formatVolume(point.value)}`}
              onPress={() => onSelect(open === index ? null : index)}
              style={{ width: step, height: HEIGHT }}
            />
          ))}
        </View>
      )}

      {shown !== null && (
        <Bubble
          date={shortDate(shown.date)}
          value={formatVolume(shown.value)}
          note={[
            shown.note,
            strengthOf(shown.date) === null
              ? null
              : `1RM ${formatStrength(strengthOf(shown.date)!.value)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
          width={BUBBLE_WIDTH}
          left={bubbleLeft}
          onOpenDay={onOpenDay ? () => onOpenDay(shown.date) : undefined}
        />
      )}

      <View style={styles.axis}>
        <Text style={styles.axisText}>{shortDate(volume[0].date)}</Text>
        <Text style={styles.axisText}>{shortDate(volume[volume.length - 1].date)}</Text>
      </View>
    </View>
  );
}

const styles = sheet((theme) => ({
  empty: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  touch: {
    position: 'absolute',
    flexDirection: 'row',
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  axisText: {
    fontSize: 11,
    fontFamily: font.bold,
    color: theme.textFaint,
  },
}));
