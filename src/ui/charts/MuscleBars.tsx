import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { shortDate } from '../../core/dates.ts';
import type { Band, MuscleBar } from '../../shell/charts.ts';
import { MUSCLE_ES } from '../muscles.ts';
import { mono, theme } from '../theme.ts';

/**
 * Cuantas series directas se llevo cada musculo en los ultimos siete dias, con la
 * banda util marcada. Barras horizontales porque los nombres son largos y en
 * vertical no cabrian.
 */
export function MuscleBars({ bars, band }: { bars: MuscleBar[]; band: Band }) {
  // Que ejercicio y que dia lo entreno: abierto solo el que toca, como el resto.
  const [open, setOpen] = useState<string | null>(null);

  if (bars.length === 0) {
    return <Text style={styles.empty}>No hay series en los últimos siete días.</Text>;
  }

  const top = Math.max(band.to, ...bars.map((bar) => bar.sets));

  return (
    <View style={styles.wrapper}>
      {bars.map((bar) => {
        const state = bar.sets < band.from ? 'below' : bar.sets > band.to ? 'above' : 'within';
        const name = MUSCLE_ES[bar.muscle] ?? bar.muscle;
        return (
          <Pressable
            key={bar.muscle}
            accessibilityLabel={`Ver qué entrenó ${name}`}
            onPress={() => setOpen(open === bar.muscle ? null : bar.muscle)}
            style={styles.row}
          >
            {/* El nombre encima y no a un lado: "deltoide posterior" no cabe en una
                columna estrecha, y meterlo dentro de la barra lo tapa justo cuando la
                barra es corta, que es cuando mas importa leerlo. */}
            <View style={styles.head}>
              <Text style={styles.label}>{name}</Text>
              <Text style={styles.value}>{bar.sets}</Text>
            </View>
            <View style={styles.track}>
              {/* La banda va detras de la barra, asi se ve de un vistazo si cae dentro. */}
              <View
                style={[
                  styles.band,
                  {
                    left: `${(band.from / top) * 100}%`,
                    width: `${((band.to - band.from) / top) * 100}%`,
                  },
                ]}
              />
              <View
                style={[
                  styles.bar,
                  { width: `${(bar.sets / top) * 100}%` },
                  state === 'below' && styles.barBelow,
                  state === 'above' && styles.barAbove,
                ]}
              />
            </View>

            {open === bar.muscle &&
              bar.sources.map((source) => (
                <View key={source.exercise} style={styles.source}>
                  <Text style={styles.sourceName} numberOfLines={1}>
                    {source.exercise}
                  </Text>
                  <Text style={styles.sourceMeta}>
                    {source.sets} {source.sets === 1 ? 'serie' : 'series'} ·{' '}
                    {source.days.map((day) => shortDate(day).slice(0, 6)).join(', ')}
                  </Text>
                </View>
              ))}
          </Pressable>
        );
      })}
      <Text style={styles.footer}>
        Banda útil: {band.from} a {band.to} series directas por semana.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 9,
  },
  row: {
    gap: 3,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 11,
    color: theme.textDim,
    fontFamily: mono,
  },
  track: {
    flex: 1,
    height: 14,
    backgroundColor: theme.surface,
    borderRadius: 3,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  band: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: theme.okBg,
  },
  bar: {
    height: 14,
    backgroundColor: theme.ok,
    borderRadius: 3,
  },
  barBelow: {
    backgroundColor: theme.warn,
  },
  barAbove: {
    backgroundColor: theme.info,
  },
  value: {
    fontSize: 11,
    color: theme.text,
    fontFamily: mono,
  },
  source: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 3,
  },
  sourceName: {
    flexShrink: 1,
    fontSize: 10,
    color: theme.textFaint,
    fontFamily: mono,
  },
  sourceMeta: {
    fontSize: 10,
    color: theme.textGhost,
    fontFamily: mono,
  },
  footer: {
    fontSize: 10,
    color: theme.textGhost,
    fontFamily: mono,
    marginTop: 2,
  },
  empty: {
    fontSize: 12,
    color: theme.textGhost,
  },
});
