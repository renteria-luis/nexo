import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { addDays, shortDate, todayIso, weekStart } from '../../core/dates.ts';
import { hoursAndMinutes, litres } from '../../core/day-report.ts';
import { thousands } from '../../core/numbers.ts';
import { kcalBand, proteinBand } from '../../core/targets.ts';
import { fromKg } from '../../core/units.ts';
import { useAppData } from '../../shell/AppData.tsx';
import { SET_BAND, type Comparison, type MuscleWeek, type WeekSummary } from '../../shell/week.ts';

import { Card } from '../Card.tsx';
import { ChevronLeft, ChevronRight } from '../icons.ts';
import { IconButton } from '../IconButton.tsx';
import { InfoDot, InfoText } from '../InfoBubble.tsx';
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

/**
 * Sin dato ni esta semana ni la anterior, la fila no dice nada: el pulso y la VFC no
 * llegan por el Atajo, y "— · antes —" se quedaba ahi todas las semanas.
 */
function known(value: Comparison): boolean {
  return value.thisWeek !== null || value.previousWeek !== null;
}

function compare(value: Comparison, digits: number, suffix: string): string {
  return `${show(value.thisWeek, digits, suffix)} · antes ${show(value.previousWeek, digits, suffix)}`;
}

/** Un dato de la semana: el nombre a la izquierda y el numero a la derecha. */
function Line({
  label,
  value,
  note,
  first = false,
}: {
  label: string;
  value: string;
  /** Under the value, quieter: the goal it is read against. */
  note?: string | null;
  first?: boolean;
}) {
  return (
    <View style={[styles.line, !first && styles.ruled]}>
      <Text style={styles.lineLabel}>{label}</Text>
      <View style={styles.lineRight}>
        <Text style={styles.lineValue}>{value}</Text>
        {note ? <Text style={styles.lineNote}>{note}</Text> : null}
      </View>
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
  // Cada promedio junto a su meta: «6 h 01» solo no decia si la semana fue buena
  // (2026-10-25). Las metas de hoy, que son las que tiene ahora.
  const targets = state.phase === 'ready' ? state.loaded.today.targets : null;
  // Una semana que no ha terminado no esta bajo la banda: le faltan series. Un jueves,
  // todos los musculos salian "bajo la banda" y el aviso no decia nada (2026-10-23).
  const open = summary !== null && summary.range.to >= todayIso();
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
          {/* "de la semana" porque Gráficas cuenta los ultimos 7 dias y los dos numeros
              se leian como el mismo (2026-10-23). */}
          <Card
            title="Series por músculo de la semana"
            action={
              <InfoDot accessibilityLabel="Qué es la banda">
                <InfoText>{`La banda útil va de ${SET_BAND.from} a ${SET_BAND.to} series directas por semana.\nLas ponderadas cuentan también las de músculo secundario, a media serie.`}</InfoText>
              </InfoDot>
            }
          >
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
                    {open && muscle.band === 'below' ? (
                      <Text style={[styles.tag, styles.pending]}>
                        faltan {SET_BAND.from - muscle.directSets}
                      </Text>
                    ) : (
                      <Text style={[styles.tag, styles[muscle.band]]}>{BAND_ES[muscle.band]}</Text>
                    )}
                    <Text style={styles.muscleDetail}>
                      {muscle.weightedSets} {muscle.weightedSets === 1 ? 'ponderada' : 'ponderadas'}{' '}
                      · {thousands(fromKg(muscle.volumeKg, unit))} {unit}
                      {muscle.priorAverageVolumeKg === null
                        ? ''
                        : `, antes ${thousands(fromKg(muscle.priorAverageVolumeKg, unit))}`}
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
                  : hoursAndMinutes(summary.averages.sleepMinutes)
              }
              note={targets && `de ${hoursAndMinutes(targets.sleepMinutes)}`}
            />
            <Line
              label="Proteína"
              value={show(summary.averages.proteinG, 0, ' g')}
              note={[
                targets && `de ${proteinBand(targets).from} g o más`,
                `${summary.averages.foodDays} ${summary.averages.foodDays === 1 ? 'día' : 'días'} con comida`,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
            <Line
              label="Calorías"
              value={
                summary.averages.kcal === null ? '—' : `${thousands(summary.averages.kcal)} kcal`
              }
              note={
                targets &&
                `de ${thousands(kcalBand(targets).from)} a ${thousands(kcalBand(targets).to)}`
              }
            />
            <Line
              label="Pasos"
              value={summary.averages.steps === null ? '—' : thousands(summary.averages.steps)}
              note={targets && `de ${thousands(targets.steps)}`}
            />
            <Line
              label="Agua"
              value={summary.averages.waterMl === null ? '—' : litres(summary.averages.waterMl)}
              note={
                targets &&
                `de ${litres(targets.waterMlRest)}, ${litres(targets.waterMlTraining)} con entreno`
              }
            />
            {known(summary.weightKg) && (
              <Line label="Peso, media de 7 días" value={compare(summary.weightKg, 1, ' kg')} />
            )}
          </Card>

          <Card title="Lo que cuesta">
            <Line
              first
              label="Alcohol"
              value={
                summary.alcohol.drinks === 0
                  ? 'ninguno'
                  : `${summary.alcohol.drinks} ${summary.alcohol.drinks === 1 ? 'trago' : 'tragos'} en ${summary.alcohol.daysWithDrinks} ${summary.alcohol.daysWithDrinks === 1 ? 'día' : 'días'}`
              }
            />
            <Line label="Jr. Bacon Cheeseburgers" value={String(summary.jbcCount)} />
            {/* «19 de 23 anotados» no decia de que: dias tomada, de los anotados. */}
            <Line
              label={`Creatina, últimos ${summary.creatine.windowDays} días`}
              value={`tomada ${summary.creatine.taken} ${summary.creatine.taken === 1 ? 'día' : 'días'}`}
              note={`de ${summary.creatine.logged} ${summary.creatine.logged === 1 ? 'día anotado' : 'días anotados'}`}
            />
          </Card>

          {(known(summary.restingHr) || known(summary.hrvMs)) && (
            <Card title="Recuperación">
              {known(summary.restingHr) && (
                <Line first label="Pulso en reposo" value={compare(summary.restingHr, 0, ' lpm')} />
              )}
              {known(summary.hrvMs) && (
                <Line
                  first={!known(summary.restingHr)}
                  label="VFC"
                  value={compare(summary.hrvMs, 0, ' ms')}
                />
              )}
            </Card>
          )}
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
  pending: {
    color: theme.text,
    backgroundColor: theme.surfaceHigh,
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
    alignItems: 'flex-start',
    gap: 12,
    paddingTop: 2,
  },
  lineRight: {
    flexShrink: 1,
    alignItems: 'flex-end',
  },
  lineNote: {
    textAlign: 'right',
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
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
