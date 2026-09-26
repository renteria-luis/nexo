import { Pressable, Text, View } from 'react-native';

import { todayIso } from '../core/dates.ts';
import type { GridWeek } from '../core/heatmap.ts';
import { font, hardShadow, sheet, shape } from './theme.ts';

const CELL = 22;
const GAP = 3;
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

type CellProps = {
  color: string;
  fill: number;
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
export function ScoreCell({ color, fill, size = CELL, today = false }: CellProps) {
  return (
    <View style={[styles.cell, today && styles.cellToday, { width: size, height: size }]}>
      <View style={[styles.fill, { backgroundColor: color, height: `${fill * 100}%` }]} />
    </View>
  );
}

export function DisciplineGrid({
  weeks,
  onOpenDay,
}: {
  weeks: GridWeek[];
  onOpenDay?: (date: string) => void;
}) {
  const today = todayIso();

  return (
    <View style={styles.panel}>
      <View style={styles.grid}>
        <View style={styles.column}>
          {WEEKDAYS.map((label, index) => (
            <View key={index} style={styles.weekdayLabel}>
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
                onPress={() => onOpenDay?.(cell.date)}
              >
                <ScoreCell color={cell.color} fill={cell.fill} today={cell.date === today} />
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = sheet((theme) => ({
  panel: {
    alignSelf: 'flex-start',
  },
  grid: {
    flexDirection: 'row',
    gap: GAP,
  },
  column: {
    gap: GAP,
  },
  weekdayLabel: {
    width: CELL,
    height: CELL,
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
  cellToday: {
    borderWidth: shape.border,
    ...hardShadow(theme, 2),
  },
  fill: {
    width: '100%',
  },
}));
