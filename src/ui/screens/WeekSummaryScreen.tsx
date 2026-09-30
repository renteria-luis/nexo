import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { addDays, shortDate, todayIso, weekStart } from '../../core/dates.ts';
import { fromKg } from '../../core/units.ts';
import { useAppData } from '../../shell/AppData.tsx';
import { SET_BAND, type Comparison, type MuscleWeek, type WeekSummary } from '../../shell/week.ts';

import { Card } from '../Card.tsx';
import { ChevronLeft, ChevronRight } from '../icons.ts';
import { IconButton } from '../IconButton.tsx';
import { MUSCLE_ES } from '../muscles.ts';
import { font, sheet, shape } from '../theme.ts';

import { Screen } from './Screen.tsx';

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
  return `${show(value.thisWeek, digits, suffix)} · antes ${show(value.previousWeek, digits, suffix)}`;
}

/** Un dato de la semana: el nombre a la izquierda y el numero a la derecha. */
function Line({ label, value, first = false }: { label: string; value: string; first?: boolean }) {
  return (
    <View style={[styles.line, !first && styles.ruled]}>
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
    <Screen title="Resumen semanal">
      <View style={styles.nav}>
        <IconButton
          icon={ChevronLeft}
          accessibilityLabel="Semana anterior"
          onPress={() => setAnchor((date) => addDays(date, -7))}
        />
        <Text style={styles.range}>
          {summary ? `${shortDate(summary.range.from)} a ${shortDate(summary.range.to)}` : '…'}
        </Text>
        <IconButton
          icon={ChevronRight}
          accessibilityLabel="Semana siguiente"
          disabled={!canGoForward}
          onPress={() => setAnchor((date) => addDays(date, 7))}
        />
      </View>

      {problem && <Text style={styles.problem}>{problem}</Text>}

      {summary && (
        <>
          <Card title="Series por músculo">
            <Text style={styles.note}>
              La banda útil va de {SET_BAND.from} a {SET_BAND.to} series directas por semana.
            </Text>
            {summary.muscles.length === 0 ? (
              <Text style={styles.empty}>Sin series registradas esta semana.</Text>
            ) : (
              summary.muscles.map((muscle, index) => (
                <View key={muscle.muscle} style={[styles.muscle, index > 0 && styles.ruled]}>
                  <View style={styles.muscleHead}>
                    <Text style={styles.muscleName}>
                      {MUSCLE_ES[muscle.muscle] ?? muscle.muscle}
                    </Text>
                    <Text style={styles.muscleSets}>{muscle.directSets}</Text>
                  </View>
                  <View style={styles.tags}>
                    <Text style={[styles.tag, styles[muscle.band]]}>{BAND_ES[muscle.band]}</Text>
                    <Text style={styles.muscleDetail}>
                      {muscle.weightedSets} ponderadas · {Math.round(fromKg(muscle.volumeKg, unit))}{' '}
                      {unit}
                      {muscle.priorAverageVolumeKg === null
                        ? ''
                        : `, antes ${Math.round(fromKg(muscle.priorAverageVolumeKg, unit))}`}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </Card>

          <Card title="Promedios de la semana">
            <Line
              first
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
            <Line label="Peso, media de 7 días" value={compare(summary.weightKg, 1, ' kg')} />
          </Card>

          <Card title="Lo que cuesta">
            <Line
              first
              label="Alcohol"
              value={`${summary.alcohol.drinks} tragos en ${summary.alcohol.daysWithDrinks} días`}
            />
            <Line label="Jr. Bacon Cheeseburgers" value={String(summary.jbcCount)} />
            <Line
              label={`Creatina, ${summary.creatine.windowDays} días`}
              value={`${summary.creatine.taken} de ${summary.creatine.logged} anotados`}
            />
          </Card>

          <Card title="Recuperación">
            <Line first label="Pulso en reposo" value={compare(summary.restingHr, 0, ' lpm')} />
            <Line label="VFC" value={compare(summary.hrvMs, 0, ' ms')} />
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = sheet((theme) => ({
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  range: {
    flex: 1,
    textAlign: 'center',
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  note: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  empty: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  problem: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.danger,
  },
  ruled: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 8,
  },
  muscle: {
    gap: 4,
  },
  muscleHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  muscleName: {
    flexShrink: 1,
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  muscleSets: {
    fontSize: 17,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  tags: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  // La palabra dice en que banda esta; el color solo acompana, como en la cuadricula.
  tag: {
    fontSize: 11,
    fontFamily: font.black,
    color: theme.accentInk,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  within: {
    backgroundColor: theme.ok,
  },
  below: {
    backgroundColor: theme.warn,
  },
  above: {
    backgroundColor: theme.info,
  },
  muscleDetail: {
    flexShrink: 1,
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
    paddingTop: 2,
  },
  lineLabel: {
    flexShrink: 1,
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.text,
  },
  lineValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 14,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
}));
