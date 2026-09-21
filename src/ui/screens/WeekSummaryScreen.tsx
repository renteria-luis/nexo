import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { addDays, todayIso, weekStart } from '../../core/dates.ts';
import { fromKg } from '../../core/units.ts';
import { useAppData } from '../../shell/AppData.tsx';
import { SET_BAND, type Comparison, type MuscleWeek, type WeekSummary } from '../../shell/week.ts';

import { Screen } from './Screen.tsx';
import { mono, theme } from '../theme.ts';

const MUSCLE_ES: Record<string, string> = {
  chest: 'Pecho',
  front_delts: 'Deltoide frontal',
  lateral_delts: 'Deltoide lateral',
  rear_delts: 'Deltoide posterior',
  traps: 'Trapecio',
  back: 'Espalda',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  forearms: 'Antebrazo',
  abs: 'Abdomen',
  quads: 'Cuádriceps',
  hamstrings: 'Isquiotibiales',
  glutes: 'Glúteos',
  adductors: 'Aductores',
  calves: 'Pantorrillas',
};

const BAND_ES: Record<MuscleWeek['band'], string> = {
  below: 'bajo la banda',
  within: 'en banda',
  above: 'sobre la banda',
};

function show(value: number | null, digits = 0, suffix = ''): string {
  if (value === null) return '—';
  return `${digits === 0 ? Math.round(value) : value.toFixed(digits)}${suffix}`;
}

function compare(value: Comparison, digits: number, suffix: string): string {
  return `${show(value.thisWeek, digits, suffix)} esta semana · ${show(value.previousWeek, digits, suffix)} la anterior`;
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

/** Spec 6.7. Opens on the current week; the arrows walk back and forward a week at a time. */
export function WeekSummaryScreen() {
  const { state, loadWeek } = useAppData();
  const [anchor, setAnchor] = useState(todayIso);
  const [summary, setSummary] = useState<WeekSummary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadWeek(anchor)
      .then((result) => {
        if (cancelled) return;
        setSummary(result);
        setProblem(null);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setProblem(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [anchor, loadWeek]);

  const unit = state.phase === 'ready' ? state.loaded.unit : 'lb';
  const canGoForward = weekStart(addDays(anchor, 7)) <= todayIso();

  return (
    <Screen>
      <View style={styles.nav}>
        <Pressable
          accessibilityLabel="Semana anterior"
          onPress={() => setAnchor((date) => addDays(date, -7))}
          style={styles.navButton}
        >
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Text style={styles.range}>
          {summary ? `${summary.range.from} a ${summary.range.to}` : 'Cargando'}
        </Text>
        <Pressable
          accessibilityLabel="Semana siguiente"
          disabled={!canGoForward}
          onPress={() => setAnchor((date) => addDays(date, 7))}
          style={[styles.navButton, !canGoForward && styles.navDisabled]}
        >
          <Text style={styles.navText}>›</Text>
        </Pressable>
      </View>

      {problem && <Text style={styles.problem}>{problem}</Text>}

      {summary && (
        <>
          <Text style={styles.section}>
            Series por músculo, banda de {SET_BAND.from} a {SET_BAND.to} directas
          </Text>
          {summary.muscles.length === 0 ? (
            <Text style={styles.empty}>Sin series registradas esta semana.</Text>
          ) : (
            summary.muscles.map((muscle) => (
              <View key={muscle.muscle} style={styles.muscle}>
                <Text style={styles.muscleName}>
                  {MUSCLE_ES[muscle.muscle] ?? muscle.muscle} · {muscle.directSets} directas (
                  {muscle.weightedSets} ponderadas) · {BAND_ES[muscle.band]}
                </Text>
                <Text style={styles.muscleDetail}>
                  Volumen {Math.round(fromKg(muscle.volumeKg, unit))} {unit} · promedio 4 semanas{' '}
                  {muscle.priorAverageVolumeKg === null
                    ? '—'
                    : `${Math.round(fromKg(muscle.priorAverageVolumeKg, unit))} ${unit}`}
                </Text>
              </View>
            ))
          )}

          <Text style={styles.section}>Promedios de la semana</Text>
          <Line
            label="Sueño"
            value={
              summary.averages.sleepMinutes === null
                ? '—'
                : `${Math.floor(summary.averages.sleepMinutes / 60)} h ${Math.round(summary.averages.sleepMinutes % 60)} min`
            }
          />
          <Line
            label="Proteína"
            value={`${show(summary.averages.proteinG, 0, ' g')} · ${summary.averages.foodDays} días con comida`}
          />
          <Line label="Calorías" value={show(summary.averages.kcal, 0, ' kcal')} />
          <Line label="Pasos" value={show(summary.averages.steps)} />
          <Line
            label="Agua"
            value={
              summary.averages.waterMl === null
                ? '—'
                : `${(summary.averages.waterMl / 1000).toFixed(2)} L`
            }
          />

          <Text style={styles.section}>Peso promedio</Text>
          <Line label="Siete días" value={compare(summary.weightKg, 1, ' kg')} />

          <Text style={styles.section}>Lo que cuesta</Text>
          <Line
            label="Alcohol"
            value={`${summary.alcohol.drinks} tragos en ${summary.alcohol.daysWithDrinks} días`}
          />
          <Line label="Jr. Bacon Cheeseburgers" value={String(summary.jbcCount)} />

          <Text style={styles.section}>Creatina, {summary.creatine.windowDays} días</Text>
          <Line
            label="Tomada"
            value={`${summary.creatine.taken} de ${summary.creatine.logged} días registrados`}
          />

          <Text style={styles.section}>Recuperación</Text>
          <Line label="Pulso en reposo" value={compare(summary.restingHr, 0, ' lpm')} />
          <Line label="VFC" value={compare(summary.hrvMs, 0, ' ms')} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navButton: {
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  navDisabled: {
    opacity: 0.3,
  },
  navText: {
    fontSize: 22,
    fontFamily: mono,
    color: theme.text,
  },
  range: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  problem: {
    fontSize: 12,
    color: theme.danger,
  },
  section: {
    fontSize: 14,
    marginTop: 10,
    fontFamily: mono,
    color: theme.text,
  },
  empty: {
    fontSize: 12,
    color: theme.textGhost,
  },
  muscle: {
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 6,
    gap: 2,
  },
  muscleName: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.text,
  },
  muscleDetail: {
    fontSize: 11,
    color: theme.textFaint,
    fontFamily: mono,
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  lineLabel: {
    fontSize: 12,
    color: theme.textDim,
    fontFamily: mono,
  },
  lineValue: {
    fontSize: 12,
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: mono,
    color: theme.text,
  },
});
