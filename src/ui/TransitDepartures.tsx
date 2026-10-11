import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import {
  mergeLiveDeparture,
  tripLiveDetail,
  liveFreshness,
  type LiveDeparture,
  type LiveSnapshot,
} from '../transit/realtime.ts';
import { agencyClock, type Departure, type Schedule } from '../transit/schedule.ts';
import { Button } from './Button.tsx';
import { font, sheet } from './theme.ts';

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

export function TransitDepartures({
  schedule,
  departures,
  snapshot,
  selected,
  current,
  active,
  onSelect,
}: {
  schedule: Schedule;
  departures: Departure[];
  snapshot: LiveSnapshot | null;
  selected: Departure | null;
  current: boolean;
  active: boolean;
  onSelect: (departure: Departure | null) => void;
}) {
  const now = useLiveClock(active);
  const shown = departures
    .map((departure) => ({
      departure,
      live: mergeLiveDeparture(schedule, departure, current ? snapshot : null, now),
    }))
    .filter(({ live }) => !current || live.at >= now - 60_000)
    .sort((a, b) => a.live.at - b.live.at)
    .slice(0, 20);
  return (
    <View style={styles.list}>
      {shown.map(({ departure: d, live }) => {
        const chosen =
          selected?.trip[0] === d.trip[0] &&
          selected.serviceDate === d.serviceDate &&
          selected.stopTime[1] === d.stopTime[1];
        const destination = d.stopTime[7] || d.trip[3] || d.route[2];
        return (
          <View key={`${d.trip[0]}-${d.serviceDate}-${d.stopTime[1]}`}>
            <Button
              label={`${agencyClock(live.at)} · ${d.route[1]} → ${destination} · ${label(live)}${live.eventKind === 'arrival' ? ' · llegada' : ''}`}
              variant={chosen ? 'primary' : 'ghost'}
              onPress={() => onSelect(chosen ? null : d)}
            />
            {live.reportedAt !== null && (
              <Text style={styles.note}>
                Horario {agencyClock(d.at)} · {measurement(live.reportedAt, now)}
                {live.uncertainty !== null && live.uncertainty > 0
                  ? ` · incertidumbre ${live.uncertainty} s`
                  : ''}
              </Text>
            )}
            {current && live.status === 'live' && (
              <Text style={styles.note}>
                {Math.max(0, Math.ceil((live.at - now) / 60_000))} min según LTC
              </Text>
            )}
            {d.stopTime[4] > 1 && <Text style={styles.note}>Recogida condicionada</Text>}
          </View>
        );
      })}
      {!shown.length && (
        <Text style={styles.body}>No hay salidas para abordar con este horario.</Text>
      )}
    </View>
  );
}

export function TransitTripDetail({
  schedule,
  departure,
  snapshot,
  active,
}: {
  schedule: Schedule;
  departure: Departure;
  snapshot: LiveSnapshot | null;
  active: boolean;
}) {
  const now = useLiveClock(active);
  const detail = tripLiveDetail(schedule, departure, snapshot, now);
  return (
    <View style={styles.detail}>
      <Text style={styles.body}>
        Línea {departure.route[1]} · {departure.trip[3]} · servicio {departure.serviceDate}
      </Text>
      {detail.vehicles.map((vehicle) => (
        <Text key={vehicle.entityId} style={styles.note}>
          Bus {vehicle.vehicleId ?? 'sin número'} · {measurement(vehicle.measuredAt, now)}
        </Text>
      ))}
      <Text style={styles.note}>
        El avance corresponde al reporte del bus, sin movimiento simulado.
      </Text>
      {detail.stops.map((s) => (
        <Text
          key={s.stopTime[1]}
          style={[styles.note, s.stopTime[1] === departure.stopTime[1] && styles.current]}
        >
          {agencyClock(s.at)} · {s.stop[2]} · {label(s)}
          {s.eventKind === 'arrival' ? ' · llegada' : ''}
          {s.progress === 'previous'
            ? ' · anterior'
            : s.progress === 'current'
              ? ' · parada reportada'
              : s.progress === 'upcoming'
                ? ' · próxima'
                : ''}
          {s.stopTime[4] === 1
            ? ' · sin recogida'
            : s.stopTime[4] > 1
              ? ' · recogida condicionada'
              : ''}
          {s.stopTime[5] === 1 ? ' · sin bajada' : ''}
        </Text>
      ))}
    </View>
  );
}

export function TransitAlerts({ snapshot, active }: { snapshot: LiveSnapshot; active: boolean }) {
  const now = useLiveClock(active);
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
  return (
    <View style={styles.detail}>
      <Text style={styles.body}>Alertas LTC</Text>
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
    </View>
  );
}

const styles = sheet((theme) => ({
  list: { gap: 8 },
  body: { fontFamily: font.bold, fontSize: 14, color: theme.text },
  note: { fontFamily: font.regular, fontSize: 12, color: theme.textFaint },
  detail: { gap: 8, borderTopWidth: 1, borderTopColor: theme.lineSoft, paddingTop: 10 },
  current: { fontFamily: font.black, color: theme.text },
}));
