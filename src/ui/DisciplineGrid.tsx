import { StyleSheet, Text, View } from 'react-native';

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

/**
 * La cuadricula se queda sobre papel claro dentro de una app oscura, a proposito.
 * La escala de spec 4.5 se eligio para leerse sobre blanco y su extremo bueno es un
 * azul casi negro: sobre fondo negro, el mejor dia del ano seria el menos visible.
 */
export function DisciplineGrid({ weeks }: { weeks: GridWeek[] }) {
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
              <ScoreCell key={cell.date} color={cell.color} fill={cell.fill} />
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
    backgroundColor: theme.paper,
    borderRadius: 6,
    padding: 8,
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
    color: theme.paperInk,
    fontFamily: mono,
  },
  cell: {
    borderRadius: 3,
    backgroundColor: theme.paperCell,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  fill: {
    width: '100%',
  },
});
