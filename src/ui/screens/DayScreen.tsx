import { useNavigation, useRoute } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { addDays, shortDate, todayIso } from '../../core/dates.ts';
import { scoreText } from '../../core/day-report.ts';
import { proteinBand } from '../../core/targets.ts';
import { WEEKLY_SESSION_TARGET } from '../../core/discipline.ts';
import type { DayDetail } from '../../shell/records.ts';
import { useAppData } from '../../shell/AppData.tsx';
import { fromKg } from '../../core/units.ts';
import { Card } from '../Card.tsx';
import { DayTraining } from '../DayTraining.tsx';
import { FoodLog } from '../FoodLog.tsx';
import { ChevronLeft, ChevronRight, Pencil } from '../icons.ts';
import { IconButton } from '../IconButton.tsx';
import { TodayLog } from '../TodayLog.tsx';
import { font, sheet, shape } from '../theme.ts';

import { Screen } from './Screen.tsx';

const MISSING = '—';

/**
 * La fecha del dia abierto, con el dia anterior y el siguiente a los lados.
 *
 * Por fecha y no por el orden de la lista de registros: al mirar un martes, lo que se
 * quiere ver despues es el lunes, no "el siguiente por nota".
 */
function DayHeader({ date, onGo }: { date: string; onGo: (next: string) => void }) {
  const today = todayIso();
  return (
    <View style={styles.dayHead}>
      <IconButton
        icon={ChevronLeft}
        accessibilityLabel="El día anterior"
        onPress={() => onGo(addDays(date, -1))}
      />
      <Text style={styles.dayTitle}>{shortDate(date)}</Text>
      <IconButton
        icon={ChevronRight}
        accessibilityLabel="El día siguiente"
        disabled={date >= today}
        onPress={() => onGo(addDays(date, 1))}
      />
    </View>
  );
}

/** Un decimal solo cuando lo hay: "17.3/20", pero "22/22". */
function points(earned: number): string {
  return Number.isInteger(earned) ? String(earned) : earned.toFixed(1);
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
  const navigation = useNavigation<{
    navigate: (name: string) => void;
    setParams: (params: { date: string }) => void;
  }>();
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);

  const reload = useCallback(() => {
    loadDay(date)
      .then(setDetail)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(error instanceof Error ? error.message : String(error));
      });
  }, [loadDay, date]);

  useEffect(reload, [reload]);

  if (state.phase !== 'ready') return <Screen title={shortDate(date)}>{null}</Screen>;
  const { loaded } = state;

  if (detail === null) {
    return (
      <Screen title={shortDate(date)}>
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
    <Screen
      header={<DayHeader date={date} onGo={(next) => navigation.setParams({ date: next })} />}
    >
      {/* La nota primero y en grande: es la pregunta que trae aqui, por que ese
          cuadrito salio de ese color. */}
      <Card tone="accent">
        <Text style={styles.heroEyebrow}>NOTA DEL DÍA</Text>
        <Text style={styles.heroScore}>
          {report.score === null ? MISSING : scoreText(report.score)}
        </Text>
        <Text style={styles.heroNote}>
          de 100
          {report.pointsWithoutData > 0
            ? ` · ${Math.round(report.pointsWithoutData)} sin anotar`
            : ' · día completo'}
        </Text>
      </Card>

      {report.noScore === 'sin-metas' && (
        <Card tone="warn">
          <Text style={styles.noticeText}>
            Gris porque no hay metas todavía: llena estatura, fecha de nacimiento y tu peso en
            Ajustes y todos los días se vuelven a calcular solos.
          </Text>
        </Card>
      )}
      {report.noScore === 'pocos-datos' && (
        <Card tone="warn">
          <Text style={styles.noticeText}>
            Gris porque ese día no quedó nada anotado. Con un solo criterio ya hay nota.
          </Text>
        </Card>
      )}
      {day.log?.rest_day === 1 && (
        <Card tone="ok">
          <Text style={styles.noticeText}>
            Descanso planeado: no se penaliza no haber entrenado.{' '}
            {day.bestWeekSessions >= WEEKLY_SESSION_TARGET
              ? `La semana que lo rodea tiene ${day.bestWeekSessions} sesiones, así que este descanso vale como entrenar.`
              : `Valdrá como entrenar cuando la semana que lo rodea llegue a ${WEEKLY_SESSION_TARGET} sesiones; va en ${day.bestWeekSessions}, y cuentan las de los días que vengan.`}
          </Text>
        </Card>
      )}

      {/* El desglose: que pedia cada cosa, que hiciste y cuantos puntos salieron. */}
      <Card>
        {report.lines.map((line, index) => (
          <View key={line.id} style={[styles.criterion, index > 0 && styles.ruled]}>
            <View style={styles.criterionText}>
              <Text style={styles.criterionLabel}>{line.label}</Text>
              <Text style={styles.criterionValue}>
                {line.value}
                {line.target === null ? null : (
                  <Text style={styles.criterionTarget}> de {line.target}</Text>
                )}
              </Text>
            </View>
            <Text
              style={[
                styles.points,
                line.earned === null
                  ? styles.pointsMissing
                  : line.earned >= line.weight
                    ? styles.pointsFull
                    : line.earned === 0
                      ? styles.pointsZero
                      : styles.pointsPartial,
              ]}
            >
              {line.earned === null ? MISSING : points(line.earned)}/{line.weight}
            </Text>
          </View>
        ))}

        {report.penalty < 0 && (
          <Text style={styles.penalty}>
            Penalización {Math.round(report.penalty)} por no entrenar un día que tocaba.
          </Text>
        )}
      </Card>

      <Card title="Entreno">
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
      </Card>

      {/* La comida trae sus propias cartillas, asi que no va dentro de otra. */}
      <FoodLog
        foods={loaded.foods}
        portions={day.portions}
        totals={day.nutrition}
        proteinBand={band}
        kcalTarget={day.targets?.kcal ?? null}
        onAdd={(entry) => after(addFoodOn(date, entry))}
        onOpenCatalogue={() => navigation.navigate('Alimentos')}
        history={loaded.foodHistory}
        onRemove={(entryId) => after(removeFood(entryId))}
      />

      <Card>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>Registro del día</Text>
          <IconButton
            icon={Pencil}
            selected={writing}
            accessibilityLabel={writing ? 'Dejar de escribir' : 'Escribir el registro del día'}
            onPress={() => setWriting(!writing)}
          />
        </View>
        <TodayLog
          editing={writing}
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
      </Card>

      {problem && <Text style={styles.problem}>{problem}</Text>}
    </Screen>
  );
}

const styles = sheet((theme) => ({
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: font.black,
    letterSpacing: 0.3,
    color: theme.text,
  },
  dayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  dayTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 22,
    fontFamily: font.display,
    letterSpacing: -0.5,
    color: theme.text,
  },
  heroEyebrow: {
    fontSize: 11,
    fontFamily: font.black,
    letterSpacing: 1.2,
    color: theme.accentInkSoft,
  },
  heroScore: {
    fontSize: 52,
    lineHeight: 58,
    fontFamily: font.display,
    color: theme.accentInk,
    fontVariant: ['tabular-nums'],
  },
  heroNote: {
    fontSize: 12,
    fontFamily: font.bold,
    color: theme.accentInkSoft,
  },
  noticeText: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.accentInk,
  },
  loading: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  criterion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  ruled: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
    paddingTop: 8,
  },
  criterionText: {
    flex: 1,
    gap: 1,
  },
  criterionLabel: {
    fontSize: 12,
    fontFamily: font.black,
    letterSpacing: 0.6,
    color: theme.textFaint,
    textTransform: 'uppercase',
  },
  criterionValue: {
    fontSize: 15,
    fontFamily: font.bold,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  criterionTarget: {
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  // Los puntos en su casilla, del color que dice como salio: la palabra de al lado ya
  // dice que criterio es, asi que aqui el color no es la unica senal.
  points: {
    minWidth: 62,
    textAlign: 'center',
    fontSize: 14,
    fontFamily: font.black,
    color: theme.accentInk,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    paddingHorizontal: 6,
    paddingVertical: 4,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  pointsFull: {
    backgroundColor: theme.ok,
  },
  pointsPartial: {
    backgroundColor: theme.warn,
  },
  pointsZero: {
    backgroundColor: theme.danger,
  },
  pointsMissing: {
    backgroundColor: theme.bg,
    color: theme.textFaint,
  },
  penalty: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.danger,
  },
  volume: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  problem: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.danger,
  },
}));
