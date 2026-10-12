import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  mergeLiveDeparture,
  tripLiveDetail,
  liveFreshness,
  type LiveDeparture,
  type LiveDetailStop,
  type LiveSnapshot,
} from '../transit/realtime.ts';
import { addDays, shortDay } from '../core/dates.ts';
import {
  agencyClock,
  agencyDate,
  type Departure,
  type Route,
  type Schedule,
  type Stop,
} from '../transit/schedule.ts';
import { Chip } from './Chip.tsx';
import { Bus, ChevronDown, ChevronUp, TriangleAlert, X } from './icons.ts';
import { routeColor } from './routeColors.ts';
import { font, shape, sheet, theme } from './theme.ts';
import { RouteBadge, StatusIcons } from './TransitStatus.tsx';

const statusLabel: Record<string, string> = {
  live: 'En vivo LTC',
  schedule: 'Horario',
  unassigned: 'Horario · sin bus asignado',
  stale: 'Última predicción',
  canceled: 'Cancelado',
  skipped: 'No se detiene',
  'no-data': 'Horario · sin predicción',
  unsupported: 'Horario · viaje sin confirmar',
};

function label(live: LiveDeparture) {
  if (live.status === 'stale' && live.relationship === 'canceled')
    return 'Último reporte: cancelado';
  if (live.status === 'stale' && live.relationship === 'skipped')
    return 'Último reporte: no se detiene';
  return statusLabel[live.status];
}

function useLiveClock(active: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function measurement(at: number | null, now: number) {
  return at === null
    ? 'sin hora de medición'
    : `reporte ${agencyClock(at)} · hace ${Math.max(0, Math.floor((now - at) / 1000))} s`;
}

const sameDeparture = (a: Departure, b: Departure) =>
  a.trip[0] === b.trip[0] && a.serviceDate === b.serviceDate && a.stopTime[1] === b.stopTime[1];

function relative(at: number, now: number) {
  const minutes = Math.round((at - now) / 60_000);
  return minutes === 0 ? 'ahora' : minutes > 0 ? `en ${minutes} min` : `hace ${-minutes} min`;
}

function ago(at: number | null, now: number) {
  if (at === null) return null;
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return seconds < 120 ? `hace ${seconds} s` : `hace ${Math.floor(seconds / 60)} min`;
}

function destination(d: Departure) {
  const text = d.stopTime[7] || d.trip[3] || d.route[2];
  const [main, via] = text.split(/ via /i);
  return { text, main: main.trim(), via: via?.trim() ?? null };
}

function dayOf(at: number, now: number) {
  const day = agencyDate(at);
  const today = agencyDate(now);
  return day === today ? '' : day === addDays(today, 1) ? 'mañana' : shortDay(day);
}

function details(d: Departure, live: LiveDeparture, now: number, departed: boolean) {
  const age = live.status === 'live' || live.status === 'stale' ? ago(live.reportedAt, now) : null;
  return [
    dayOf(live.at, now),
    departed ? 'ya pasó' : live.status === 'live' ? relative(live.at, now) : '',
    live.status === 'canceled' ? 'Cancelado' : '',
    live.status === 'skipped' ? 'No para aquí' : '',
    live.at !== d.at ? `horario ${agencyClock(d.at)}` : '',
    live.eventKind === 'arrival' ? 'llegada' : '',
    age ? (live.status === 'stale' ? `último reporte ${age}` : age) : '',
    d.stopTime[4] > 1 ? 'recogida condicionada' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

type DepartureLine = { departure: Departure; live: LiveDeparture; departed: boolean };

function DepartureRow({
  line: { departure: d, live, departed },
  heading,
  now,
  onSelect,
}: {
  line: DepartureLine;
  heading: string;
  now: number;
  onSelect: (departure: Departure) => void;
}) {
  const where = destination(d);
  const note = details(d, live, now, departed);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${agencyClock(live.at)}, línea ${d.route[1]}, ${where.text}, ${label(live)}${departed ? ', ya pasó' : ''}`}
      onPress={() => onSelect(d)}
      style={({ pressed }) => [
        styles.departure,
        departed && styles.departed,
        pressed && styles.pressedRow,
      ]}
    >
      <Text style={styles.departureTime}>{agencyClock(live.at)}</Text>
      <View style={styles.grow}>
        {where.main !== heading && (
          <Text style={styles.departureWhere} numberOfLines={1}>
            {where.main}
          </Text>
        )}
        {note !== '' && (
          <Text style={styles.note} numberOfLines={2}>
            {note}
          </Text>
        )}
      </View>
      <StatusIcons live={live} />
    </Pressable>
  );
}

export function TransitStopHeader({
  stop,
  distanceM,
  routes,
  open,
  onPress,
}: {
  stop: Stop;
  distanceM: number;
  routes: Route[];
  open: boolean;
  onPress: () => void;
}) {
  const name = stop[2].replace(/ - #\d+$/, '');
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${name}, parada ${stop[1] || stop[0]}, a ${Math.round(distanceM)} metros`}
      onPress={onPress}
      style={[styles.stopHead, open && styles.stopHeadOpen]}
    >
      <View style={styles.grow}>
        <Text style={styles.stopTitle} numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.note}>
          #{stop[1] || stop[0]} · {Math.round(distanceM)} m
        </Text>
      </View>
      <View style={styles.stopLines}>
        {routes.slice(0, 5).map((route) => (
          <RouteBadge key={route[0]} route={route} size={22} />
        ))}
        {routes.length > 5 && <Text style={styles.note}>+{routes.length - 5}</Text>}
      </View>
      <Chevron size={18} color={theme.text} strokeWidth={2.5} />
    </Pressable>
  );
}

export function TransitStopDepartures({
  schedule,
  departures,
  snapshot,
  current,
  active,
  onSelect,
}: {
  schedule: Schedule;
  departures: Departure[];
  snapshot: LiveSnapshot | null;
  current: boolean;
  active: boolean;
  onSelect: (departure: Departure) => void;
}) {
  const now = useLiveClock(active);
  const [opened, setOpened] = useState<string[]>([]);
  const groups = useMemo(() => {
    const byLine = new Map<string, DepartureLine[]>();
    for (const departure of departures) {
      const live = mergeLiveDeparture(schedule, departure, current ? snapshot : null, now);
      const key = `${departure.route[0]}/${departure.trip[4] ?? departure.trip[3]}`;
      const lines = byLine.get(key) ?? [];
      lines.push({ departure, live, departed: current && live.at < now - 60_000 });
      byLine.set(key, lines);
    }
    return [...byLine]
      .map(([key, lines]) => {
        lines.sort((a, b) => a.live.at - b.live.at);
        const ahead = lines.filter((l) => !l.departed);
        return { key, previous: lines.filter((l) => l.departed).at(-1) ?? null, ahead };
      })
      .filter((group) => group.ahead.length > 0)
      .sort((a, b) => a.ahead[0].live.at - b.ahead[0].live.at);
  }, [departures, schedule, snapshot, current, now]);
  if (!groups.length)
    return <Text style={styles.body}>No hay salidas para abordar con este horario.</Text>;
  return (
    <View style={styles.groups}>
      {groups.map(({ key, previous, ahead }) => {
        const route = ahead[0].departure.route;
        const where = destination(ahead[0].departure);
        const open = opened.includes(key);
        const shown = [...(previous ? [previous] : []), ...(open ? ahead : ahead.slice(0, 3))];
        return (
          <View key={key} style={styles.group}>
            <View style={styles.groupHead}>
              <RouteBadge route={route} />
              <Text style={styles.groupTitle} numberOfLines={1}>
                {where.main}
              </Text>
              {where.via && (
                <Text style={styles.groupVia} numberOfLines={1}>
                  vía {where.via}
                </Text>
              )}
            </View>
            {shown.map((line) => (
              <DepartureRow
                key={`${line.departure.trip[0]}-${line.departure.serviceDate}-${line.departure.stopTime[1]}`}
                line={line}
                heading={where.main}
                now={now}
                onSelect={onSelect}
              />
            ))}
            {ahead.length > 3 && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() => setOpened(open ? opened.filter((k) => k !== key) : [...opened, key])}
                style={styles.more}
              >
                <Text style={styles.moreText}>
                  {open ? 'Ver menos' : `Ver ${ahead.length - 3} más`}
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

// Eight and a half rows: the half row says there is more to scroll inside the card.
const ROW = 52;
const SHOWN_ROWS = 8.5;
const RAIL = 34;
const BUS_SIZE = 26;

function stopNote(s: LiveDetailStop, now: number) {
  if (s.progress === 'passed') return 'Ya pasó';
  const late = s.eventKind === 'departure' ? Math.round((s.at - s.scheduledAt) / 60_000) : null;
  const main =
    s.status === 'live'
      ? `En vivo · ${relative(s.at, now)}${
          late === null
            ? ' · llegada'
            : late === 0
              ? ' · a tiempo'
              : late > 0
                ? ` · ${late} min tarde`
                : ` · ${-late} min antes`
        }`
      : label(s);
  const limits = [
    s.stopTime[4] === 1 ? 'sin recogida' : s.stopTime[4] > 1 ? 'recogida condicionada' : '',
    s.stopTime[5] === 1 ? 'sin bajada' : '',
  ].filter(Boolean);
  return [main, ...limits].join(' · ');
}

const TimelineRow = memo(function TimelineRow({
  name,
  time,
  note,
  live,
  warning,
  first,
  last,
  boarding,
  fadedAbove,
  fadedBelow,
  color,
}: {
  color: string;
  name: string;
  time: string;
  note: string;
  live: boolean;
  warning: boolean;
  first: boolean;
  last: boolean;
  boarding: boolean;
  fadedAbove: boolean;
  fadedBelow: boolean;
}) {
  return (
    <View style={styles.row} accessibilityLabel={`${name}, ${time}, ${note}`}>
      <View style={styles.rail}>
        <View
          style={[
            styles.segment,
            { backgroundColor: color },
            first && styles.hidden,
            fadedAbove && styles.faded,
          ]}
        />
        <View
          style={[
            styles.segment,
            { backgroundColor: color },
            last && styles.hidden,
            fadedBelow && styles.faded,
          ]}
        />
        <View style={[styles.dot, boarding && styles.dotBoarding]} />
      </View>
      <View style={styles.rowText}>
        <View style={styles.rowLine}>
          <Text style={[styles.stopName, boarding && styles.stopBoarding]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.stopTime, !live && styles.stopTimeFaint]}>{time}</Text>
        </View>
        <Text
          style={[styles.stopNote, live && styles.stopNoteLive, warning && styles.stopNoteWarn]}
          numberOfLines={1}
        >
          {note}
        </Text>
      </View>
    </View>
  );
});

export function TransitTripTimeline({
  schedule,
  departure,
  choices,
  snapshot,
  active,
  onSelect,
  onClose,
}: {
  schedule: Schedule;
  departure: Departure;
  choices: Departure[];
  snapshot: LiveSnapshot | null;
  active: boolean;
  onSelect: (departure: Departure) => void;
  onClose: () => void;
}) {
  const now = useLiveClock(active);
  const detail = useMemo(
    () => tripLiveDetail(schedule, departure, snapshot, now),
    [schedule, departure, snapshot, now],
  );
  const times = useMemo(
    () =>
      choices
        .map((d) => ({ d, at: mergeLiveDeparture(schedule, d, snapshot, now).at }))
        .sort((a, b) => a.at - b.at),
    [choices, schedule, snapshot, now],
  );
  const shownChoices = useMemo(() => {
    const window = [
      ...times.filter((t) => t.at < now - 60_000).slice(-1),
      ...times.filter((t) => t.at >= now - 60_000).slice(0, 5),
    ];
    const chosen = times.find((t) => sameDeparture(t.d, departure));
    return chosen && !window.includes(chosen)
      ? [...window, chosen].sort((a, b) => a.at - b.at)
      : window;
  }, [times, now, departure]);
  const boarding = detail.stops.findIndex((s) => s.stopTime[1] === departure.stopTime[1]);
  const lineColor = routeColor(departure.route[3]);
  const scroll = useRef<ScrollView>(null);
  const placedFor = useRef<string | null>(null);
  const key = `${departure.trip[0]}/${departure.serviceDate}/${departure.stopTime[1]}`;
  const bus = detail.bus;
  const busFresh = bus?.measured === true;
  const assigned = detail.update?.vehicleId ?? null;
  const busLine = bus?.vehicle
    ? `Bus ${bus.vehicle.vehicleId ?? 'LTC'} · ${measurement(bus.vehicle.measuredAt, now)}${bus.measured ? '' : ' · ubicado por las predicciones'}`
    : bus
      ? `Bus ${assigned ?? 'LTC'} · ubicado por las predicciones`
      : assigned
        ? `Bus ${assigned} asignado · todavía no empieza este viaje`
        : detail.update
          ? 'Sin bus asignado todavía'
          : 'Sin datos en vivo de este viaje';
  return (
    <View style={styles.trip}>
      <View style={styles.tripHead}>
        <RouteBadge route={departure.route} size={32} />
        <Text style={styles.headsign} numberOfLines={2}>
          {departure.stopTime[7] || departure.trip[3] || departure.route[2]}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar el viaje y ver todas las salidas"
          hitSlop={8}
          onPress={onClose}
          style={styles.close}
        >
          <X size={18} color={theme.text} strokeWidth={2.5} />
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.choices}
      >
        {shownChoices.map(({ d, at }) => (
          <Chip
            key={`${d.trip[0]}-${d.serviceDate}-${d.stopTime[1]}`}
            label={agencyClock(at)}
            accessibilityLabel={`Salida de las ${agencyClock(at)}`}
            selected={sameDeparture(d, departure)}
            onPress={() => onSelect(d)}
          />
        ))}
      </ScrollView>
      <Text style={styles.note}>{busLine}</Text>
      <View style={styles.timeline}>
        <ScrollView
          ref={scroll}
          style={{ height: ROW * SHOWN_ROWS }}
          nestedScrollEnabled
          onContentSizeChange={() => {
            if (placedFor.current === key) return;
            placedFor.current = key;
            scroll.current?.scrollTo({ y: Math.max(0, (boarding - 2) * ROW), animated: false });
          }}
        >
          <View>
            {detail.stops.map((s, index) => (
              <TimelineRow
                key={s.stopTime[1]}
                name={s.stop[2]}
                time={agencyClock(s.progress === 'passed' ? s.scheduledAt : s.at)}
                note={stopNote(s, now)}
                live={s.status === 'live' && s.progress !== 'passed'}
                warning={
                  s.progress !== 'passed' && (s.status === 'skipped' || s.status === 'canceled')
                }
                first={index === 0}
                last={index === detail.stops.length - 1}
                boarding={index === boarding}
                fadedAbove={index <= boarding}
                fadedBelow={index < boarding}
                color={lineColor}
              />
            ))}
            {bus && (
              <View
                pointerEvents="none"
                accessibilityLabel="Posición del bus"
                style={[
                  styles.bus,
                  { top: (bus.after + 0.5 + bus.fraction) * ROW - BUS_SIZE / 2 },
                  !busFresh && styles.busEstimated,
                ]}
              >
                <Bus size={14} color={theme.text} strokeWidth={2.5} />
              </View>
            )}
          </View>
        </ScrollView>
      </View>
      <Text style={styles.note}>
        El bus se dibuja donde lo reportó su GPS, sin movimiento simulado.
      </Text>
    </View>
  );
}

export function TransitAlerts({ snapshot, active }: { snapshot: LiveSnapshot; active: boolean }) {
  const now = useLiveClock(active);
  const [open, setOpen] = useState(false);
  const alerts = snapshot.alerts.filter(
    (alert) =>
      alert.activePeriods.length === 0 ||
      alert.activePeriods.some(
        (period) =>
          (period.start === null || period.start <= now) &&
          (period.end === null || period.end > now),
      ),
  );
  if (!alerts.length) return null;
  const fresh = liveFreshness(snapshot, 'alerts', snapshot.generatedAt, now);
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <View style={styles.detail}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Alertas LTC, ${alerts.length}`}
        onPress={() => setOpen(!open)}
        style={styles.alertsHead}
      >
        <TriangleAlert size={16} color={theme.text} strokeWidth={2.5} />
        <Text style={[styles.body, styles.grow]}>Alertas LTC · {alerts.length}</Text>
        <Chevron size={16} color={theme.text} strokeWidth={2.5} />
      </Pressable>
      {open && (
        <>
          <Text style={styles.note}>
            {fresh ? 'Reportes vigentes' : 'Últimas alertas guardadas · sin confirmación actual'} ·{' '}
            {measurement(fresh ? snapshot.generatedAt : snapshot.health.alerts.fetchedAt, now)}
          </Text>
          {alerts.map((alert) => (
            <View key={alert.id}>
              <Text style={styles.body}>{alert.header}</Text>
              <Text style={styles.note}>{alert.description}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const styles = sheet((theme) => ({
  stopHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 54,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
  },
  stopHeadOpen: { backgroundColor: theme.surfaceHigh },
  stopTitle: { fontFamily: font.bold, fontSize: 14, color: theme.text },
  stopLines: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  groups: { gap: 14 },
  group: { gap: 4 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 2 },
  groupTitle: { flexShrink: 1, fontFamily: font.black, fontSize: 15, color: theme.text },
  groupVia: { flexShrink: 1, fontFamily: font.regular, fontSize: 12, color: theme.textFaint },
  departure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 46,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
  },
  departed: { opacity: 0.55, borderColor: theme.lineSoft },
  pressedRow: { backgroundColor: theme.surfaceHigh },
  departureTime: { minWidth: 46, fontFamily: font.black, fontSize: 16, color: theme.text },
  departureWhere: { fontFamily: font.bold, fontSize: 13, color: theme.text },
  more: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 2 },
  moreText: {
    fontFamily: font.bold,
    fontSize: 13,
    color: theme.text,
    textDecorationLine: 'underline',
  },
  body: { fontFamily: font.bold, fontSize: 14, color: theme.text },
  note: { fontFamily: font.regular, fontSize: 12, color: theme.textFaint },
  detail: { gap: 8, borderTopWidth: 1, borderTopColor: theme.lineSoft, paddingTop: 10 },
  grow: { flex: 1 },
  alertsHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  trip: { gap: 10 },
  tripHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headsign: { flex: 1, fontFamily: font.bold, fontSize: 15, color: theme.text },
  close: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
  },
  choices: { gap: 8, paddingRight: 8 },
  timeline: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radius,
    backgroundColor: theme.surface,
    overflow: 'hidden',
  },
  row: { height: ROW, flexDirection: 'row' },
  rail: { width: RAIL, alignItems: 'center' },
  segment: { width: 8, flex: 1, backgroundColor: theme.line },
  faded: { backgroundColor: theme.lineSoft },
  hidden: { backgroundColor: 'transparent' },
  dot: {
    position: 'absolute',
    top: ROW / 2 - 3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.surface,
  },
  dotBoarding: {
    top: ROW / 2 - 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: theme.line,
  },
  rowText: {
    flex: 1,
    justifyContent: 'center',
    paddingRight: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stopName: { flex: 1, fontFamily: font.bold, fontSize: 13, color: theme.text },
  stopBoarding: { fontFamily: font.black },
  stopTime: { fontFamily: font.bold, fontSize: 13, color: theme.text },
  stopTimeFaint: { fontFamily: font.regular, color: theme.textFaint },
  stopNote: { fontFamily: font.regular, fontSize: 12, color: theme.textFaint },
  stopNoteLive: { color: theme.text },
  stopNoteWarn: { fontFamily: font.bold, color: theme.text },
  bus: {
    position: 'absolute',
    left: (RAIL - BUS_SIZE) / 2,
    width: BUS_SIZE,
    height: BUS_SIZE,
    borderRadius: BUS_SIZE / 2,
    borderWidth: shape.border,
    borderColor: theme.line,
    backgroundColor: theme.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busEstimated: { backgroundColor: theme.surface, borderColor: theme.textGhost },
}));
