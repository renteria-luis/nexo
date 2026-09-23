import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GridWeek } from '../core/heatmap.ts';
import { mono, theme } from './theme.ts';

const CELL = 22;
const GAP = 3;
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

type CellProps = {
  color: string;
  fill: number;
  size?: number;
};

/**
 * One day. The colour carries the score and so does the height of the fill, which
 * is spec 4.5 refusing to let colour be the only signal.
 */
export function ScoreCell({ color, fill, size = CELL }: CellProps) {
  return (
    <View style={[styles.cell, { width: size, height: size }]}>
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
                <ScoreCell color={cell.color} fill={cell.fill} />
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
    fontSize: 10,
    color: theme.textGhost,
    fontFamily: mono,
  },
  cell: {
    borderRadius: 3,
    backgroundColor: theme.surfaceHigh,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  fill: {
    width: '100%',
  },
});
