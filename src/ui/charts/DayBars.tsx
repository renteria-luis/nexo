import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { addDays, daysBetween, shortDate, type IsoDate } from '../../core/dates.ts';
import type { Band, Point } from '../../shell/charts.ts';
import { font, sheet, theme } from '../theme.ts';

import { Bubble, BUBBLE_WIDTH } from './Bubble.tsx';
import { DayScroll } from './DayScroll.tsx';

const HEIGHT = 110;
/** Sitio arriba para el trazo del contorno: la barra mas alta se cortaba por la mitad. */
const PAD = 2;
/** El contorno de una barra, mas fino que el borde de la app (decision suya, 30-09). */
const STROKE = 1.2;
/** Una lista nueva en cada dibujo volveria a pintar todas las paginas al deslizar. */
const NO_ESTIMATE: Point[] = [];

const yOf = (value: number, top: number) => PAD + (HEIGHT - PAD) - (value / top) * (HEIGHT - PAD);

/**
 * Una barra por dia, con la banda objetivo pintada por detras.
 *
 * Asi la pregunta deja de ser "cuanta proteina comi el martes" y pasa a ser "cuantos
 * dias cai dentro", que es la que de verdad cambia algo.
 */
export function DayBars({
  points,
  days,
  to,
  gaps = true,
  projected = NO_ESTIMATE,
  width,
  band,
  max,
  filling = false,
  format,
  selected = null,
  onSelect,
  onOpenDay,
}: {
  /** Toda la historia: la grafica empieza en el primer dato y se desliza hasta el. */
  points: Point[];
  /** Los dias que caben a la vez: el rango que eligio con los circulitos. */
  days: number;
  /** Hoy. La grafica abre en los dias que terminan aqui. */
  to: IsoDate;
  /**
   * Los dias sin dato, como huecos vacios. Sin ellos quedan solo los dias con dato, uno
   * detras de otro, y caben a la vez los que hay en el rango que termina hoy.
   */
  gaps?: boolean;
  /** Lo que se estima despues del ultimo dia: sin relleno y con el borde punteado. */
  projected?: Point[];
  width: number;
  band?: Band | null;
  max?: number;
  /**
   * Un deposito que se llena: lo que va camino de la banda en verde tenue y no en gris, que
   * dejaba la creatina toda gris hasta llenarse (2026-10-25).
   */
  filling?: boolean;
  format: (value: number) => string;
  /** El dia abierto en el globito, o null. Lo lleva la pantalla para que solo haya uno. */
  selected?: number | null;
  onSelect?: (index: number | null) => void;
  onOpenDay?: (date: IsoDate) => void;
}) {
  // Un hueco por dia, con dato o sin el: un dia sin anotar no es un cero (2026-10-10).
  const slots = useMemo(() => {
    if (points.length === 0) return [];
    const real = new Map(points.map((point) => [point.date, point]));
    const estimated = new Map(projected.map((point) => [point.date, point]));
    const slot = (date: IsoDate) => {
      const point = real.get(date) ?? estimated.get(date);
      return { date, point, estimate: !real.has(date) && point !== undefined };
    };
    if (!gaps) return [...new Set([...real.keys(), ...estimated.keys()])].sort().map(slot);
    const from = points.reduce((low, point) => (point.date < low ? point.date : low), to);
    const last = projected.reduce((end, point) => (point.date > end ? point.date : end), to);
    return Array.from({ length: daysBetween(from, last) + 1 }, (_, index) =>
      slot(addDays(from, index)),
    );
  }, [points, projected, to, gaps]);

  const start = addDays(to, -(days - 1));
  const inRange = slots.filter((slot) => slot.date >= start && slot.date <= to).length;
  const visible = Math.max(1, Math.min(gaps ? days : inRange, slots.length));
  // Abre en lo que termina hoy: lo de despues, como la estimacion, espera a la derecha.
  const [first, setFirst] = useState(() =>
    Math.max(
      0,
      Math.min(slots.length - visible, slots.filter((slot) => slot.date <= to).length - visible),
    ),
  );
  const step = width / visible;
  // La escala sale de toda la historia: con la de lo visible, las barras cambiarian de
  // alto mientras desliza.
  const top =
    Math.max(
      max ?? 0,
      ...points.map((point) => point.value),
      ...projected.map((point) => point.value),
      band?.to ?? 0,
    ) || 1;
  const open = selected !== null && slots[selected]?.point !== undefined ? selected : null;

  const renderPage = useCallback(
    (start: number, count: number) => {
      // El borde se dibuja a caballo del contorno, asi que la barra se estrecha lo que
      // mide ese trazo para que dos barras vecinas no se toquen.
      const barWidth = Math.max(2, step - 3);
      // Con noventa dias la barra mide cuatro puntos y hasta este trazo se la come, asi
      // que ahi adelgaza todavia mas.
      const stroke = barWidth > 10 ? STROKE : 1;
      const inside = (value: number) => !band || (value >= band.from && value <= band.to);
      const page = slots.slice(start, start + count);
      return (
        <>
          <Svg width={count * step} height={HEIGHT}>
            {page.map(({ date, point, estimate }, offset) =>
              point === undefined ? null : (
                <Rect
                  key={date}
                  x={offset * step + 1.5}
                  y={yOf(point.value, top)}
                  width={barWidth}
                  height={Math.max(2, HEIGHT - yOf(point.value, top))}
                  rx={1}
                  fill={
                    open === start + offset
                      ? theme.accent
                      : estimate
                        ? 'none'
                        : inside(point.value) || filling
                          ? theme.ok
                          : theme.lineSoft
                  }
                  // Camino de la banda, el verde a media luz: se ve que se llena.
                  fillOpacity={filling && !inside(point.value) && open !== start + offset ? 0.4 : 1}
                  stroke={estimate ? theme.textFaint : theme.line}
                  strokeWidth={stroke}
                  strokeDasharray={estimate ? '3,2' : undefined}
                />
              ),
            )}
          </Svg>

          {/* Las zonas de toque van encima del dibujo: una por barra y del ancho del
              hueco, porque una barra de dos pixeles no se acierta con el pulgar. */}
          {onSelect && (
            <View style={[styles.touch, { width: count * step, height: HEIGHT }]}>
              {page.map(({ date, point }, offset) =>
                // Un hueco vacio no tiene nada que contar: el toque sigue hacia la
                // pantalla, que cierra el globito como cualquier zona muerta.
                point === undefined ? (
                  <View key={date} pointerEvents="none" style={{ width: step, height: HEIGHT }} />
                ) : (
                  <Pressable
                    key={date}
                    accessibilityLabel={`Ver el ${date}`}
                    onPress={() => onSelect(open === start + offset ? null : start + offset)}
                    style={{ width: step, height: HEIGHT }}
                  />
                ),
              )}
            </View>
          )}
        </>
      );
    },
    [slots, step, top, band, filling, open, onSelect],
  );

  if (slots.length === 0 || width <= 0) {
    return <Text style={styles.empty}>Todavía no hay datos.</Text>;
  }

  const at = Math.min(first, slots.length - visible);
  const picked = open === null ? null : (slots[open].point as Point);
  const bubbleLeft =
    open === null
      ? 0
      : Math.min(
          Math.max(0, (open - at) * step + step / 2 - BUBBLE_WIDTH / 2),
          width - BUBBLE_WIDTH,
        );

  return (
    <View>
      <View style={{ width, height: HEIGHT }}>
        {/* La banda y la linea de base no se mueven: son las mismas en todos los dias. */}
        {band && (
          <View
            style={[
              styles.band,
              {
                top: yOf(band.to, top),
                height: Math.max(1, yOf(band.from, top) - yOf(band.to, top)),
              },
            ]}
          />
        )}
        <DayScroll
          total={slots.length}
          visible={visible}
          first={at}
          width={width}
          height={HEIGHT}
          renderPage={renderPage}
          onMove={setFirst}
          onDragStart={onSelect && (() => onSelect(null))}
        />
        {/* Encima de las barras: es el suelo del dibujo. */}
        <View pointerEvents="none" style={styles.floor} />
      </View>

      {/* Las fechas son las de los bordes de lo que se ve, y siguen al dedo. */}
      <View style={styles.axis}>
        <Text style={styles.axisText}>{shortDate(slots[at].date)}</Text>
        {/* La banda ya se ve pintada: escrita debajo era repetirla (decision 2026-10-10). */}
        {!band && <Text style={styles.axisText}>máx {format(top)}</Text>}
        <Text style={styles.axisText}>{shortDate(slots[at + visible - 1].date)}</Text>
      </View>

      {/* Despues del eje: lo que va despues se pinta encima, y la fecha tapaba su boton. */}
      {picked && (
        <Bubble
          date={shortDate(picked.date)}
          value={format(picked.value)}
          note={picked.note}
          width={BUBBLE_WIDTH}
          left={bubbleLeft}
          onOpenDay={onOpenDay ? () => onOpenDay(picked.date) : undefined}
        />
      )}
    </View>
  );
}

const styles = sheet((theme) => ({
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: theme.okBg,
  },
  floor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: STROKE,
    backgroundColor: theme.line,
  },
  touch: {
    position: 'absolute',
    top: 0,
    left: 0,
    flexDirection: 'row',
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  axisText: {
    fontSize: 11,
    color: theme.textFaint,
    fontFamily: font.bold,
    fontVariant: ['tabular-nums'],
  },
  empty: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.textFaint,
    paddingVertical: 12,
  },
}));
