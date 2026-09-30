import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { todayIso } from '../core/dates.ts';
import type { GridWeek } from '../core/heatmap.ts';
import { font, hardShadow, sheet, shape } from './theme.ts';

const GAP = 2;
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

type CellProps = {
  color: string;
  fill: number;
  /** Con medida propia se dibuja de ese tamano; sin ella llena la columna. */
  size?: number;
  /** Hoy es el unico cuadrito con relieve: se encuentra sin buscarlo. */
  today?: boolean;
};

/**
 * One day. The colour carries the score and so does the height of the fill, which
 * is spec 4.5 refusing to let colour be the only signal.
 *
 * El borde fino de cada cuadrito es lo que hace que la cuadricula se lea como papel
 * cuadriculado en vez de como un monton de manchas de color.
 */
export function ScoreCell({ color, fill, size, today = false }: CellProps) {
  return (
    <View
      style={[
        styles.cell,
        today && styles.cellToday,
        size === undefined ? styles.cellFills : { width: size, height: size },
      ]}
    >
      <View style={[styles.fill, { backgroundColor: color, height: `${fill * 100}%` }]} />
    </View>
  );
}

/**
 * Memoizada porque es lo mas caro que se dibuja en la app: ochenta y cuatro cuadritos
 * tocables, cientos de elementos. Mientras las semanas y el gesto sean los mismos
 * objetos, no se vuelve a armar aunque la pantalla se repinte por otra cosa.
 *
 * Las trece columnas se reparten el ancho que haya (`flex: 1`) y cada cuadrito es
 * cuadrado por `aspectRatio`, asi que la cuadricula llena exactamente la cartilla en
 * cualquier telefono. Con las celdas de medida fija sobraba un hueco a la derecha.
 */
export const DisciplineGrid = memo(function DisciplineGrid({
  weeks,
  onOpenDay,
}: {
  weeks: GridWeek[];
  /** Donde se toco, para colgar el globito del dedo y no de la cartilla. */
  onOpenDay?: (date: string, at: { x: number; y: number; width: number; height: number }) => void;
}) {
  const today = todayIso();

  return (
    <View style={styles.grid}>
      <View style={styles.column}>
        {WEEKDAYS.map((label, index) => (
          <View key={index} style={styles.weekday}>
            <Text style={styles.weekdayText}>{label}</Text>
          </View>
        ))}
      </View>

      {weeks.map((week) => (
        <View key={week.startsOn} style={styles.column}>
          {week.cells.map((cell) => (
            <Pressable
              key={cell.date}
              accessibilityLabel={`Ver el ${cell.date}`}
              onPress={(event) =>
                onOpenDay?.(cell.date, {
                  x: event.nativeEvent.pageX - 6,
                  y: event.nativeEvent.pageY - 6,
                  width: 12,
                  height: 12,
                })
              }
              style={styles.touch}
            >
              <ScoreCell color={cell.color} fill={cell.fill} today={cell.date === today} />
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
});

const styles = sheet((theme) => ({
  grid: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: GAP,
  },
  column: {
    flex: 1,
    gap: GAP,
  },
  touch: {
    width: '100%',
    aspectRatio: 1,
  },
  weekday: {
    width: '100%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayText: {
    fontSize: 11,
    color: theme.text,
    fontFamily: font.black,
  },
  cell: {
    borderRadius: 3,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surfaceHigh,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  cellFills: {
    flex: 1,
    alignSelf: 'stretch',
  },
  cellToday: {
    borderWidth: shape.border,
    ...hardShadow(theme, 2),
  },
  fill: {
    width: '100%',
  },
}));
