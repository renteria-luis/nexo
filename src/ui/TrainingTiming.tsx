import { memo, useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';

import { useAppData } from '../shell/AppData.tsx';
import type { TrainingSessionRow } from '../db/types.ts';
import type { LoggedSet } from '../training/calculations.ts';
import { finishingAt } from '../training/pace.ts';
import type { PlannedSet } from '../training/routines.ts';
import type { CatalogExercise } from '../training/queries.ts';
import {
  exerciseHistory,
  remainingEstimate,
  type IntervalReason,
  type SessionTiming,
  type SetInterval,
  type TimingSample,
} from '../training/timing.ts';
import type { TimingCorrection } from '../training/timing-store.ts';

import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { NumericField } from './NumericField.tsx';
import { font, sheet, shape } from './theme.ts';

const EMPTY_PLAN: PlannedSet[] = [];
const IMPLEMENT_NAMES: Record<string, string> = {
  machine: 'máquina',
  dumbbell: 'mancuernas',
  cable: 'polea',
  barbell: 'barra',
  ez_bar: 'barra Z',
  bodyweight: 'peso corporal',
};
const REASONS: Record<Exclude<IntervalReason, null>, string> = {
  first: 'Primera serie: falta un inicio medido.',
  switch: 'Cambio de ejercicio o calentamiento: no hay un intervalo comparable.',
  gap: 'Falta una serie intermedia o las horas están fuera de orden; corrige el intervalo si lo conoces.',
  unrecorded: 'Anotada fuera del entreno en vivo; no enseña tu ritmo.',
  excluded: 'Registro excluido del promedio.',
  adjacent: 'El registro anterior se excluyó; este intervalo también necesita revisión.',
  short: 'Muy corto: puede ser un tap tardío o repetido.',
  long: 'Muy largo: puede ser una pausa o un tap tardío.',
  unusual: 'Se aleja de tus tiempos habituales: revísalo.',
};

const minutes = (value: number) =>
  (Math.round(value * 10) / 10).toLocaleString('es', { maximumFractionDigits: 1 });
const timeOf = (value: number) => {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
};

function DailyAverage({ samples }: { samples: TimingSample[] }) {
  const days = new Map<string, { minutes: number; sets: number }>();
  for (const sample of samples) {
    if (sample.minutes === null) continue;
    const day = days.get(sample.date) ?? { minutes: 0, sets: 0 };
    day.minutes += sample.minutes;
    day.sets += sample.sets;
    days.set(sample.date, day);
  }
  if (!days.size) return <Text style={styles.hint}>Aún sin días medidos para comparar.</Text>;
  const totals = [...days.values()];
  const averageMinutes = totals.reduce((sum, day) => sum + day.minutes, 0) / totals.length;
  const perSet = totals.reduce((sum, day) => sum + day.minutes / day.sets, 0) / totals.length;
  return (
    <Text style={styles.hint}>
      Promedio de {days.size} días: {minutes(perSet)} min/serie · {minutes(averageMinutes)}{' '}
      min/ejercicio.
    </Text>
  );
}

function IntervalEditor({
  interval,
  onSave,
  disabled,
}: {
  interval: SetInterval;
  onSave: (id: string, correction: TimingCorrection) => Promise<boolean>;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const save = async (correction: TimingCorrection) => {
    if (await onSave(interval.id, correction)) setEditing(false);
  };
  const parsed = Number(value.replace(',', '.'));
  return (
    <View style={styles.interval}>
      <Text style={styles.label}>
        Serie {interval.setIndex} · {timeOf(interval.timestamp)}
      </Text>
      <Text style={styles.hint}>
        {interval.rawSeconds === null
          ? 'Sin intervalo medido'
          : `${minutes(interval.rawSeconds / 60)} min entre taps`}
        {interval.correctedSeconds === null
          ? ''
          : ` · corregido a ${minutes(interval.correctedSeconds / 60)} min`}
        {interval.review === 'keep' && interval.correctedSeconds === null ? ' · confirmado' : ''}
      </Text>
      {interval.reason !== null && <Text style={styles.hint}>{REASONS[interval.reason]}</Text>}
      <View style={styles.row}>
        {interval.rawSeconds !== null &&
          interval.rawSeconds > 0 &&
          interval.reason !== 'adjacent' &&
          interval.reason !== 'gap' && (
            <Button
              label="Fue real"
              variant="ghost"
              disabled={disabled}
              accessibilityLabel={`Confirmar el tiempo de la serie ${interval.setIndex}`}
              onPress={() => {
                void save({ review: 'keep', seconds: null });
              }}
            />
          )}
        <Button
          label="Excluir"
          variant="ghost"
          disabled={disabled}
          accessibilityLabel={`Excluir el tiempo de la serie ${interval.setIndex}`}
          onPress={() => {
            void save({ review: 'exclude', seconds: null });
          }}
        />
        <Button
          label="Corregir"
          variant="ghost"
          disabled={disabled}
          accessibilityLabel={`Corregir el tiempo de la serie ${interval.setIndex}`}
          onPress={() => {
            setValue(
              interval.seconds === null ? '' : String(Math.round(interval.seconds / 6) / 10),
            );
            setEditing(!editing);
          }}
        />
        {(interval.review !== 'auto' || interval.correctedSeconds !== null) && (
          <Button
            label="Automático"
            variant="ghost"
            disabled={disabled}
            onPress={() => {
              void save({ review: 'auto', seconds: null });
            }}
          />
        )}
      </View>
      {editing && (
        <View style={styles.row}>
          <NumericField
            value={value}
            onChange={setValue}
            allowDecimal
            accessibilityLabel={`Minutos del intervalo de la serie ${interval.setIndex}`}
            placeholder="min"
            style={styles.input}
          />
          <Button
            label="Guardar minutos"
            disabled={disabled || !Number.isFinite(parsed) || parsed <= 0 || parsed > 360}
            onPress={() => {
              void save({ review: 'keep', seconds: parsed * 60 });
            }}
          />
        </View>
      )}
    </View>
  );
}

const LiveEstimate = memo(function LiveEstimate({
  data,
  plan,
  catalog,
  activeImplement,
}: {
  data: SessionTiming;
  plan: PlannedSet[];
  catalog: CatalogExercise[];
  activeImplement?: { exerciseId: string; implement: string | null };
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  const estimate = remainingEstimate(data, plan, catalog, now, activeImplement);
  if (!plan.length)
    return <Text style={styles.hint}>Sin plan de series no se puede estimar lo que falta.</Text>;
  if (!estimate.sets)
    return <Text style={styles.value}>Plan completado · puedes terminar el entreno</Text>;
  return (
    <View style={styles.block}>
      <Text style={styles.value}>Sales ~{finishingAt(now, estimate.seconds / 60)}</Text>
      <Text style={styles.label}>
        ~{Math.ceil(estimate.seconds / 60)} min · {estimate.sets} series pendientes
      </Text>
      <Text style={styles.hint}>
        {estimate.learnedSets === 0
          ? 'Estimación inicial según el plan.'
          : estimate.learnedSets < estimate.sets
            ? 'Combina tus tiempos con el plan donde falta historial.'
            : 'Según tus tiempos y las series que faltan.'}
      </Text>
      {estimate.overdue && (
        <Text style={styles.hint}>
          La serie o pausa actual está tardando más; la salida se va ajustando.
        </Text>
      )}
    </View>
  );
});

export const TrainingTiming = memo(function TrainingTiming({
  session,
  revision,
  plan = EMPTY_PLAN,
  catalog,
  activeImplement,
}: {
  session: TrainingSessionRow;
  revision: readonly LoggedSet[];
  plan?: PlannedSet[];
  catalog: CatalogExercise[];
  activeImplement?: { exerciseId: string; implement: string | null };
}) {
  const { loadSessionTiming, reviewTiming } = useAppData();
  const [data, setData] = useState<SessionTiming | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const prepared = useRef<string | null>(null);
  const saving = useRef(false);
  useEffect(() => {
    let alive = true;
    loadSessionTiming(session.id, prepared.current !== session.id || session.end_time !== null)
      .then((next) => {
        if (alive) {
          prepared.current = session.id;
          setData(next);
          setProblem(null);
        }
      })
      .catch((error: unknown) => {
        if (alive) setProblem(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
    };
  }, [session.id, session.end_time, revision, reload, loadSessionTiming]);

  const save = async (id: string, correction: TimingCorrection) => {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    try {
      await reviewTiming(id, correction);
      setReload((value) => value + 1);
      return true;
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const current = data?.session.id === session.id ? data : null;
  const flagged = current?.exercises.reduce((sum, exercise) => sum + exercise.flagged, 0) ?? 0;
  return (
    <Card title="Tiempos por ejercicio">
      {problem !== null && (
        <View style={styles.block}>
          <Text style={styles.hint}>{problem}</Text>
          <Button label="Reintentar tiempos" onPress={() => setReload((value) => value + 1)} />
        </View>
      )}
      {current === null ? (
        <Text style={styles.hint}>Leyendo tiempos…</Text>
      ) : (
        <>
          {session.end_time === null && session.is_retroactive === 0 && (
            <LiveEstimate
              data={current}
              plan={plan}
              catalog={catalog}
              activeImplement={activeImplement}
            />
          )}
          <Button
            label={
              expanded
                ? 'Ocultar análisis'
                : `Ver análisis${flagged ? ` · ${flagged} por revisar` : ''}`
            }
            variant="ghost"
            onPress={() => setExpanded((value) => !value)}
          />
          {expanded && (
            <View style={styles.block}>
              <Text style={styles.hint}>
                Cada intervalo incluye serie y descanso. El total aproxima las series sin inicio
                medido con los intervalos válidos. No mide cada repetición ni separa el descanso
                exacto.
              </Text>
              <Text style={styles.hint}>
                Promedios de los últimos 90 días, hasta 20 sesiones por ejercicio, del mismo
                gimnasio y recorte. Excluir un tap también descarta el intervalo siguiente; los taps
                originales se conservan.
              </Text>
              {!current.exercises.length && (
                <Text style={styles.hint}>
                  Anota al menos dos series del mismo ejercicio para medir un intervalo.
                </Text>
              )}
              {current.exercises.map((exercise) => {
                const samples = exerciseHistory(
                  current.history,
                  exercise.exerciseId,
                  exercise.implement,
                );
                const withToday =
                  session.end_time === null || exercise.minutes === null
                    ? samples
                    : [...samples, { ...exercise, sessionId: session.id, date: session.date }];
                return (
                  <View
                    key={`${exercise.exerciseId}:${exercise.implement}`}
                    style={styles.exercise}
                  >
                    <Text style={styles.name}>
                      {catalog.find((item) => item.id === exercise.exerciseId)?.name_es ??
                        exercise.exerciseId}{' '}
                      · {IMPLEMENT_NAMES[exercise.implement] ?? exercise.implement}
                    </Text>
                    <Text style={styles.label}>
                      {exercise.minutes === null
                        ? 'Aún sin tiempo estimable'
                        : `~${minutes(exercise.minutes)} min · ${minutes(exercise.minutes / exercise.sets)} min/serie`}{' '}
                      · {exercise.sets} series
                    </Text>
                    <Text style={styles.hint}>
                      {exercise.samples} intervalos válidos
                      {exercise.flagged ? ` · ${exercise.flagged} por revisar` : ''}. Primera serie
                      estimada salvo corrección manual.
                    </Text>
                    <DailyAverage samples={withToday} />
                    {samples.length > 0 && (
                      <Text style={styles.hint}>
                        {samples
                          .slice(-5)
                          .map(
                            (sample) =>
                              `${sample.date}: ${minutes(sample.minutes!)} min / ${sample.sets} series`,
                          )
                          .join('\n')}
                      </Text>
                    )}
                    {exercise.intervals.map((interval) => (
                      <IntervalEditor
                        key={interval.id}
                        interval={interval}
                        onSave={save}
                        disabled={busy || session.is_retroactive === 1}
                      />
                    ))}
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
    </Card>
  );
});

const styles = sheet((theme) => ({
  block: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  value: { fontFamily: font.black, fontSize: 21, color: theme.text, fontVariant: ['tabular-nums'] },
  name: { fontFamily: font.black, fontSize: 15, color: theme.text },
  label: { fontFamily: font.bold, fontSize: 13, color: theme.text, fontVariant: ['tabular-nums'] },
  hint: { fontFamily: font.regular, fontSize: 12, color: theme.textDim, lineHeight: 18 },
  exercise: { gap: 8, paddingTop: 12, borderTopWidth: shape.border, borderTopColor: theme.line },
  interval: { gap: 4, paddingTop: 10 },
  input: {
    minWidth: 80,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    padding: 10,
    fontFamily: font.bold,
    fontSize: 15,
    color: theme.text,
  },
}));
