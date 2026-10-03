import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';

import { sayLevel } from '../../core/creatine.ts';
import { hoursAndMinutes, scoreText, thousands } from '../../core/day-report.ts';
import { fromKg } from '../../core/units.ts';
import { useAppData } from '../../shell/AppData.tsx';
import type { ChartsData } from '../../shell/charts.ts';

import { Card } from '../Card.tsx';
import { DayBars } from '../charts/DayBars.tsx';
import { LineChart } from '../charts/LineChart.tsx';
import { MuscleBars } from '../charts/MuscleBars.tsx';
import { Chip } from '../Chip.tsx';
import { clockFace } from '../../training/pace.ts';
import { Combobox } from '../Combobox.tsx';
import { font, sheet, theme } from '../theme.ts';

import { Screen } from './Screen.tsx';

/** Lo que Screen deja a cada lado del contenido, y lo que mide una cartilla por dentro. */
const SCREEN_PADDING = 20;
const CARD_PADDING = 14;

const WINDOWS: { days: number; label: string }[] = [
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
  { days: 365, label: 'un año' },
];

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
    note: 'Todo lo que moviste ese día: peso por repeticiones, sumando las series. Las mancuernas cuentan las dos.',
  },
  {
    id: 'topWeight',
    label: 'Peso máximo',
    inKg: true,
    note: 'El peso más alto que cargaste ese día, tal como lo escribiste. Con mancuernas, el de una.',
  },
  {
    id: 'e1rm',
    label: '1RM estimado',
    inKg: true,
    note: 'Lo que levantarías una sola vez, calculado sobre tu mejor serie. Sirve para comparar días con repeticiones distintas.',
  },
  {
    id: 'intensity',
    label: 'Peso medio por repetición',
    inKg: true,
    note: 'El volumen entre las repeticiones. Dice si el día fue pesado o largo, que no es lo mismo.',
  },
  {
    id: 'reps',
    label: 'Repeticiones',
    inKg: false,
    note: 'Cuántas repeticiones hiciste en total ese día.',
  },
  {
    id: 'sets',
    label: 'Series',
    inKg: false,
    note: 'Cuántas series le dedicaste. Es la medida con la que se cuenta el volumen semanal por músculo.',
  },
] as const;

type MeasureId = (typeof MEASURES)[number]['id'];

export function ChartsScreen() {
  const { state, loadCharts } = useAppData();
  const navigation = useNavigation<{
    navigate: (name: string, params?: { date: string }) => void;
  }>();
  // Un solo globito abierto en toda la pantalla: tocar una barra de otra grafica
  // cierra el anterior, y tocar fuera los cierra todos.
  const [open, setOpen] = useState<{ chart: string; index: number } | null>(null);
  const [days, setDays] = useState(90);
  const [data, setData] = useState<ChartsData | null>(null);
  const [exercise, setExercise] = useState<string | null>(null);
  const [measureId, setMeasure] = useState<MeasureId>('volume');
  const measure = MEASURES.find((one) => one.id === measureId) ?? MEASURES[0];
  const creatine = data?.creatineReading ?? null;
  const [problem, setProblem] = useState<string | null>(null);
  // El SVG necesita un ancho en numeros. Se calcula de la ventana menos los margenes
  // en vez de medirlo: medir deja el primer dibujo en cero.
  const width = useWindowDimensions().width - SCREEN_PADDING * 2 - CARD_PADDING * 2;

  const reload = useCallback(() => {
    loadCharts(days)
      .then(setData)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(error instanceof Error ? error.message : String(error));
      });
  }, [loadCharts, days]);

  useEffect(reload, [reload]);

  if (state.phase !== 'ready') return <Screen title="Gráficas">{null}</Screen>;
  const unit = state.loaded.unit;

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
        <View style={styles.chips}>
          {WINDOWS.map((option) => (
            <Chip
              key={option.days}
              label={option.label}
              accessibilityLabel={`Ver ${option.label}`}
              selected={option.days === days}
              onPress={() => setDays(option.days)}
            />
          ))}
        </View>

        {problem && <Text style={styles.problem}>{problem}</Text>}
        {data === null && <Text style={styles.loading}>Leyendo tus datos…</Text>}

        {data && (
          <>
            <Card title="Nota del día">
              <Text style={styles.note}>
                Cada barra es un día puntuado. Tócala para ver cuál fue.
              </Text>
              <DayBars
                points={data.score}
                width={width}
                band={{ from: 70, to: 100 }}
                max={100}
                format={(value) => `${scoreText(value)} de 100`}
                {...bubble('score')}
              />
            </Card>

            <Card title="Sueño">
              <Text style={styles.note}>
                La franja va de tu meta a las ocho horas, que es donde la nota llega a sus veinte
                puntos.
              </Text>
              <DayBars
                points={data.sleep}
                width={width}
                band={data.sleepBand}
                format={(value) => hoursAndMinutes(value)}
                {...bubble('sleep')}
              />
            </Card>

            <Card title="Proteína por día">
              <Text style={styles.note}>
                Verde, dentro de tu banda. Gris, fuera. La banda sale de tu peso.
              </Text>
              <DayBars
                points={data.protein}
                width={width}
                band={data.proteinBand}
                format={(value) => `${Math.round(value)} g`}
                {...bubble('protein')}
              />
            </Card>

            <Card title="Calorías por día">
              <Text style={styles.note}>
                La banda es tu objetivo con el margen que la app considera dentro.
              </Text>
              <DayBars
                points={data.kcal}
                width={width}
                band={data.kcalBand}
                format={(value) => `${Math.round(value)} kcal`}
                {...bubble('kcal')}
              />
            </Card>

            <Card title="Pasos">
              <Text style={styles.note}>De tu meta para arriba está bien; debajo, no.</Text>
              <DayBars
                points={data.steps}
                width={width}
                band={data.stepsBand}
                format={(value) => thousands(value)}
                {...bubble('steps')}
              />
            </Card>

            <Card title="Series por músculo">
              <Text style={styles.note}>
                Últimos siete días, solo las directas. Toca un músculo para ver de qué ejercicios
                salieron.
              </Text>
              <MuscleBars bars={data.muscles} band={data.setBand} />
            </Card>

            <Card title="Progreso por ejercicio">
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
              <Text style={styles.note}>{measure.note}</Text>
              {trend ? (
                <DayBars
                  points={trend[measure.id]}
                  width={width}
                  format={(value) =>
                    measure.inKg
                      ? `${Math.round(fromKg(value, unit))} ${unit}`
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
            <Card title="Tiempo en el gym">
              <Text style={styles.note}>
                Solo los días cuyo tiempo marcaste como preciso, en el registro de ese día. Toca una
                barra para ver de qué fue.
              </Text>
              <DayBars
                points={data.gymMinutes}
                width={width}
                format={(value) => clockFace(value)}
                {...bubble('gym-minutes')}
              />
            </Card>

            {/* La creatina no se nota el dia que se toma, asi que un si o un no por dia no
                dice nada: lo que dice algo es el deposito. */}
            <Card title="Creatina">
              {creatine === null ? (
                <Text style={styles.note}>
                  Anota la creatina unos días y aquí verás cuánta llevas dentro.
                </Text>
              ) : (
                <>
                  <View style={styles.creatineHead}>
                    <Text style={styles.creatineValue}>{Math.round(creatine.level * 100)}%</Text>
                    <Text style={styles.creatineNote}>
                      {sayLevel(creatine.level)}
                      {'\n'}
                      {creatine.streak > 0
                        ? `${creatine.streak} ${creatine.streak === 1 ? 'día' : 'días'} seguidos tomándola`
                        : `${-creatine.streak} ${creatine.streak === -1 ? 'día' : 'días'} sin tomarla`}
                      {creatine.trend === 'estable' ? '' : ` · ${creatine.trend}`}
                    </Text>
                  </View>
                  <DayBars
                    points={data.creatine}
                    width={width}
                    band={{ from: 90, to: 100 }}
                    max={100}
                    format={(value) => `${Math.round(value)}% del depósito`}
                    {...bubble('creatine')}
                  />
                  <Text style={styles.note}>
                    Estimado: tomándola a diario se llena en 28 días, y dejándola se vacía en 30
                    (Hultman 1996, en Lecturas). Un día sin anotar cuenta como no tomada.
                  </Text>
                </>
              )}
            </Card>

            {/* El peso al final: cambia poco y se pesa poco, asi que no tiene por que
                abrir la pantalla. */}
            <Card title="Peso corporal">
              <Text style={styles.note}>
                El punto es cada pesada y la línea amarilla es la media de siete días, que es la que
                manda.
              </Text>
              <LineChart
                width={width}
                format={(value) => `${Math.round(fromKg(value, 'kg'))} kg`}
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
