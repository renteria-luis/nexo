import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { fromKg } from '../../core/units.ts';
import { useAppData } from '../../shell/AppData.tsx';
import type { ChartsData } from '../../shell/charts.ts';
import { DayBars } from '../charts/DayBars.tsx';
import { LineChart } from '../charts/LineChart.tsx';
import { MuscleBars } from '../charts/MuscleBars.tsx';
import { mono, theme } from '../theme.ts';

import { Screen } from './Screen.tsx';

/** Lo que Screen deja a cada lado del contenido. */
const SCREEN_PADDING = 20;

const WINDOWS: { days: number; label: string }[] = [
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
  { days: 365, label: 'un año' },
];

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionNote}>{note}</Text>
      {children}
    </View>
  );
}

/**
 * Las graficas de todo lo que guarda.
 *
 * Cada una responde una pregunta concreta y ninguna repite lo que dice otra: peso,
 * nota, reparto de series, fuerza por ejercicio y comida contra su banda. El ancho
 * se mide una vez y lo usan todas, porque el SVG necesita numeros, no porcentajes.
 */
export function ChartsScreen() {
  const { state, loadCharts } = useAppData();
  const [days, setDays] = useState(90);
  const [data, setData] = useState<ChartsData | null>(null);
  const [exercise, setExercise] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // El SVG necesita un ancho en numeros. Se calcula de la ventana menos el margen de
  // la pantalla en vez de medirlo: medir deja el primer dibujo en cero.
  const width = useWindowDimensions().width - SCREEN_PADDING * 2;

  const reload = useCallback(() => {
    loadCharts(days)
      .then(setData)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(error instanceof Error ? error.message : String(error));
      });
  }, [loadCharts, days]);

  useEffect(reload, [reload]);

  if (state.phase !== 'ready') return <Screen>{null}</Screen>;
  const unit = state.loaded.unit;

  const trend =
    data?.trends.find((item) => item.exerciseId === exercise) ?? data?.trends[0] ?? null;

  return (
    <Screen>
      <View style={styles.chips}>
        {WINDOWS.map((option) => (
          <Pressable
            key={option.days}
            accessibilityLabel={`Ver ${option.label}`}
            onPress={() => setDays(option.days)}
            style={[styles.chip, option.days === days && styles.chipOn]}
          >
            <Text style={[styles.chipText, option.days === days && styles.chipTextOn]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {problem && <Text style={styles.problem}>{problem}</Text>}
      {data === null && <Text style={styles.loading}>Leyendo tus datos…</Text>}

      {data && (
        <>
          <Section
            title="Peso corporal"
            note="El punto es cada pesada y la línea celeste es la media de siete días, que es la que manda."
          >
            <LineChart
              width={width}
              format={(value) => `${Math.round(fromKg(value, 'kg'))} kg`}
              series={[
                { points: data.weight, color: theme.textGhost, dots: true },
                { points: data.weightAverage, color: theme.accent },
              ]}
            />
          </Section>

          <Section
            title="Nota del día"
            note="Cada barra es un día puntuado. Los días sin nota no aparecen."
          >
            <DayBars
              points={data.score}
              width={width}
              band={{ from: 70, to: 100 }}
              max={100}
              format={(value) => String(Math.round(value))}
            />
          </Section>

          <Section
            title="Series por músculo, últimos 7 días"
            note="Directas, sin contar las medias series que caen de otros ejercicios."
          >
            <MuscleBars bars={data.muscles} band={data.setBand} />
          </Section>

          <Section
            title="Fuerza por ejercicio"
            note="El mejor 1RM estimado de cada día que lo entrenaste. Sale de tus series normales, no de una prueba."
          >
            <View style={styles.chips}>
              {data.trends.slice(0, 8).map((item) => (
                <Pressable
                  key={item.exerciseId}
                  accessibilityLabel={`Ver ${item.name}`}
                  onPress={() => setExercise(item.exerciseId)}
                  style={[styles.chip, item.exerciseId === trend?.exerciseId && styles.chipOn]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      item.exerciseId === trend?.exerciseId && styles.chipTextOn,
                    ]}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              ))}
            </View>
            {trend ? (
              <LineChart
                width={width}
                format={(value) => `${Math.round(fromKg(value, unit))} ${unit}`}
                series={[{ points: trend.points, color: theme.accent, dots: true }]}
              />
            ) : (
              <Text style={styles.loading}>Anota dos sesiones de un ejercicio y aparece aquí.</Text>
            )}
          </Section>

          <Section
            title="Proteína por día"
            note="Verde, dentro de tu banda. Gris, fuera. La banda sale de tu peso."
          >
            <DayBars
              points={data.protein}
              width={width}
              band={data.proteinBand}
              format={(value) => `${Math.round(value)} g`}
            />
          </Section>

          <Section
            title="Calorías por día"
            note="La banda es tu objetivo con el margen que la app considera dentro."
          >
            <DayBars
              points={data.kcal}
              width={width}
              band={data.kcalBand}
              format={(value) => String(Math.round(value))}
            />
          </Section>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 38,
    justifyContent: 'center',
  },
  chipOn: {
    borderColor: theme.accent,
    backgroundColor: theme.accent,
  },
  chipText: {
    fontSize: 12,
    color: theme.text,
    fontFamily: mono,
  },
  chipTextOn: {
    color: theme.accentInk,
  },
  section: {
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 12,
    marginTop: 8,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    color: theme.text,
    fontFamily: mono,
  },
  sectionNote: {
    fontSize: 11,
    color: theme.textGhost,
    lineHeight: 16,
  },
  loading: {
    fontSize: 12,
    color: theme.textGhost,
  },
  problem: {
    fontSize: 12,
    color: theme.danger,
  },
});
