import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';

import { FULL_LEVEL, sayLevel } from '../../core/creatine.ts';
import { daysBetween, todayIso } from '../../core/dates.ts';
import { hoursAndMinutes, scoreText, thousands } from '../../core/day-report.ts';
import { GRID_HISTORY_START } from '../../core/grid-history.ts';
import { fromKg } from '../../core/units.ts';
import { useAppData } from '../../shell/AppData.tsx';
import type { ChartsData, Point } from '../../shell/charts.ts';

import { Card } from '../Card.tsx';
import { DayBars } from '../charts/DayBars.tsx';
import { LineChart } from '../charts/LineChart.tsx';
import { MuscleBars } from '../charts/MuscleBars.tsx';
import { GapsEye, RangeDots } from '../charts/RangeDots.tsx';
import { clockFace } from '../../training/pace.ts';
import { Combobox } from '../Combobox.tsx';
import { font, sheet, theme } from '../theme.ts';

import { Screen } from './Screen.tsx';

/** Lo que Screen deja a cada lado del contenido, y lo que mide una cartilla por dentro. */
const SCREEN_PADDING = 20;
const CARD_PADDING = 14;

/** El rango de una grafica que todavia no tiene uno elegido: el trimestre. */
const DEFAULT_RANGE = 90;
/** Lo que el filtro del tiempo en el gym muestra de entrada: todas las rutinas. */
const ALL_ROUTINES = 'Todo';

/**
 * Dos sesiones el mismo dia comparten su hueco: el tiempo se suma y el globito
 * nombra las dos.
 */
function perDay(points: readonly Point[]): Point[] {
  const byDate = new Map<string, Point>();
  for (const point of points) {
    const before = byDate.get(point.date);
    byDate.set(
      point.date,
      before
        ? {
            date: point.date,
            value: before.value + point.value,
            note: [before.note, point.note].filter(Boolean).join(' + '),
          }
        : point,
    );
  }
  return [...byDate.values()];
}

/** Lo que la pantalla guarda de sus graficas. Un ajuste roto vale como ninguno elegido. */
function chartSetting<T extends object>(raw: string | undefined, none: T): T {
  if (!raw) return none;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null ? (value as T) : none;
  } catch {
    return none;
  }
}

/**
 * Las graficas de todo lo que guarda.
 *
 * Cada una responde una pregunta concreta y ninguna repite lo que dice otra: peso,
 * nota, sueno, pasos, reparto de series, fuerza por ejercicio y comida contra su banda.
 * El ancho se mide una vez y lo usan todas, porque el SVG necesita numeros, no
 * porcentajes.
 */
/**
 * Las formas de mirar un ejercicio. Cada una contesta una pregunta distinta, y por eso
 * son un selector y no una grafica con todo encima: una linea sobre las barras no se
 * puede tocar, porque la barra se queda con el dedo.
 */
const MEASURES = [
  {
    id: 'volume',
    label: 'Volumen',
    inKg: true,
  },
  {
    id: 'topWeight',
    label: 'Peso máximo',
    inKg: true,
  },
  {
    id: 'e1rm',
    label: '1RM estimado',
    inKg: true,
  },
  {
    id: 'intensity',
    label: 'Peso medio por repetición',
    inKg: true,
  },
  {
    id: 'reps',
    label: 'Repeticiones',
    inKg: false,
  },
  {
    id: 'sets',
    label: 'Series',
    inKg: false,
  },
] as const;

type MeasureId = (typeof MEASURES)[number]['id'];

export function ChartsScreen() {
  const { state, loadCharts, saveSetting } = useAppData();
  const navigation = useNavigation<{
    navigate: (name: string, params?: { date: string }) => void;
  }>();
  // Un solo globito abierto en toda la pantalla: tocar una barra de otra grafica
  // cierra el anterior, y tocar fuera los cierra todos.
  const [open, setOpen] = useState<{ chart: string; index: number } | null>(null);
  const [data, setData] = useState<ChartsData | null>(null);
  const [exercise, setExercise] = useState<string | null>(null);
  const [measureId, setMeasure] = useState<MeasureId>('volume');
  const [gymRoutine, setGymRoutine] = useState<string>(ALL_ROUTINES);
  const measure = MEASURES.find((one) => one.id === measureId) ?? MEASURES[0];
  const creatine = data?.creatineReading ?? null;
  const [problem, setProblem] = useState<string | null>(null);
  // El SVG necesita un ancho en numeros. Se calcula de la ventana menos los margenes
  // en vez de medirlo: medir deja el primer dibujo en cero.
  const width = useWindowDimensions().width - SCREEN_PADDING * 2 - CARD_PADDING * 2;

  const reload = useCallback(() => {
    // Toda la historia, desde donde empieza la de la cuadricula, de una vez: cada grafica
    // se desliza por ella, y leer mas dias no cuesta mas consultas.
    loadCharts(daysBetween(GRID_HISTORY_START, todayIso()) + 1)
      .then(setData)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(error instanceof Error ? error.message : String(error));
      });
  }, [loadCharts]);

  useEffect(reload, [reload]);

  if (state.phase !== 'ready') return <Screen title="Gráficas">{null}</Screen>;
  const unit = state.loaded.unit;

  // Cada grafica con su propio rango, guardado: unas se miran por semana y otras por anio.
  const ranges = chartSetting<Record<string, number>>(
    state.loaded.settings.get('chart_ranges'),
    {},
  );
  const rangeOf = (chart: string) => ranges[chart] ?? DEFAULT_RANGE;
  const dots = (chart: string, title: string) => (
    <RangeDots
      chart={title}
      days={rangeOf(chart)}
      onChange={(next) => {
        setOpen(null);
        saveSetting('chart_ranges', JSON.stringify({ ...ranges, [chart]: next }));
      }}
    />
  );
  // El tiempo en el gym y el progreso por ejercicio pueden esconder sus dias vacios con
  // el ojo: entrena unos dias por semana, y la semana se ve mas hueco que barra.
  const hidden = chartSetting<string[]>(state.loaded.settings.get('chart_gaps_hidden'), []);
  const gapsOf = (chart: string) => !hidden.includes(chart);
  const tools = (chart: string, title: string) => (
    <View style={styles.tools}>
      <GapsEye
        chart={title}
        shown={gapsOf(chart)}
        onChange={(shown) => {
          setOpen(null);
          saveSetting(
            'chart_gaps_hidden',
            JSON.stringify(shown ? hidden.filter((one) => one !== chart) : [...hidden, chart]),
          );
        }}
      />
      {dots(chart, title)}
    </View>
  );
  const routines = [
    ALL_ROUTINES,
    ...new Set(
      (data?.gymMinutes ?? [])
        .map((point) => point.routine)
        .filter((name): name is string => name !== null),
    ),
  ];

  const trend =
    data?.trends.find((item) => item.exerciseId === exercise) ?? data?.trends[0] ?? null;

  /** Lo que necesita cualquier grafica para compartir el unico globito de la pantalla. */
  const bubble = (chart: string) => ({
    selected: open?.chart === chart ? open.index : null,
    onSelect: (index: number | null) => setOpen(index === null ? null : { chart, index }),
    onOpenDay: (date: string) => navigation.navigate('Día', { date }),
  });

  return (
    <Screen title="Gráficas">
      {/* Igual que el teclado: una barra o un boton se quedan con el toque antes de
          llegar aqui, asi que solo lo cierra el toque en una zona muerta. */}
      <View
        style={styles.sheet}
        onStartShouldSetResponder={open === null ? undefined : () => true}
        onResponderRelease={open === null ? undefined : () => setOpen(null)}
      >
        {problem && <Text style={styles.problem}>{problem}</Text>}
        {data === null && <Text style={styles.loading}>Leyendo tus datos…</Text>}

        {data && (
          <>
            <Card title="Nota del día" action={dots('score', 'Nota del día')}>
              <DayBars
                // Con otro rango es otra grafica: vuelve a abrir en hoy.
                key={rangeOf('score')}
                points={data.score}
                days={rangeOf('score')}
                to={data.to}
                width={width}
                band={{ from: 70, to: 100 }}
                max={100}
                format={(value) => `${scoreText(value)} de 100`}
                {...bubble('score')}
              />
            </Card>

            <Card title="Sueño" action={dots('sleep', 'Sueño')}>
              <DayBars
                key={rangeOf('sleep')}
                points={data.sleep}
                days={rangeOf('sleep')}
                to={data.to}
                width={width}
                band={data.sleepBand}
                format={(value) => hoursAndMinutes(value)}
                {...bubble('sleep')}
              />
            </Card>

            <Card title="Proteína por día" action={dots('protein', 'Proteína por día')}>
              <DayBars
                key={rangeOf('protein')}
                points={data.protein}
                days={rangeOf('protein')}
                to={data.to}
                width={width}
                band={data.proteinBand}
                format={(value) => `${Math.round(value)} g`}
                {...bubble('protein')}
              />
            </Card>

            <Card title="Calorías por día" action={dots('kcal', 'Calorías por día')}>
              <DayBars
                key={rangeOf('kcal')}
                points={data.kcal}
                days={rangeOf('kcal')}
                to={data.to}
                width={width}
                band={data.kcalBand}
                format={(value) => `${Math.round(value)} kcal`}
                {...bubble('kcal')}
              />
            </Card>

            <Card title="Pasos" action={dots('steps', 'Pasos')}>
              <DayBars
                key={rangeOf('steps')}
                points={data.steps}
                days={rangeOf('steps')}
                to={data.to}
                width={width}
                band={data.stepsBand}
                format={(value) => thousands(value)}
                {...bubble('steps')}
              />
            </Card>

            <Card title="Series por músculo, últimos 7 días">
              <MuscleBars bars={data.muscles} band={data.setBand} />
            </Card>

            <Card title="Progreso por ejercicio" action={tools('trend', 'Progreso por ejercicio')}>
              <Combobox
                options={data.trends.map((item) => ({ id: item.exerciseId, label: item.name }))}
                value={trend?.exerciseId ?? null}
                onChange={setExercise}
                placeholder="Elige un ejercicio"
                accessibilityLabel="Elegir el ejercicio"
              />
              <Combobox
                options={MEASURES.map((one) => ({ id: one.id, label: one.label }))}
                value={measure.id}
                onChange={(id) => setMeasure((id as MeasureId) ?? 'volume')}
                placeholder="Qué quieres ver"
                accessibilityLabel="Elegir qué se mide"
              />
              {trend ? (
                <DayBars
                  // Otro ejercicio u otra medida es otra historia: vuelve a abrir en hoy.
                  key={`${rangeOf('trend')}-${gapsOf('trend')}-${trend.exerciseId}-${measure.id}`}
                  points={trend[measure.id]}
                  days={rangeOf('trend')}
                  to={data.to}
                  gaps={gapsOf('trend')}
                  width={width}
                  // Los pesos son los de una mancuerna; el volumen ya cuenta las dos.
                  format={(value) =>
                    measure.inKg
                      ? `${Math.round(fromKg(value, unit))} ${unit}${trend.perSide && measure.id !== 'volume' ? ' c/u' : ''}`
                      : `${Math.round(value)}`
                  }
                  {...bubble(`trend-${trend.exerciseId}-${measure.id}`)}
                />
              ) : (
                <Text style={styles.loading}>
                  Anota dos sesiones de un ejercicio y aparece aquí.
                </Text>
              )}
            </Card>

            {/* El tiempo que pasa dentro, que es lo que de verdad le cuesta un entreno. */}
            <Card title="Tiempo en el gym" action={tools('gym-minutes', 'Tiempo en el gym')}>
              <Combobox
                options={routines.map((name) => ({ id: name, label: name }))}
                value={gymRoutine}
                onChange={(id) => {
                  setOpen(null);
                  setGymRoutine(id ?? ALL_ROUTINES);
                }}
                placeholder={ALL_ROUTINES}
                accessibilityLabel="Elegir la rutina"
              />
              <DayBars
                key={`${rangeOf('gym-minutes')}-${gapsOf('gym-minutes')}-${gymRoutine}`}
                points={perDay(
                  data.gymMinutes.filter(
                    (point) => gymRoutine === ALL_ROUTINES || point.routine === gymRoutine,
                  ),
                )}
                days={rangeOf('gym-minutes')}
                to={data.to}
                gaps={gapsOf('gym-minutes')}
                width={width}
                format={(value) => clockFace(value)}
                {...bubble('gym-minutes')}
              />
            </Card>

            {/* La creatina no se nota el dia que se toma, asi que un si o un no por dia no
                dice nada: lo que dice algo es el deposito. */}
            <Card title="Creatina" action={dots('creatine', 'Creatina')}>
              {creatine === null ? (
                <Text style={styles.note}>
                  Anota la creatina unos días y aquí verás cuánta llevas dentro.
                </Text>
              ) : (
                <>
                  <View style={styles.creatineHead}>
                    <Text style={styles.creatineValue}>{Math.round(creatine.level * 100)}%</Text>
                    <Text style={styles.creatineNote}>
                      {sayLevel(creatine.level, creatine.fullOn)}
                    </Text>
                  </View>
                  <DayBars
                    key={rangeOf('creatine')}
                    points={data.creatine}
                    days={rangeOf('creatine')}
                    to={data.to}
                    projected={data.creatineProjection}
                    width={width}
                    band={{ from: FULL_LEVEL * 100, to: 100 }}
                    max={100}
                    // Al tocar una barra importa si la tomo ese dia, no el porcentaje.
                    format={() => ''}
                    {...bubble('creatine')}
                  />
                </>
              )}
            </Card>

            {/* El peso al final: cambia poco y se pesa poco, asi que no tiene por que
                abrir la pantalla. */}
            <Card title="Peso corporal" action={dots('weight', 'Peso corporal')}>
              <LineChart
                key={rangeOf('weight')}
                days={rangeOf('weight')}
                to={data.to}
                width={width}
                format={(value) => `${value.toFixed(1)} kg`}
                series={[
                  { points: data.weight, color: theme.surfaceHigh, dots: true },
                  { points: data.weightAverage, color: theme.accent },
                ]}
                {...bubble('weight')}
              />
            </Card>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = sheet((theme) => ({
  creatineHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
  },
  creatineValue: {
    fontSize: 40,
    lineHeight: 44,
    fontFamily: font.display,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  creatineNote: {
    flex: 1,
    fontSize: 12,
    fontFamily: font.bold,
    color: theme.textDim,
  },
  sheet: {
    gap: 12,
  },
  tools: {
    flexDirection: 'row',
    gap: 4,
  },
  note: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  loading: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.textFaint,
  },
  problem: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.danger,
  },
}));
