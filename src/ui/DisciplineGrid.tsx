import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { Animated, AppState, FlatList, Platform, Pressable, Text, View } from 'react-native';

import { addDays, shortDate, shortMonth, weekStart, type DateRange } from '../core/dates.ts';
import { averageScore, buildGrid, type GridWeek, type ScoredDay } from '../core/heatmap.ts';
import {
  GRID_HISTORY_START,
  GRID_VISIBLE_WEEKS,
  historyRange,
  historyRangeLabel,
  historyWeeks,
} from '../core/grid-history.ts';
import { levelForScore, scoreLevels, type ScoreScaleOptions } from '../core/palettes.ts';
import { Button } from './Button.tsx';
import { useSwipeLock } from './SwipeLock.tsx';
import { font, hardShadow, sheet, shape } from './theme.ts';

const GAP = 2;
const GUTTER = 24;
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
type OpenDay = (date: string, at: { x: number; y: number; width: number; height: number }) => void;

export function ScoreCell({
  color,
  size,
  today = false,
}: {
  color: string;
  size?: number;
  today?: boolean;
}) {
  return (
    <View
      style={[
        styles.cell,
        { backgroundColor: color },
        today && styles.cellToday,
        size === undefined ? styles.cellFills : { width: size, height: size },
      ]}
    />
  );
}

const Week = memo(function Week({
  week,
  today,
  width,
  known,
  scale,
  onOpenDay,
}: {
  week: GridWeek;
  today: string;
  width: number;
  known: boolean;
  scale: ScoreScaleOptions;
  onOpenDay?: OpenDay;
}) {
  return (
    <View style={{ width, gap: GAP }}>
      {week.cells.map((cell) => {
        if (!cell.inRange) return <View key={cell.date} style={styles.touch} />;
        if (!known) return <View key={cell.date} style={[styles.touch, styles.loadingCell]} />;
        const description =
          cell.score === null
            ? cell.hasData
              ? 'Sin puntuación'
              : 'Sin datos'
            : `${cell.score}%, ${levelForScore(cell.score, scale).label}`;
        return (
          <Pressable
            key={cell.date}
            accessibilityRole="button"
            accessibilityLabel={`${shortDate(cell.date)}: ${description}${cell.date === today ? ', hoy' : ''}`}
            accessibilityHint="Ver el detalle del día"
            style={styles.touch}
            onPress={(event) =>
              onOpenDay?.(cell.date, {
                x: event.nativeEvent.pageX - width / 2,
                y: event.nativeEvent.pageY - width / 2,
                width,
                height: width,
              })
            }
          >
            <ScoreCell color={cell.color} today={cell.date === today} />
          </Pressable>
        );
      })}
    </View>
  );
});

type HistoryCache = { range: DateRange; days: ScoredDay[]; revision: number };

export const DisciplineGrid = memo(function DisciplineGrid({
  days,
  today,
  scale,
  revision,
  loadDays,
  onOpenDay,
  onScrollStart,
}: {
  days: ScoredDay[];
  today: string;
  scale: ScoreScaleOptions;
  revision: number;
  loadDays: (range: DateRange) => Promise<ScoredDay[]>;
  onOpenDay?: OpenDay;
  onScrollStart?: () => void;
}) {
  const weeks = useMemo(() => historyWeeks(today), [today]);
  const lastIndex = Math.max(0, weeks.length - GRID_VISIBLE_WEEKS);
  const [firstIndex, setFirstIndex] = useState(lastIndex);
  const first = useRef(firstIndex);
  useEffect(() => {
    first.current = firstIndex;
  }, [firstIndex]);
  const previousLast = useRef(lastIndex);
  const [width, setWidth] = useState(0);
  const pitch = width > GUTTER ? (width - GUTTER + GAP) / GRID_VISIBLE_WEEKS : 0;
  const square = Math.max(0, pitch - GAP);
  const list = useRef<FlatList<string>>(null);
  const [offset] = useState(() => new Animated.Value(0));
  const { acquire } = useSwipeLock();
  const release = useRef<(() => void) | null>(null);
  const focused = useIsFocused();
  const unlock = useCallback(() => {
    release.current?.();
    release.current = null;
  }, []);
  const lock = useCallback(() => {
    release.current ??= acquire();
  }, [acquire]);
  useEffect(() => {
    if (!focused) unlock();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') unlock();
    });
    return () => {
      subscription.remove();
      unlock();
    };
  }, [focused, unlock]);

  useEffect(() => {
    const atEnd = first.current >= previousLast.current;
    previousLast.current = lastIndex;
    const next = atEnd ? lastIndex : Math.min(first.current, lastIndex);
    offset.setValue(next * pitch);
    const frame = requestAnimationFrame(() =>
      list.current?.scrollToOffset({ offset: next * pitch, animated: false }),
    );
    return () => cancelAnimationFrame(frame);
  }, [lastIndex, pitch, offset]);

  const [cache, setCache] = useState<HistoryCache | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const recentFrom = weekStart(addDays(today, -(GRID_VISIBLE_WEEKS - 1) * 7));
  const visible = historyRange(weeks, firstIndex, GRID_VISIBLE_WEEKS, today);
  const page = Math.floor(firstIndex / GRID_VISIBLE_WEEKS);
  const wanted = historyRange(
    weeks,
    Math.max(0, (page - 1) * GRID_VISIBLE_WEEKS),
    GRID_VISIBLE_WEEKS * 3,
    today,
  );
  const needsHistory = visible.from < recentFrom;
  useEffect(() => {
    if (!needsHistory) return;
    if (
      cache?.revision === revision &&
      cache.range.from <= visible.from &&
      cache.range.to >= visible.to
    )
      return;
    let live = true;
    const timer = setTimeout(() => {
      setProblem(null);
      loadDays(wanted)
        .then((result) => {
          if (live) setCache({ range: wanted, days: result, revision });
        })
        .catch((error: unknown) => {
          if (live)
            setProblem(error instanceof Error ? error.message : 'No se pudo cargar el historial.');
        });
    }, 100);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // A page covers a moving viewport plus its neighbors; do not query on every pixel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, revision, today, needsHistory, loadDays, retry]);

  const combined = useMemo(() => {
    const byDate = new Map(cache?.days.map((day) => [day.date, day]) ?? []);
    days.forEach((day) => byDate.set(day.date, day));
    return [...byDate.values()];
  }, [cache, days]);
  const known = useCallback(
    (date: string) =>
      date >= recentFrom || (!!cache && date >= cache.range.from && date <= cache.range.to),
    [recentFrom, cache],
  );
  const renderWeek = useCallback(
    ({ item }: { item: string }) => {
      const range = {
        from: item < GRID_HISTORY_START ? GRID_HISTORY_START : item,
        to: addDays(item, 6) > today ? today : addDays(item, 6),
      };
      const week = buildGrid(combined, range, scale)[0];
      return (
        <Week
          week={week}
          today={today}
          width={square}
          known={known(range.from) && known(range.to)}
          scale={scale}
          onOpenDay={onOpenDay}
        />
      );
    },
    [combined, today, scale, square, known, onOpenDay],
  );
  const months = useMemo(
    () =>
      weeks.flatMap((date, index) => {
        const labelDate = date < GRID_HISTORY_START ? GRID_HISTORY_START : date;
        const previous = weeks[index - 1];
        const previousDate =
          previous && previous < GRID_HISTORY_START ? GRID_HISTORY_START : previous;
        return index === 0 || previousDate?.slice(0, 7) !== labelDate.slice(0, 7)
          ? [{ index, label: shortMonth(labelDate) }]
          : [];
      }),
    [weeks],
  );
  const rangeKnown = weeks
    .slice(firstIndex, firstIndex + GRID_VISIBLE_WEEKS)
    .every(
      (date) =>
        known(date < GRID_HISTORY_START ? GRID_HISTORY_START : date) &&
        known(addDays(date, 6) > today ? today : addDays(date, 6)),
    );
  const average = rangeKnown
    ? averageScore(combined.filter((day) => day.date >= visible.from && day.date <= visible.to))
    : null;
  const levels = useMemo(() => scoreLevels(scale), [scale]);
  const trackScroll = useCallback(
    (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      const next = Math.max(
        0,
        // Native scroll widths round to pixels; the rounded end is still the last week.
        Math.min(lastIndex, Math.floor((event.nativeEvent.contentOffset.x + 1) / pitch)),
      );
      setFirstIndex(next);
    },
    [lastIndex, pitch],
  );
  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: offset } } }], {
        useNativeDriver: Platform.OS !== 'web',
        listener: trackScroll,
      }),
    [offset, trackScroll],
  );
  return (
    <View style={styles.wrapper} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Text style={styles.range} accessibilityLabel={`Período visible: ${historyRangeLabel(visible)}`}>
        {historyRangeLabel(visible)}
      </Text>
      <View style={[styles.monthViewport, { marginLeft: GUTTER }]} pointerEvents="none">
        <Animated.View
          style={{
            width: weeks.length * pitch,
            height: 18,
            transform: [{ translateX: Animated.multiply(offset, -1) }],
          }}
        >
          {months.map((month) => (
            <Text
              key={month.index}
              numberOfLines={1}
              style={[styles.month, { left: month.index * pitch }]}
            >
              {month.label}
            </Text>
          ))}
        </Animated.View>
      </View>
      <View style={styles.grid}>
        <View style={{ width: GUTTER, gap: GAP }}>
          {WEEKDAYS.map((label, index) => (
            <View key={index} style={{ height: square, justifyContent: 'center' }}>
              <Text style={styles.weekday}>{label}</Text>
            </View>
          ))}
        </View>
        {pitch > 0 && (
          <Animated.FlatList
            ref={list}
            accessibilityLabel="Historial de cumplimiento"
            horizontal
            data={weeks}
            renderItem={renderWeek}
            keyExtractor={(date) => date}
            ItemSeparatorComponent={WeekGap}
            getItemLayout={(_, index) => ({ length: pitch, offset: index * pitch, index })}
            initialNumToRender={GRID_VISIBLE_WEEKS + 2}
            maxToRenderPerBatch={GRID_VISIBLE_WEEKS + 2}
            windowSize={3}
            removeClippedSubviews={false}
            style={{ flex: 1, height: 7 * pitch - GAP }}
            showsHorizontalScrollIndicator={false}
            bounces
            alwaysBounceHorizontal
            directionalLockEnabled
            scrollEventThrottle={16}
            onTouchStart={lock}
            onTouchEnd={unlock}
            onTouchCancel={unlock}
            onScrollBeginDrag={() => {
              lock();
              onScrollStart?.();
            }}
            onScrollEndDrag={unlock}
            onMomentumScrollEnd={unlock}
            onScroll={onScroll}
          />
        )}
      </View>
      <View
        style={styles.legend}
        accessible
        accessibilityLabel={`Menos a más cumplimiento. ${levels
          .slice(1)
          .map((level) => `${level.label}: ${level.range}`)
          .join('. ')}`}
      >
        <Text style={styles.small}>Menos</Text>
        {levels.slice(1).map((level) => (
          <ScoreCell key={level.label} color={level.color} size={12} />
        ))}
        <Text style={styles.small}>Más</Text>
      </View>
      {problem && needsHistory ? (
        <View>
          <Text style={styles.error}>{problem}</Text>
          <Button
            label="Reintentar historial"
            variant="ghost"
            onPress={() => setRetry((value) => value + 1)}
          />
        </View>
      ) : !rangeKnown ? (
        <Text style={styles.small}>Cargando historial…</Text>
      ) : null}
      <Text style={styles.small}>
        Promedio del período: {average === null ? '—' : Math.round(average)}
      </Text>
    </View>
  );
});

function WeekGap() {
  return <View style={{ width: GAP }} />;
}

const styles = sheet((theme) => ({
  wrapper: { alignSelf: 'stretch', gap: 8 },
  grid: { alignSelf: 'stretch', flexDirection: 'row' },
  range: { fontSize: 11, fontFamily: font.bold, color: theme.textDim },
  monthViewport: { overflow: 'hidden', height: 18, marginBottom: -6 },
  month: {
    position: 'absolute',
    top: 0,
    minWidth: 32,
    fontSize: 10,
    color: theme.textDim,
    fontFamily: font.bold,
  },
  legend: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 4 },
  small: { fontSize: 10, color: theme.textDim, fontFamily: font.bold },
  touch: { width: '100%', aspectRatio: 1 },
  weekday: { fontSize: 11, color: theme.text, fontFamily: font.black },
  cell: { borderRadius: 3, borderWidth: 1, borderColor: theme.lineSoft, overflow: 'hidden' },
  cellFills: { flex: 1, alignSelf: 'stretch' },
  cellToday: { borderWidth: shape.border, borderColor: theme.line, ...hardShadow(theme, 2) },
  loadingCell: { backgroundColor: theme.lineSoft, opacity: 0.35, borderRadius: 3 },
  error: { fontSize: 12, fontFamily: font.bold, color: theme.danger },
}));
