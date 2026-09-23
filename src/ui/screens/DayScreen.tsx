import { useRoute } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { shortDate, todayIso } from '../../core/dates.ts';
import { proteinBand } from '../../core/targets.ts';
import type { DayDetail } from '../../shell/records.ts';
import { useAppData } from '../../shell/AppData.tsx';
import { fromKg } from '../../core/units.ts';
import { DayTraining } from '../DayTraining.tsx';
import { FoodLog } from '../FoodLog.tsx';
import { TodayLog } from '../TodayLog.tsx';
import { mono, theme } from '../theme.ts';

import { Screen } from './Screen.tsx';

const MISSING = '—';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * Un dia entero, el de hoy o uno de hace tres semanas, con el desglose de su nota
 * arriba y todo lo demas editable debajo. El desglose va primero porque es la
 * pregunta que trae aqui: por que ese cuadrito salio de ese color.
 */
export function DayScreen() {
  const route = useRoute<{ key: string; name: string; params?: { date?: string } }>();
  const date = route.params?.date ?? todayIso();

  const { state, loadDay, editDay, addFoodOn, removeFood, openSessionOn, addSetOn, removeSetOn } =
    useAppData();
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const reload = useCallback(() => {
    loadDay(date)
      .then(setDetail)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(error instanceof Error ? error.message : String(error));
      });
  }, [loadDay, date]);

  useEffect(reload, [reload]);

  if (state.phase !== 'ready') return <Screen>{null}</Screen>;
  const { loaded } = state;

  if (detail === null) {
    return (
      <Screen>
        <Text style={styles.loading}>{problem ?? 'Abriendo el día…'}</Text>
      </Screen>
    );
  }

  const { day, report } = detail;
  const band = day.targets ? proteinBand(day.targets) : null;

  const after = (work: Promise<unknown>) => {
    work.then(reload).catch((error: unknown) => {
      console.error(error);
      setProblem(error instanceof Error ? error.message : String(error));
    });
  };

  return (
    <Screen>
      <View style={styles.head}>
        <Text style={styles.date}>{shortDate(date)}</Text>
        <Text style={styles.score}>
          {report.score === null ? MISSING : Math.round(report.score)}
        </Text>
      </View>

      {report.noScore === 'sin-metas' && (
        <Text style={styles.warn}>
          Gris porque no hay metas todavía: llena estatura, fecha de nacimiento y tu peso en Ajustes
          y todos los días se vuelven a calcular solos.
        </Text>
      )}
      {report.noScore === 'pocos-datos' && (
        <Text style={styles.warn}>
          Gris porque solo {report.criteriaWithData} de los 8 criterios tienen dato. Con tres ya hay
          nota.
        </Text>
      )}
      {day.log?.rest_day === 1 && (
        <Text style={styles.ok}>Descanso planeado: no se penaliza no haber entrenado.</Text>
      )}

      {/* El desglose: que pedia cada cosa, que hiciste y cuantos puntos salieron. */}
      <Section title="Nota">
        {report.lines.map((line) => (
          <View key={line.id} style={styles.criterion}>
            <Text style={styles.criterionLabel}>{line.label}</Text>
            <Text style={styles.criterionValue}>
              {line.value}
              {line.target === null ? null : (
                <Text style={styles.criterionTarget}> de {line.target}</Text>
              )}
            </Text>
            <Text
              style={[
                styles.criterionPoints,
                line.earned === null
                  ? styles.pointsMissing
                  : line.earned >= line.weight
                    ? styles.pointsFull
                    : line.earned === 0
                      ? styles.pointsZero
                      : styles.pointsPartial,
              ]}
            >
              {line.earned === null ? MISSING : Math.round(line.earned)}/{line.weight}
            </Text>
          </View>
        ))}

        {report.penalty < 0 && (
          <Text style={styles.penalty}>
            Penalización {Math.round(report.penalty)} por no entrenar un día que tocaba.
          </Text>
        )}
      </Section>

      <Section title="Entreno">
        <DayTraining
          sessionId={day.session?.id ?? null}
          retroactive={day.session?.is_retroactive === 1}
          routineName={detail.routineName}
          gymName={detail.gymName}
          minutes={detail.sessionMinutes}
          exercises={detail.exercises}
          catalog={loaded.exercise.exercises}
          routines={loaded.routines}
          unit={loaded.unit}
          onCreateSession={(routineId) => after(openSessionOn(date, routineId))}
          onAddSet={(exerciseId, weightKg, reps) => {
            const sessionId = day.session?.id;
            if (!sessionId) return;
            // Una serie escrita despues no tiene descanso que medir: el reloj de hoy
            // no dice nada de un entreno de la semana pasada.
            after(
              addSetOn(sessionId, exerciseId, weightKg, reps, {
                restBeforeSeconds: day.session?.is_retroactive === 1 ? null : undefined,
              }),
            );
          }}
          onRemoveSet={(exerciseId, setIndex) => {
            const sessionId = day.session?.id;
            if (!sessionId) return;
            after(removeSetOn(sessionId, exerciseId, setIndex));
          }}
        />
        {detail.exercises.length > 0 && (
          <Text style={styles.volume}>
            {Math.round(fromKg(day.sessionVolume, loaded.unit))} {loaded.unit} de volumen, con las
            mancuernas contadas por las dos
          </Text>
        )}
      </Section>

      <Section title="Comida">
        <FoodLog
          foods={loaded.foods}
          portions={day.portions}
          totals={day.nutrition}
          proteinBand={band}
          kcalTarget={day.targets?.kcal ?? null}
          heading={`Lo que comió el ${shortDate(date)}`}
          onAdd={(entry) => after(addFoodOn(date, entry))}
          onRemove={(entryId) => {
            removeFood(entryId);
            setTimeout(reload, 300);
          }}
        />
      </Section>

      <Section title="Registro del día">
        <TodayLog
          key={date}
          log={day.log}
          lastWeight={loaded.lastWeight}
          containers={loaded.containers}
          waterTargetMl={
            day.targets
              ? day.trained
                ? day.targets.waterMlTraining
                : day.targets.waterMlRest
              : null
          }
          onLog={(entry) => after(editDay(date, entry))}
        />
      </Section>

      {problem && <Text style={styles.problem}>{problem}</Text>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  date: {
    fontSize: 20,
    color: theme.text,
    fontFamily: mono,
  },
  score: {
    fontSize: 34,
    color: theme.text,
    fontFamily: mono,
  },
  loading: {
    fontSize: 12,
    color: theme.textGhost,
  },
  warn: {
    fontSize: 12,
    color: theme.warn,
    backgroundColor: theme.warnBg,
    borderRadius: 6,
    padding: 10,
    overflow: 'hidden',
    lineHeight: 18,
  },
  ok: {
    fontSize: 12,
    color: theme.ok,
  },
  section: {
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 10,
    marginTop: 6,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
    textTransform: 'lowercase',
  },
  criterion: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  criterionLabel: {
    fontSize: 13,
    color: theme.textDim,
    fontFamily: mono,
    width: 78,
  },
  criterionValue: {
    flex: 1,
    fontSize: 13,
    color: theme.text,
    fontFamily: mono,
  },
  criterionTarget: {
    color: theme.textGhost,
  },
  criterionPoints: {
    fontSize: 13,
    fontFamily: mono,
    textAlign: 'right',
    minWidth: 52,
  },
  pointsFull: {
    color: theme.ok,
  },
  pointsPartial: {
    color: theme.warn,
  },
  pointsZero: {
    color: theme.danger,
  },
  pointsMissing: {
    color: theme.textGhost,
  },
  penalty: {
    fontSize: 12,
    color: theme.danger,
  },
  volume: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  problem: {
    fontSize: 12,
    color: theme.danger,
  },
});
