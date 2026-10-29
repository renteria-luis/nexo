import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Pressable, ScrollView, Text, View } from 'react-native';

import {
  mergeLiveDeparture,
  relevantLiveAlerts,
  tripLiveDetail,
  liveFreshness,
  observedServiceTrips,
  type FollowedBus,
  type LiveDeparture,
  type LiveDetailStop,
  type LiveSnapshot,
} from '../transit/realtime.ts';
import { addDays, shortDay } from '../core/dates.ts';
import {
  agencyClock,
  activeServices,
  agencyDate,
  type Departure,
  type Route,
  type Schedule,
  type Stop,
} from '../transit/schedule.ts';
import { Chip } from './Chip.tsx';
import { Bus, ChevronDown, ChevronUp, TriangleAlert, X } from './icons.ts';
import { rideGlow, routeColor } from './routeColors.ts';
import { font, shape, sheet, theme } from './theme.ts';
import { RouteBadge, StatusIcons } from './TransitStatus.tsx';

const statusLabel: Record<string, string> = {
  live: 'En vivo LTC',
  estimated: 'Estimación con el retraso LTC',
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

const TICK_MS = 15_000;

/**
 * The time live rows are judged against. Back from another app it is read in the same event that
 * wakes the screen, so the first frame already judges the last reports by their real age: a clock
 * stopped in the background made a reading taken after the return look like it came from the
 * future, and the bus vanished until the next tick. A new reading, or the screen coming back into
 * view, reads it again right after drawing. Ticks fall on the same quarter minutes everywhere, so
 * the trip card and the map place an estimated bus at the same point.
 */
export function useLiveClock(active: boolean, data?: unknown) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(Date.now());
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!active) return;
    const read = () => setNow(Date.now());
    const soon = setTimeout(read, 0);
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      read();
      timer = setTimeout(tick, TICK_MS - (Date.now() % TICK_MS));
    };
    timer = setTimeout(tick, TICK_MS - (Date.now() % TICK_MS));
    return () => {
      clearTimeout(soon);
      clearTimeout(timer);
    };
  }, [active, data]);
  return now;
}

function measurement(at: number | null, now: number) {
  return at === null
    ? 'sin hora de medición'
    : `reporte ${agencyClock(at)} · hace ${Math.max(0, Math.floor((now - at) / 1000))} s`;
}

const sameDeparture = (a: Departure, b: Departure) =>
  a.trip[0] === b.trip[0] && a.serviceDate === b.serviceDate && a.stopTime[1] === b.stopTime[1];

export function relative(at: number, now: number) {
  const minutes = Math.round((at - now) / 60_000);
  return minutes === 0 ? 'ahora' : minutes > 0 ? `en ${minutes} min` : `hace ${-minutes} min`;
}

/** Match the displayed HH:mm; seconds must not give equal departure times different labels. */
export function leavingIn(at: number, now: number) {
  return relative(Math.floor(at / 60_000) * 60_000, Math.floor(now / 60_000) * 60_000);
}

function ago(at: number | null, now: number) {
  if (at === null) return null;
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  return seconds < 120 ? `hace ${seconds} s` : `hace ${Math.floor(seconds / 60)} min`;
}

export function destination(d: Departure) {
  const text = d.stopTime[7] || d.trip[3] || d.route[2];
  const [main, via] = text.split(/ via /i);
  return { text, main: main.trim(), via: via?.trim() ?? null };
}

/** Where the bus goes as he would say it: LTC writes "via" without its accent. */
export function spoken(d: Departure) {
  const { main, via } = destination(d);
  return via ? `${main} vía ${via}` : main;
}

export function dayOf(at: number, now: number) {
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

/** A stop's name without the stop number LTC appends to some of them. */
export function stopName(stop: Stop) {
  return stop[2].replace(/ - #\d+$/, '');
}

function DepartureRow({
  line: { departure: d, live, departed },
  heading,
  now,
  showStatus,
  onSelect,
}: {
  line: DepartureLine;
  heading: string;
  now: number;
  showStatus: boolean;
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
      {showStatus && <StatusIcons live={live} />}
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
  const name = stopName(stop);
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
  const now = useLiveClock(active, snapshot);
  const [opened, setOpened] = useState<string[]>([]);
  const groups = useMemo(() => {
    const byLine = new Map<string, DepartureLine[]>();
    const observed = new Set(
      observedServiceTrips(schedule, snapshot, now).map(
        (trip) => `${trip.tripId}/${trip.serviceDate}`,
      ),
    );
    for (const departure of departures) {
      if (
        !activeServices(schedule, departure.serviceDate).has(departure.trip[2]) &&
        !observed.has(`${departure.trip[0]}/${departure.serviceDate}`)
      )
        continue;
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
  const showStatus = current && snapshot !== null;
  return (
    <View style={styles.groups}>
      {!showStatus && <Text style={styles.note}>Horario programado · sin datos en vivo</Text>}
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
                showStatus={showStatus}
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

// Eight and a half rows: the half row says there is more to scroll inside the card. On his trip
// five and a half, so the next bus's line fits below.
const ROW = 52;
const SHOWN_ROWS = 8.5;
const TRIP_ROWS = 5.5;
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
  glow = null,
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
  /** The stretch he rides, glowing above or below the stop's dot. */
  glow?: { color: string; pulse: Animated.Value; above: boolean; below: boolean } | null;
}) {
  const shine = glow && [
    styles.glow,
    { backgroundColor: glow.color, shadowColor: glow.color, opacity: glow.pulse },
  ];
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
        >
          {glow?.above && <Animated.View style={shine} />}
        </View>
        <View
          style={[
            styles.segment,
            { backgroundColor: color },
            last && styles.hidden,
            fadedBelow && styles.faded,
          ]}
        >
          {glow?.below && <Animated.View style={shine} />}
        </View>
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

/** What the card says about the followed bus, from the evidence that placed it. */
function busText(detail: ReturnType<typeof tripLiveDetail>, now: number) {
  const { bus, update, phase } = detail;
  const assigned = update?.vehicleId ?? null;
  const name = `Bus ${bus?.vehicle?.vehicleId ?? assigned ?? 'LTC'}`;
  const gps = (at: number | null) =>
    at === null ? 'GPS sin hora' : `GPS ${agencyClock(at)} · ${ago(at, now)}`;
  if (bus?.why === 'other-trip')
    return `${name} asignado · todavía hace su viaje anterior · ${gps(bus.vehicle!.measuredAt)}`;
  if (bus?.why === 'off-trip')
    return `${name} · su GPS está fuera del recorrido, quizá por un desvío · ${gps(bus.vehicle!.measuredAt)}`;
  if (bus?.why === 'disagrees')
    return `${name} · su GPS no coincide con las predicciones de LTC · ${gps(bus.vehicle!.measuredAt)}`;
  if (bus?.placedBy === 'gps') return `${name} · ${gps(bus.vehicle!.measuredAt)}`;
  if (bus?.placedBy === 'last-gps')
    return `${name} · último ${gps(bus.vehicle!.measuredAt)} · sin reporte reciente`;
  if (bus)
    return `${name} · posición estimada con las predicciones de LTC · ${
      bus.vehicle ? `último ${gps(bus.vehicle.measuredAt)}` : 'sin GPS'
    }`;
  if (assigned && phase === 'not-started')
    return `Bus ${assigned} asignado · todavía no empieza este viaje`;
  if (phase === 'ended') return 'LTC ya no predice paradas de este viaje';
  if (assigned) return `Bus ${assigned} asignado · sin ubicación reciente`;
  return update ? 'Sin bus asignado todavía' : 'Sin datos en vivo de este viaje';
}

const busNote: Record<FollowedBus['placedBy'], string> = {
  gps: 'El bus está donde lo reportó su GPS; no se mueve entre reportes.',
  'last-gps': 'Es el último GPS recibido: el bus ya avanzó desde entonces.',
  estimate:
    'Sin GPS reciente: avanza con la hora que LTC predice para la siguiente parada y ahí espera. Es una estimación, no un GPS.',
};

export function TransitTripTimeline({
  schedule,
  departure,
  choices,
  snapshot,
  active,
  alighting = null,
  onSelect,
  onClose,
  onFocusBus,
}: {
  schedule: Schedule;
  departure: Departure;
  choices: Departure[];
  snapshot: LiveSnapshot | null;
  active: boolean;
  /** On his trip, where he gets off: the stretch from `departure` to it glows and pulses. */
  alighting?: Departure | null;
  onSelect: (departure: Departure) => void;
  onClose: () => void;
  /** Shows this trip's bus on the map; tapping the bus on the line asks for it. */
  onFocusBus?: (departure: Departure) => void;
}) {
  const now = useLiveClock(active, snapshot);
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
  const alight = alighting
    ? detail.stops.findIndex((s) => s.stopTime[1] === alighting.stopTime[1])
    : -1;
  const riding = boarding >= 0 && alight > boarding;
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!riding) return;
    const beat = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    beat.start();
    return () => beat.stop();
  }, [riding, pulse]);
  const lineColor = routeColor(departure.route[3]);
  const glowColor = rideGlow(departure.route[3]);
  const stopCount = detail.stops.length;
  // Kept between ticks so the rows of his stretch do not redraw every second.
  const glows = useMemo(
    () =>
      Array.from({ length: stopCount }, (_, index) =>
        riding && index >= boarding && index <= alight
          ? { color: glowColor, pulse, above: index > boarding, below: index < alight }
          : null,
      ),
    [stopCount, riding, boarding, alight, glowColor, pulse],
  );
  const scroll = useRef<ScrollView>(null);
  const placedFor = useRef<string | null>(null);
  const key = `${departure.trip[0]}/${departure.serviceDate}/${departure.stopTime[1]}`;
  const bus = detail.bus;
  const along = bus?.along ?? null;
  const busLine = busText(detail, now);
  const focus = bus && onFocusBus ? () => onFocusBus(departure) : undefined;
  return (
    <View style={styles.trip}>
      <View style={styles.tripHead}>
        <RouteBadge route={departure.route} size={32} />
        <Text style={styles.headsign} numberOfLines={2}>
          {spoken(departure)}
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
      {/* On his trip there is no other departure to switch to. */}
      {!alighting && (
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
      )}
      {focus ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${busLine}. Ver en el mapa`}
          onPress={focus}
          style={styles.busLine}
        >
          <Text style={[styles.note, styles.link]}>{busLine} · ver en el mapa</Text>
        </Pressable>
      ) : (
        <Text style={styles.note}>{busLine}</Text>
      )}
      <View style={styles.timeline}>
        <ScrollView
          ref={scroll}
          style={{ height: ROW * (alighting ? TRIP_ROWS : SHOWN_ROWS) }}
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
                note={
                  riding && index === boarding
                    ? `Aquí subes · ${stopNote(s, now)}`
                    : riding && index === alight
                      ? `Aquí bajas · ${stopNote(s, now)}`
                      : stopNote(s, now)
                }
                live={s.status === 'live' && s.progress !== 'passed'}
                warning={
                  s.progress !== 'passed' && (s.status === 'skipped' || s.status === 'canceled')
                }
                first={index === 0}
                last={index === detail.stops.length - 1}
                boarding={index === boarding || (riding && index === alight)}
                fadedAbove={index <= boarding}
                fadedBelow={index < boarding}
                color={lineColor}
                glow={glows[index]}
              />
            ))}
            {bus && along && (
              <Pressable
                accessibilityRole={focus ? 'button' : undefined}
                accessibilityLabel={focus ? 'Posición del bus. Ver en el mapa' : 'Posición del bus'}
                disabled={!focus}
                onPress={focus}
                // The icon is small; the touch area is not.
                hitSlop={12}
                style={[
                  styles.bus,
                  { top: (along.after + 0.5 + along.fraction) * ROW - BUS_SIZE / 2 },
                  bus.placedBy === 'last-gps' && styles.busLast,
                  bus.placedBy === 'estimate' && styles.busEstimated,
                ]}
              >
                <Bus
                  size={14}
                  color={bus.placedBy === 'gps' ? theme.accentInk : theme.textFaint}
                  strokeWidth={2.5}
                />
              </Pressable>
            )}
          </View>
        </ScrollView>
      </View>
      {bus && along && <Text style={styles.note}>{busNote[bus.placedBy]}</Text>}
    </View>
  );
}

export function TransitAlerts({
  schedule,
  snapshot,
  targets,
  active,
  scope,
}: {
  schedule: Schedule;
  snapshot: LiveSnapshot;
  targets: { departure: Departure; stopIds: readonly string[] }[];
  active: boolean;
  scope?: string;
}) {
  const now = useLiveClock(active, snapshot);
  const [open, setOpen] = useState(false);
  const alerts = [
    ...new Map(
      targets.flatMap(({ departure, stopIds }) =>
        relevantLiveAlerts(schedule, departure, snapshot, now, stopIds).map(
          (alert) => [alert.id, alert] as const,
        ),
      ),
    ).values(),
  ];
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
        <Text style={[styles.body, styles.grow]}>
          Alertas LTC · {scope ? `${scope} · ` : ''}
          {alerts.length}
        </Text>
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
  more: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  moreText: {
    fontFamily: font.bold,
    fontSize: 13,
    color: theme.text,
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
  // Wider than the line, with a halo of its own colour, so it reads as lit.
  glow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: -3,
    right: -3,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  dot: {
    position: 'absolute',
    top: ROW / 2 - 3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.surfaceSolid,
  },
  dotBoarding: {
    top: ROW / 2 - 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: theme.text,
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
  // Filled for a current GPS report, hollow for the last one, dashed for an estimate: told apart
  // by shape, not only by colour.
  busLast: { backgroundColor: theme.surfaceSolid, borderColor: theme.textDim },
  busEstimated: {
    backgroundColor: theme.surfaceSolid,
    borderColor: theme.textDim,
    borderStyle: 'dashed',
  },
  busLine: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  link: { color: theme.text, textDecorationLine: 'underline' },
}));
