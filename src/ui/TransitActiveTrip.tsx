import { useMemo, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { useTransitJourney } from '../shell/TransitJourney.tsx';
import type { GpsStatus } from '../shell/trip-tracker.ts';
import { headingTo } from '../core/geo.ts';
import {
  departureOf,
  isActive,
  rideStopAt,
  stopLabel,
  walkAhead,
  type ActiveTrip,
  type TripAction,
  type TripLive,
  type TripRide,
} from '../transit/active-trip.ts';
import { agencyClock } from '../transit/schedule.ts';
import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { relative, TransitTripTimeline } from './TransitDepartures.tsx';
import { RouteBadge } from './TransitStatus.tsx';
import { TransitTripMap } from './TransitTripMap.tsx';
import { font, sheet } from './theme.ts';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const routeOf = (ride: TripRide) => [ride.routeId, ride.route, ride.headsign, ride.color] as const;

const BOARDED = {
  manual: 'Confirmado por ti.',
  matched: 'Confirmado: tu GPS va junto al del bus.',
  inferred: 'Parece que vas en el bus, por tu GPS. Corrígelo si no.',
};
const GPS: Record<GpsStatus, string> = {
  background: 'GPS del viaje activo, también con la pantalla bloqueada (barra azul de iOS).',
  foreground: 'GPS solo con Nexo abierto; con la pantalla bloqueada no avanza.',
  denied: 'Sin permiso de ubicación: avanza el viaje con los botones.',
  unavailable: 'La ubicación del iPhone está apagada o falló: avanza con los botones.',
  off: 'GPS en pausa; vuelve al seguir el viaje con Nexo abierto.',
};

/** What to do now and what it rests on, in his words. */
export function tripLines(
  trip: ActiveTrip,
  live: TripLive | null,
  now: number,
): { title: string; lines: string[]; ride: TripRide | null } {
  const ride = trip.rides[trip.leg] ?? null;
  const walk = trip.walks[Math.min(trip.leg, trip.walks.length - 1)];
  // From his last reading, so it shrinks as he walks.
  const ahead = walkAhead(trip);
  const left = ahead
    ? [
        `Te faltan ${ahead.metres} m en línea recta hacia el ${headingTo(trip.lastFix!, walk.to)}, unos ${ahead.minutes} min.`,
      ]
    : [];
  const when = (index: number) => {
    const at = rideStopAt(trip, ride!, index, live, now);
    return `${agencyClock(at.at)} (${at.live ? 'en vivo' : 'horario'}, ${relative(at.at, now)})`;
  };
  switch (trip.phase) {
    case 'walking':
    case 'transferring':
      if (!ride)
        return {
          title: `Camina a ${trip.destination.name}`,
          lines: [`Unos ${walk.minutes} min a pie.`, ...left],
          ride: null,
        };
      return {
        title: `${trip.phase === 'walking' ? 'Camina' : 'Transbordo: camina'} a ${stopLabel(ride.stops[0])}`,
        lines: [
          `El ${ride.route} sale a las ${when(0)}.`,
          ...(walk.minutes ? [`Caminata de unos ${walk.minutes} min.`] : []),
          ...left,
        ],
        ride,
      };
    case 'waiting':
      return {
        title: `Espera el ${ride!.route} en ${stopLabel(ride!.stops[0])}`,
        lines: [`Sale a las ${when(0)}.`],
        ride,
      };
    case 'riding': {
      const last = ride!.stops.length - 1;
      const progress = trip.progress.at;
      const left =
        progress === null
          ? ride!.stops.filter((_, i) => i > 0 && rideStopAt(trip, ride!, i, live, now).at > now)
              .length
          : ride!.along.filter((at, i) => i > 0 && at > progress + 20).length;
      return {
        title: `En el ${ride!.route} hacia ${ride!.headsign}`,
        lines: [
          `Bajas en ${stopLabel(ride!.stops[last])} a las ${when(last)}.`,
          `${left === 1 ? 'Es la próxima parada' : `Quedan ${left} paradas`}.`,
          BOARDED[trip.boarded[trip.leg] ?? 'manual'],
        ],
        ride,
      };
    }
    case 'final':
      return {
        title: `Camina a ${trip.destination.name}`,
        lines: [
          `Unos ${walk.minutes} min a pie; llegada prevista ${agencyClock(trip.plannedArriveAt)}.`,
          ...left,
        ],
        ride: null,
      };
    default: {
      const minutes = Math.round(((trip.endedAt ?? now) - trip.startedAt) / 60_000);
      const { fixes, ignored, liveReads, liveBytes } = trip.stats;
      return {
        title:
          trip.phase === 'completed'
            ? `Llegaste a ${trip.destination.name}`
            : trip.phase === 'canceled'
              ? 'Viaje cancelado'
              : 'Viaje terminado por tiempo',
        lines: [
          `${minutes} min desde que saliste${trip.endedAt ? `, hasta las ${agencyClock(trip.endedAt)}` : ''}.`,
          `${fixes} lecturas de GPS${ignored ? ` (${ignored} imprecisas)` : ''} · ${liveReads} consultas en vivo con Nexo en segundo plano (${Math.round(liveBytes / 1_024)} KB).`,
          'Las caminatas medidas esperan tu revisión en Transit.',
        ],
        ride: null,
      };
    }
  }
}

/**
 * A bus's whole route as Paradas shows it, its line lit from where he boards to where he gets
 * off; a list of his stops when the saved schedule no longer has his bus.
 */
function TripStops({
  trip,
  ride,
  live,
  now,
  onClose,
  onFocusBus,
}: {
  trip: ActiveTrip;
  ride: TripRide;
  live: TripLive | null;
  now: number;
  onClose: () => void;
  onFocusBus?: () => void;
}) {
  const schedule = live?.schedule;
  const ends = useMemo(() => {
    if (!schedule) return null;
    const board = departureOf(trip, ride, 0, schedule);
    const alight = departureOf(trip, ride, ride.stops.length - 1, schedule);
    return board && alight ? { board, alight, choices: [board] } : null;
  }, [trip, ride, schedule]);
  if (schedule && ends)
    return (
      <TransitTripTimeline
        schedule={schedule}
        departure={ends.board}
        choices={ends.choices}
        alighting={ends.alight}
        snapshot={live.snapshot}
        active
        onSelect={() => undefined}
        onClose={onClose}
        onFocusBus={onFocusBus}
      />
    );
  return ride.stops.map((stop, index) => (
    <Text key={`${stop.id}:${stop.position}`} style={styles.note}>
      {index + 1}. {stopLabel(stop)} · {agencyClock(rideStopAt(trip, ride, index, live, now).at)}
      {index === ride.stops.length - 1 ? ' · Aquí bajas' : ''}
    </Text>
  ));
}

export function TransitActiveTrip({
  map = false,
  onMapInteraction,
}: {
  /** Draw the trip on its own map, where there is room for one. */
  map?: boolean;
  onMapInteraction?: (active: boolean) => void;
} = {}) {
  const { trip, gps, tripProblem, tripLive, now, places, actions } = useTransitJourney();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [showStops, setShowStops] = useState(false);
  const [busFocus, setBusFocus] = useState<number | null>(null);
  if (!trip) return null;
  const active = isActive(trip);
  const { title, lines, ride } = tripLines(trip, tripLive, now);
  const act = (work: () => Promise<void>) => {
    setBusy(true);
    work()
      .then(() => setProblem(null))
      .catch((error) => setProblem(message(error)))
      .finally(() => setBusy(false));
  };
  const tap = (action: TripAction) => act(() => actions.tripAction(action));
  const phase = trip.phase;
  const ahead = trip.leg < trip.rides.length;
  const doubt = trip.boarding.doubt;
  const fix = trip.lastFix;
  const others = trip.alternatives?.leg === trip.leg ? trip.alternatives.options : [];
  return (
    <Card title={active ? 'Viaje en curso' : 'Último viaje'}>
      <Text style={styles.label}>
        {trip.origin.name} → {trip.destination.name}
      </Text>
      <View style={styles.row}>
        {ride && <RouteBadge route={[...routeOf(ride)]} />}
        <Text style={styles.value}>{title}</Text>
      </View>
      {lines.map((line) => (
        <Text key={line} style={styles.note}>
          {line}
        </Text>
      ))}
      {active && doubt && ride && (
        <Text style={styles.warn}>
          {doubt === 'early'
            ? `Te mueves por la ruta del ${ride.route} antes de que pase tu bus. Si subiste a uno, toca «Ya subí».`
            : `Te mueves por la ruta del ${ride.route}, pero tu bus está lejos de ti. Si subiste a uno, toca «Ya subí».`}
        </Text>
      )}
      {active && others.length > 0 && (
        <>
          <Text style={styles.label}>También te dejan igual o antes</Text>
          {others.map((other) => {
            const board = rideStopAt(trip, other.ride, 0, tripLive, now);
            return (
              <View key={`${other.ride.tripId}/${other.ride.serviceDate}`} style={styles.row}>
                <RouteBadge route={[...routeOf(other.ride)]} />
                <Text style={[styles.note, styles.grow]}>
                  Sale {agencyClock(board.at)} ({board.live ? 'en vivo' : 'horario'}) de{' '}
                  {stopLabel(other.ride.stops[0])} · llegas {agencyClock(other.arriveAt)}
                </Text>
                <Button
                  label={`Tomar el ${other.ride.route}`}
                  variant="ghost"
                  disabled={busy}
                  onPress={() => act(() => actions.takeAlternative(other.ride.tripId))}
                />
              </View>
            );
          })}
          <Text style={styles.note}>Si subes a uno, el GPS lo nota y sigue ese.</Text>
        </>
      )}
      {active && map && (
        <TransitTripMap
          trip={trip}
          live={tripLive}
          now={now}
          places={places}
          focusKey={busFocus}
          onInteraction={onMapInteraction}
        />
      )}
      {active && (
        <Text style={styles.note}>
          {GPS[gps]}
          {fix
            ? ` Última lectura ${relative(fix.at, now)}${fix.accuracy === null ? '' : ` · ±${Math.round(fix.accuracy)} m`}.`
            : ''}
        </Text>
      )}
      {active && ride && (
        <>
          <Button
            label={showStops ? 'Ocultar paradas del viaje' : 'Ver paradas del viaje'}
            variant="ghost"
            onPress={() => setShowStops(!showStops)}
          />
          {showStops &&
            trip.rides.slice(trip.leg).map((next, k) => (
              <TripStops
                key={`${next.tripId}/${next.serviceDate}`}
                trip={trip}
                ride={next}
                live={tripLive}
                now={now}
                onClose={() => setShowStops(false)}
                // The map follows only the bus he is on or waits for.
                onFocusBus={map && k === 0 ? () => setBusFocus(Date.now()) : undefined}
              />
            ))}
        </>
      )}
      {active && ahead && tripLive?.snapshot == null && (
        <Text style={styles.note}>
          Sin datos en vivo: horas del horario y tu GPS, sin cambios nuevos de LTC.
        </Text>
      )}
      {(problem ?? tripProblem) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {problem ?? tripProblem}
        </Text>
      )}
      <View style={styles.row}>
        {active && ahead && ['walking', 'waiting', 'transferring'].includes(phase) && (
          <Button
            label="Ya subí"
            variant="primary"
            disabled={busy}
            onPress={() => tap('boarded')}
          />
        )}
        {active && phase === 'riding' && (
          <>
            <Button
              label="Ya bajé"
              variant="primary"
              disabled={busy}
              onPress={() => tap('alighted')}
            />
            <Button
              label="No voy en este bus"
              variant="ghost"
              disabled={busy}
              onPress={() => tap('not-boarded')}
            />
          </>
        )}
        {active && (phase === 'final' || (phase === 'walking' && !trip.rides.length)) && (
          <Button label="Llegué" variant="primary" disabled={busy} onPress={() => tap('arrived')} />
        )}
        {active &&
          (phase === 'transferring' ||
            phase === 'final' ||
            (phase === 'waiting' && trip.leg > 0)) && (
            <Button
              label="Sigo en el bus"
              variant="ghost"
              disabled={busy}
              onPress={() => tap('still-riding')}
            />
          )}
      </View>
      <View style={styles.row}>
        {active ? (
          <>
            <Button
              label="Terminar viaje"
              variant="ghost"
              disabled={busy}
              onPress={() => tap('finish')}
            />
            <Button
              label="Cancelar viaje"
              variant="ghost"
              disabled={busy}
              onPress={() => tap('cancel')}
            />
          </>
        ) : (
          <Button label="Cerrar" disabled={busy} onPress={() => act(actions.dismissTrip)} />
        )}
        {active && gps === 'denied' && (
          <Button
            label="Abrir ajustes del iPhone"
            variant="ghost"
            onPress={() => act(() => Linking.openSettings())}
          />
        )}
      </View>
    </Card>
  );
}

const styles = sheet((theme) => ({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  value: { fontFamily: font.black, fontSize: 18, color: theme.text, flexShrink: 1 },
  label: { fontFamily: font.bold, fontSize: 14, color: theme.text },
  note: { fontFamily: font.regular, fontSize: 12, color: theme.textDim, lineHeight: 18 },
  warn: { fontFamily: font.bold, fontSize: 13, color: theme.text, lineHeight: 18 },
  grow: { flex: 1, minWidth: 160 },
  error: { fontFamily: font.bold, fontSize: 13, color: theme.danger, lineHeight: 18 },
}));
