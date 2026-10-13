import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import { shortDay } from '../core/dates.ts';
import { useTransitJourney } from '../shell/TransitJourney.tsx';
import { transitHere } from '../shell/transit.ts';
import { agencyClock, agencyDate } from '../transit/schedule.ts';
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

export function TransitJourneyCard({ surface }: { surface: 'today' | 'training' | 'transit' }) {
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
  const [details, setDetails] = useState(surface !== 'training');
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
      const place = nearestPlace(places, point);
      if (place) {
        setOriginId(place.id);
        setEditing(true);
        setProblem(null);
      }
    } catch (error) {
      if (token === locationToken.current) setProblem(message(error));
    } finally {
      clearTimeout(timeout);
      if (token === locationToken.current) setDetecting(false);
    }
  };
  if (!TRANSIT_ENABLED) return null;
  const selecting = editing || !trip || (surface === 'training' && trip.workoutId !== sessionId);
  const linkedWorkout = workout && trip?.workoutId === workout.sessionId ? workout : null;
  const originName = places.find((place) => place.id === trip?.originId)?.name;
  const targetName = places.find((place) => place.id === trip?.destinationId)?.name;
  return (
    <>
      <Card title={surface === 'training' ? 'Viaje al terminar' : 'Próximo viaje'}>
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
                    <RouteBadge key={`${ride.trip[0]}-${i}`} route={ride.route} />
                  ))}
                  <Text style={styles.value}>
                    {advice.boardAt === null ? 'Caminando' : `Bus ${agencyClock(advice.boardAt)}`}
                  </Text>
                </View>
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
            {alternative && (
              <Button
                variant="ghost"
                label={`Alternativa: ${alternative.option.itinerary.rides.map((r) => r.route[1]).join(' → ') || 'a pie'} · sal ${agencyClock(alternative.leaveAt)}`}
                disabled={busy}
                onPress={() => void act(() => actions.select(alternative.option))}
              />
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
                <Button
                  label="Cambiar viaje"
                  variant="ghost"
                  onPress={() => {
                    setOriginId(null);
                    setDestinationId(null);
                    setEditing(true);
                  }}
                />
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
          {surface === 'training' && (
            <Button
              label={details ? 'Menos detalle' : 'Detalles del viaje'}
              variant="ghost"
              onPress={() => setDetails(!details)}
            />
          )}
          {details && (
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
