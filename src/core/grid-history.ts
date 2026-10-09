import {
  addDays,
  daysBetween,
  shortMonth,
  weekStart,
  type DateRange,
  type IsoDate,
} from './dates.ts';

export const GRID_HISTORY_START = '2025-01-01';
export const GRID_VISIBLE_WEEKS = 12;

export function historyWeeks(today: IsoDate): IsoDate[] {
  const first = weekStart(GRID_HISTORY_START);
  if (today < GRID_HISTORY_START) return [];
  const count = Math.floor(daysBetween(first, today) / 7) + 1;
  return Array.from({ length: count }, (_, index) => addDays(first, index * 7));
}

export function historyRange(
  weeks: readonly IsoDate[],
  index: number,
  count: number,
  today: IsoDate,
): DateRange {
  const start = weeks[Math.max(0, Math.min(index, weeks.length - 1))] ?? GRID_HISTORY_START;
  const end = weeks[Math.min(weeks.length - 1, Math.max(0, index) + count - 1)] ?? start;
  return {
    from: start < GRID_HISTORY_START ? GRID_HISTORY_START : start,
    to: addDays(end, 6) > today ? today : addDays(end, 6),
  };
}

/**
 * Lo que falta leer para ver las doce semanas que empiezan en `firstIndex`, o null si ya
 * esta todo: las recientes vienen con la carga del dia, y lo demas con la ultima lectura
 * si sigue siendo de estos datos.
 *
 * Se lee por paginas de doce semanas con una pagina de cada lado, para no consultar a cada
 * pixel. Pero lo que decide si hace falta leer es la ventana que se ve, no la pagina: una
 * lectura hecha desde otra pagina no siempre cubre la ventana entera de esta, y cuando solo
 * se miraba al cambiar de pagina se quedaba en "Cargando historial" hasta moverla.
 */
export function historyToRead(
  weeks: readonly IsoDate[],
  firstIndex: number,
  today: IsoDate,
  read: { range: DateRange; revision: number } | null,
  revision: number,
): DateRange | null {
  const recentFrom = weekStart(addDays(today, -(GRID_VISIBLE_WEEKS - 1) * 7));
  const visible = historyRange(weeks, firstIndex, GRID_VISIBLE_WEEKS, today);
  if (visible.from >= recentFrom) return null;
  if (
    read?.revision === revision &&
    read.range.from <= visible.from &&
    read.range.to >= visible.to
  ) {
    return null;
  }
  const page = Math.floor(firstIndex / GRID_VISIBLE_WEEKS);
  return historyRange(
    weeks,
    Math.max(0, (page - 1) * GRID_VISIBLE_WEEKS),
    GRID_VISIBLE_WEEKS * 3,
    today,
  );
}

export function historyRangeLabel(range: DateRange): string {
  const from = `${shortMonth(range.from)} ${range.from.slice(0, 4)}`;
  const to = `${shortMonth(range.to)} ${range.to.slice(0, 4)}`;
  return from === to ? from : `${from} – ${to}`;
}
