import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { shortDay } from '../../core/dates.ts';
import type { Band, MuscleBar } from '../../shell/charts.ts';
import { MUSCLE_ES } from '../muscles.ts';
import { font, sheet, shape } from '../theme.ts';

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
                    {source.days.map(shortDay).join(' · ')}
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

const styles = sheet((theme) => ({
  wrapper: {
    gap: 12,
  },
  row: {
    gap: 4,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 13,
    color: theme.text,
    fontFamily: font.black,
  },
  track: {
    flex: 1,
    height: 18,
    backgroundColor: theme.surface,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 5,
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
    height: 18,
    backgroundColor: theme.ok,
    // El corte de tinta a la derecha es donde termina la serie: sin el, dos colores
    // claros seguidos no dejan ver donde acaba la barra.
    borderRightWidth: shape.border,
    borderRightColor: theme.line,
  },
  barBelow: {
    backgroundColor: theme.warn,
  },
  barAbove: {
    backgroundColor: theme.info,
  },
  value: {
    fontSize: 13,
    color: theme.text,
    fontFamily: font.black,
    fontVariant: ['tabular-nums'],
  },
  source: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 3,
  },
  sourceName: {
    flexShrink: 1,
    fontSize: 12,
    color: theme.textDim,
    fontFamily: font.bold,
  },
  sourceMeta: {
    fontSize: 12,
    color: theme.textFaint,
    fontFamily: font.regular,
    fontVariant: ['tabular-nums'],
  },
  footer: {
    fontSize: 12,
    color: theme.textFaint,
    fontFamily: font.regular,
    marginTop: 2,
  },
  empty: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.textFaint,
  },
}));
