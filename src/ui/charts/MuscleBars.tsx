import { StyleSheet, Text, View } from 'react-native';

import type { Band, MuscleBar } from '../../shell/charts.ts';
import { MUSCLE_ES } from '../muscles.ts';
import { mono, theme } from '../theme.ts';

/**
 * Cuantas series directas se llevo cada musculo en los ultimos siete dias, con la
 * banda util marcada. Barras horizontales porque los nombres son largos y en
 * vertical no cabrian.
 */
export function MuscleBars({ bars, band }: { bars: MuscleBar[]; band: Band }) {
  if (bars.length === 0) {
    return <Text style={styles.empty}>No hay series en los últimos siete días.</Text>;
  }

  const top = Math.max(band.to, ...bars.map((bar) => bar.sets));

  return (
    <View style={styles.wrapper}>
      {bars.map((bar) => {
        const state = bar.sets < band.from ? 'below' : bar.sets > band.to ? 'above' : 'within';
        return (
          <View key={bar.muscle} style={styles.row}>
            {/* El nombre encima y no a un lado: "deltoide posterior" no cabe en una
                columna estrecha, y meterlo dentro de la barra lo tapa justo cuando la
                barra es corta, que es cuando mas importa leerlo. */}
            <View style={styles.head}>
              <Text style={styles.label}>{MUSCLE_ES[bar.muscle] ?? bar.muscle}</Text>
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
          </View>
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
