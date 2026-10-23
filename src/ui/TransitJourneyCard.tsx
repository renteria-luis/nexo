import { useIsFocused, useNavigation } from '@react-navigation/native';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { shortDay } from '../core/dates.ts';
import { useTransitJourney } from '../shell/TransitJourney.tsx';
import { transitHere } from '../shell/transit.ts';
import {
  agencyClock,
  agencyDate,
  scheduledTime,
  type Departure,
  type Schedule,
} from '../transit/schedule.ts';
import { isActive } from '../transit/active-trip.ts';
import type { LiveSnapshot } from '../transit/realtime.ts';
import { nearestPlace } from '../transit/store.ts';
import { TRANSIT_ENABLED } from '../transit/index.ts';
import type { TravelPreferences } from '../transit/journey.ts';
import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { Combobox } from './Combobox.tsx';
import { NumericField } from './NumericField.tsx';
import { placeOptions } from './placeIcons.ts';
import { goTo, type Navigate } from './navigation.ts';
import { Toggle } from './Toggle.tsx';
import { TransitActiveTrip } from './TransitActiveTrip.tsx';
import { TransitAlerts } from './TransitDepartures.tsx';
import { RouteBadge } from './TransitStatus.tsx';
import { font, sheet } from './theme.ts';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const evidence = {
  none: 'Sin estimación del entreno.',
  initial: 'Estimación inicial según el plan; aún sin tiempos aprendidos.',
  mixed: 'Combina tus tiempos con el plan donde falta historial.',
  limited: 'Pocos entrenos medidos; la hora puede cambiar.',
  learned: 'Según tus tiempos y las series pendientes.',
  complete: 'Entreno completado.',
};

export function TransitJourneyAlerts({
  schedule,
  snapshot,
  active,
  departures,
}: {
  schedule: Schedule;
  snapshot: LiveSnapshot;
  active: boolean;
  departures: Departure[];
}) {
  const { trip, advice, result } = useTransitJourney();
  const targets = useMemo(() => {
    if (trip) {
      if (!isActive(trip) || trip.sourceSha256 !== schedule.sourceSha256) return [];
      return trip.rides.slice(trip.leg).flatMap((ride) => {
        const bus = schedule.trips.find((candidate) => candidate[0] === ride.tripId);
        if (!bus) return [];
        const stopTime = schedule.patterns[bus[6]][ride.stops[0].position];
        return [
          {
            departure: {
              trip: bus,
              route: schedule.routes[bus[1]],
              serviceDate: ride.serviceDate,
              stopTime,
              at: scheduledTime(ride.serviceDate, bus[7] + stopTime[3]),
            },
            stopIds: ride.stops.map((stop) => stop.id),
          },
        ];
      });
    }
    if (advice) {
      if (result?.context.index.schedule.sourceSha256 !== schedule.sourceSha256) return [];
      return advice.option.itinerary.rides.map((ride) => ({
        departure: ride.departure,
        stopIds: schedule.patterns[ride.trip[6]]
          .slice(ride.board, ride.alight + 1)
          .map((time) => schedule.stops[time[0]][0]),
      }));
    }
    return departures.map((departure) => ({
      departure,
      stopIds: [schedule.stops[departure.stopTime[0]][0]],
    }));
  }, [trip, advice, result, schedule, departures]);
  return (
    <TransitAlerts
      schedule={schedule}
      snapshot={snapshot}
      active={active}
      targets={targets}
      scope={trip || advice ? 'tu viaje' : 'esta parada'}
    />
  );
}

export function TransitTravelSettings() {
  const { saved, actions, busy } = useTransitJourney();
  const preferences = saved.preferences;
  const [draft, setDraft] = useState<{ base: number; value: string } | null>(null);
  const minutes =
    draft?.base === preferences.preparationMinutes
      ? draft.value
      : String(preferences.preparationMinutes);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (next: TravelPreferences) => {
    try {
      await actions.preferences(next);
      setProblem(null);
    } catch (error) {
      setProblem(message(error));
    }
  };
  return (
    <Card title="Avisos de Transit">
      <Text style={styles.note}>
        Solo para el viaje en que actives «Avisarme». Prepararte a la hora límite de terminar; salir
        a la hora indicada.
      </Text>
      <Text style={styles.label}>Preparación antes de caminar (min)</Text>
      <Text style={styles.note}>
        No repitas aquí la salida del edificio si ya la incluiste en tus minutos de caminata.
      </Text>
      <View style={styles.row}>
        <NumericField
          value={minutes}
          onChange={(value) => setDraft({ base: preferences.preparationMinutes, value })}
          accessibilityLabel="Minutos de preparación"
          style={styles.minutes}
        />
        <Button
          label="Guardar preparación"
          disabled={busy}
          onPress={() => void save({ ...preferences, preparationMinutes: Number(minutes) })}
        />
      </View>
      {(
        [
          ['prepare', 'Aviso de prepararme'],
          ['leave', 'Aviso de salir'],
          ['sound', 'Sonido normal'],
          ['quiet', 'Respetar silencio 21:30–07:30'],
        ] as const
      ).map(([key, label]) => (
        <View style={styles.setting} key={key}>
          <Text style={styles.label}>{label}</Text>
          <Toggle
            value={preferences[key]}
            accessibilityLabel={label}
            disabled={busy}
            onChange={(value) => void save({ ...preferences, [key]: value })}
          />
        </View>
      ))}
      <Text style={styles.note}>
        Los viajes tienen sus propios avisos: no gastan los 3 de salud ni se apagan por ignorarlos.
        El silencio nocturno está apagado de entrada. El sonido respeta los ajustes y el modo
        Concentración del iPhone.
      </Text>
      {problem && (
        <Text accessibilityRole="alert" style={styles.error}>
          {problem}
        </Text>
      )}
    </Card>
  );
}

export function TransitJourneyCard({
  surface,
  onMapInteraction,
}: {
  surface: 'today' | 'training' | 'transit';
  onMapInteraction?: (active: boolean) => void;
}) {
  const journey = useTransitJourney();
  const { saved, places, workout, sessionId, gymId, advice, alternative, loading, busy, actions } =
    journey;
  const focused = useIsFocused();
  const navigation = useNavigation<{ navigate: (...args: Navigate) => void }>();
  const trip = saved.next;
  const gym = places.find((place) => place.gym_id && place.gym_id === gymId);
  const [editing, setEditing] = useState(false);
  const [originId, setOriginId] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [settings, setSettings] = useState(false);
  // Fuera de Transit el viaje acompana a otra cosa, asi que abre en lo justo: cuando
  // salir, el bus y Salgo ahora. Lo demas queda a un toque (2026-10-23).
  const [details, setDetails] = useState(surface === 'transit');
  const locationToken = useRef(0);
  const retireLocation = useCallback(() => {
    locationToken.current++;
  }, []);
  const options = useMemo(() => placeOptions(places), [places]);
  const from = originId ?? (surface === 'training' ? gym?.id : undefined) ?? trip?.originId ?? null;
  const to = destinationId ?? trip?.destinationId ?? null;
  useEffect(() => {
    actions.visible(surface, focused);
    if (focused) void actions.refresh();
    return () => {
      actions.visible(surface, false);
      retireLocation();
    };
  }, [actions, surface, focused, retireLocation]);
  const act = async (work: () => Promise<void>) => {
    try {
      await work();
      setProblem(null);
    } catch (error) {
      setProblem(message(error));
    }
  };
  const detect = async () => {
    const token = ++locationToken.current;
    setDetecting(true);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const point = await Promise.race([
        transitHere(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('La ubicación tardó demasiado. Elige el origen a mano.')),
            20_000,
          );
        }),
      ]);
      if (token !== locationToken.current) return;
      if (!point) throw new Error('Sin una ubicación precisa. Puedes elegir el origen a mano.');
      const place = nearestPlace(places, point, 200);
      if (place) {
        setOriginId(place.id);
        setEditing(true);
        setProblem(null);
      } else {
        setProblem('No estás cerca de un lugar guardado. Elige el origen a mano.');
      }
    } catch (error) {
      if (token === locationToken.current) setProblem(message(error));
    } finally {
      clearTimeout(timeout);
      if (token === locationToken.current) setDetecting(false);
    }
  };
  if (!TRANSIT_ENABLED) return null;
  if (journey.trip)
    return <TransitActiveTrip map={surface === 'transit'} onMapInteraction={onMapInteraction} />;
  // Transit plans in Cómo llegar; this card shows only a trip already chosen.
  if (surface === 'transit' && !trip) return null;
  const selecting = editing || !trip || (surface === 'training' && trip.workoutId !== sessionId);
  const linkedWorkout = workout && trip?.workoutId === workout.sessionId ? workout : null;
  const originName = places.find((place) => place.id === trip?.originId)?.name;
  const targetName = places.find((place) => place.id === trip?.destinationId)?.name;
  return (
    <>
      <Card
        title={
          surface === 'training'
            ? 'Viaje al terminar'
            : surface === 'transit'
              ? 'Tu viaje'
              : 'Próximo viaje'
        }
      >
        {selecting ? (
          <>
            <Combobox
              options={options}
              value={from}
              onChange={(id) => {
                locationToken.current++;
                setDetecting(false);
                setOriginId(id);
              }}
              accessibilityLabel="Origen del próximo viaje"
              placeholder="De dónde sales"
            />
            {surface === 'today' && (
              <Button
                label="Detectar"
                loading={detecting}
                disabled={detecting}
                variant="ghost"
                onPress={() => void detect()}
              />
            )}
            <Combobox
              options={options}
              value={to}
              onChange={setDestinationId}
              accessibilityLabel="Destino del próximo viaje"
              placeholder="A dónde vas"
            />
            <Button
              label={surface === 'training' ? 'Ver bus al terminar' : 'Ver próximo viaje'}
              disabled={busy || !from || !to || from === to}
              onPress={() =>
                void act(async () => {
                  retireLocation();
                  setDetecting(false);
                  await actions.choose({
                    originId: from!,
                    destinationId: to!,
                    workoutId: surface === 'training' ? sessionId : null,
                  });
                  setEditing(false);
                })
              }
            />
            {trip && editing && (
              <Button label="Conservar viaje" variant="ghost" onPress={() => setEditing(false)} />
            )}
          </>
        ) : (
          <>
            <Text style={styles.label}>
              {originName} → {targetName}
            </Text>
            {advice && agencyDate(advice.leaveAt) !== agencyDate(journey.now) && (
              <Text style={styles.label}>{shortDay(agencyDate(advice.leaveAt))}</Text>
            )}
            {trip.mode === 'arrive' && (
              <Text style={styles.note}>
                Llegar antes de {agencyClock(trip.at)} · margen de llegada 3 min.
              </Text>
            )}
            {linkedWorkout && (
              <>
                <Text style={styles.label}>
                  {linkedWorkout.finishAt === null
                    ? 'Sin hora de fin estimada'
                    : linkedWorkout.endedAt !== null
                      ? `Terminaste ${agencyClock(linkedWorkout.endedAt)}`
                      : `Fin del entreno ~${agencyClock(linkedWorkout.finishAt)}`}
                </Text>
                <Text style={styles.note}>
                  {evidence[linkedWorkout.evidence]}
                  {linkedWorkout.fewestSessions !== null
                    ? ` Mínimo ${linkedWorkout.fewestSessions} entrenos medidos.`
                    : ''}
                  {linkedWorkout.overdue
                    ? ' La serie o pausa actual va más larga; la hora se ajusta.'
                    : ''}
                </Text>
              </>
            )}
            {advice ? (
              <>
                <View style={styles.row}>
                  {advice.option.itinerary.rides.map((ride, i) => (
                    <Fragment key={`${ride.trip[0]}-${i}`}>
                      {i > 0 && <Text style={styles.note}>→</Text>}
                      <RouteBadge route={ride.route} />
                    </Fragment>
                  ))}
                  <Text style={styles.value}>
                    {advice.boardAt === null ? 'Caminando' : `Bus ${agencyClock(advice.boardAt)}`}
                  </Text>
                </View>
                {advice.option.itinerary.rides.length > 0 && (
                  <Text style={styles.note}>
                    {advice.option.itinerary.rides.length === 1 ? 'Directo' : '1 transbordo'}
                  </Text>
                )}
                <Text style={styles.value}>
                  {trip.workoutId ? 'Termina' : 'Prepárate'} {agencyClock(advice.finishBy)} · sal{' '}
                  {agencyClock(advice.leaveAt)}
                </Text>
                <Text style={styles.note}>
                  Llegas {agencyClock(advice.option.arriveAt)} · {advice.source}
                </Text>
                {details && (
                  <Text style={styles.note}>
                    {advice.preparationMinutes} min para prepararte + {advice.walkMinutes} min
                    caminando
                    {advice.option.itinerary.access.source === 'estimate'
                      ? ' (estimados)'
                      : advice.option.itinerary.access.source === 'learned'
                        ? ' (según tus caminatas)'
                        : ' (tus minutos)'}
                    {advice.boardingMinutes ? ` + ${advice.boardingMinutes} min antes del bus` : ''}
                    .
                  </Text>
                )}
                {advice.reason && <Text style={styles.error}>{advice.reason}</Text>}
                {advice.option.tight && (
                  <Text style={styles.error}>
                    Transbordo justo: margen {Math.floor((advice.option.slack ?? 0) / 60_000)} min.
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.note}>
                {loading
                  ? 'Calculando el viaje…'
                  : alternative
                    ? 'El viaje elegido ya no aparece. Puedes elegir esta alternativa.'
                    : 'No hay una salida alcanzable en esta búsqueda. Cambia la hora o busca en Transit.'}
              </Text>
            )}
            {alternative && (details || !advice) && (
              <Button
                variant="ghost"
                label={`Alternativa: ${alternative.option.itinerary.rides.map((r) => r.route[1]).join(' → ') || 'a pie'} · sal ${agencyClock(alternative.leaveAt)}`}
                disabled={busy}
                onPress={() => void act(() => actions.select(alternative.option))}
              />
            )}
            {advice && !advice.option.problem && (
              <Button
                label="Salgo ahora"
                variant="primary"
                disabled={busy}
                onPress={() => void act(() => actions.startTrip())}
              />
            )}
            {details && advice && !advice.option.problem && (
              <Text style={styles.note}>
                Sigue tu viaje con el GPS hasta que llegues: avisa cuándo bajarte y mide tus
                caminatas.
              </Text>
            )}
            {(advice || trip.reminders) && (
              <Button
                label={trip.reminders ? 'Quitar avisos de este viaje' : 'Avisarme de este viaje'}
                disabled={
                  busy ||
                  (!trip.reminders &&
                    (!advice?.feasible || (!saved.preferences.prepare && !saved.preferences.leave)))
                }
                onPress={() => void act(() => actions.arm(!trip.reminders))}
              />
            )}
            {trip.reminders && (
              <Text style={styles.note}>
                Avisos con el último cálculo; sin cambios con la app cerrada.
              </Text>
            )}
            {trip.reminders && saved.preferences.quiet && (
              <Text style={styles.note}>
                Silencio activado: los avisos entre 21:30 y 07:30 se omiten.
              </Text>
            )}
            {journey.notificationStatus === 'denied' && (
              <>
                <Text style={styles.error}>
                  iOS no permite los avisos. El viaje sigue disponible aquí.
                </Text>
                <Button
                  label="Abrir ajustes del iPhone"
                  variant="ghost"
                  onPress={() => void act(() => Linking.openSettings())}
                />
              </>
            )}
            {trip.reminders && Platform.OS === 'web' && (
              <Text style={styles.note}>
                Los avisos locales se entregan en el iPhone; el navegador permite revisar el plan.
              </Text>
            )}
            {details && (
              <View style={styles.row}>
                {surface !== 'transit' && (
                  <Button
                    label="Cambiar viaje"
                    variant="ghost"
                    onPress={() => {
                      setOriginId(null);
                      setDestinationId(null);
                      setEditing(true);
                    }}
                  />
                )}
                <Button
                  label="Quitar viaje"
                  variant="ghost"
                  disabled={busy}
                  onPress={() => void act(() => actions.clear())}
                />
              </View>
            )}
          </>
        )}
        {(problem ?? journey.problem ?? journey.notificationProblem) && (
          <Text accessibilityRole="alert" style={styles.error}>
            {problem ?? journey.problem ?? journey.notificationProblem}
          </Text>
        )}
        {(journey.problem || journey.notificationProblem) && (
          <Button label="Reintentar viaje" onPress={() => void actions.refresh()} />
        )}
        <View style={styles.row}>
          {surface !== 'transit' && (
            <Button
              label="Ver en Transit"
              variant="ghost"
              onPress={() => navigation.navigate(...goTo('Transit', false))}
            />
          )}
          {/* Sin viaje elegido no hay detalle que abrir: los avisos van a la vista. */}
          {surface !== 'transit' && !selecting && (
            <Button
              label={details ? 'Menos detalle' : 'Detalles del viaje'}
              variant="ghost"
              onPress={() => setDetails(!details)}
            />
          )}
          {(details || selecting) && (
            <Button
              label={settings ? 'Cerrar ajustes de avisos' : 'Ajustar avisos'}
              variant="ghost"
              onPress={() => setSettings(!settings)}
            />
          )}
        </View>
      </Card>
      {settings && <TransitTravelSettings />}
    </>
  );
}

const styles = sheet((theme) => ({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  setting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
  },
  value: { fontFamily: font.black, fontSize: 18, color: theme.text, fontVariant: ['tabular-nums'] },
  label: { fontFamily: font.bold, fontSize: 14, color: theme.text, flexShrink: 1 },
  note: { fontFamily: font.regular, fontSize: 12, color: theme.textDim, lineHeight: 18 },
  error: { fontFamily: font.bold, fontSize: 13, color: theme.danger, lineHeight: 18 },
  minutes: { minWidth: 55, fontFamily: font.bold, fontSize: 17, color: theme.text },
}));
