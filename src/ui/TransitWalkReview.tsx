import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { useTransitJourney } from '../shell/TransitJourney.tsx';
import { agencyClock, agencyDate, type Schedule } from '../transit/schedule.ts';
import type { Place } from '../transit/store.ts';
import { listWalkObservations, reviewWalk } from '../transit/trip-store.ts';
import { learnedWalks, LEARN_MIN_WALKS, walkKey, type WalkObservation } from '../transit/walks.ts';
import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { font, sheet } from './theme.ts';

const FLAGS = {
  imprecise: 'GPS impreciso: revisa el recorrido antes de aceptarlo.',
  fast: 'Más rápida de lo habitual: puede ser una carrera o un atajo.',
  slow: 'Más lenta de lo habitual: puede incluir una espera larga o una llegada olvidada.',
};
const minutes = (ms: number) => Math.round(ms / 6_000) / 10;

export function TransitWalkReview({
  db,
  schedule,
  places,
  revision,
  onChanged,
  onPath,
}: {
  db: SQLiteDatabase;
  schedule: Schedule;
  places: Place[];
  revision: number;
  onChanged: () => void;
  onPath: (walk: WalkObservation) => void;
}) {
  const { trip } = useTransitJourney();
  const [walks, setWalks] = useState<WalkObservation[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [limit, setLimit] = useState(5);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = useRef(false);
  const tripId = trip?.id;
  const phase = trip?.phase;
  const leg = trip?.leg;
  useEffect(() => {
    let alive = true;
    listWalkObservations(db)
      .then((saved) => {
        if (alive) {
          setWalks(saved);
          setProblem(null);
        }
      })
      .catch((error) => {
        if (alive) setProblem(String(error));
      });
    return () => {
      alive = false;
    };
  }, [db, revision, tripId, phase, leg]);
  const learned = useMemo(() => learnedWalks(walks), [walks]);
  const names = useMemo(
    () =>
      new Map([
        ...places.map((p) => [p.id, p.name] as const),
        ...schedule.stops.map((s) => [s[0], s[2]] as const),
      ]),
    [places, schedule],
  );
  const shown = walks.filter((walk) => (reviewed ? walk.status !== 'new' : walk.status === 'new'));
  const review = async (walk: WalkObservation, status: 'accepted' | 'excluded') => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await reviewWalk(db, walk.id, status);
      setWalks((old) => old.map((w) => (w.id === walk.id ? { ...w, status } : w)));
      onChanged();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Card title="Tus caminatas medidas">
      <Text style={styles.note}>
        Acepta solo recorridos habituales de esa dirección. Desde {LEARN_MIN_WALKS} caminatas
        aceptadas se usa la mediana de las últimas 10; tus minutos escritos siempre tienen
        prioridad.
      </Text>
      <Text style={styles.note}>
        El total incluye cruces y el tiempo desde «Salgo ahora». La salida del lugar es aproximada
        por GPS; no vuelvas a sumar ese tramo interior en la preparación.
      </Text>
      <Button
        label={reviewed ? 'Ver pendientes' : 'Ver revisadas'}
        variant="ghost"
        onPress={() => {
          setReviewed(!reviewed);
          setLimit(5);
        }}
      />
      {problem && (
        <Text accessibilityRole="alert" style={styles.error}>
          {problem}
        </Text>
      )}
      {!shown.length && (
        <Text style={styles.note}>
          {reviewed
            ? 'Todavía no hay caminatas revisadas.'
            : 'No hay caminatas pendientes de revisión.'}
        </Text>
      )}
      {shown.slice(0, limit).map((walk) => {
        const from = walk.kind === 'access' ? walk.place_id! : walk.from_stop!;
        const to = walk.kind === 'egress' ? walk.place_id! : walk.to_stop!;
        const estimate = learned.get(walkKey(walk));
        const count = walks.filter(
          (w) => w.status === 'accepted' && walkKey(w) === walkKey(walk),
        ).length;
        return (
          <View key={walk.id} style={styles.walk}>
            <Text style={styles.label}>
              {names.get(from) ?? from} → {names.get(to) ?? to}
            </Text>
            <Text style={styles.note}>
              {agencyDate(walk.ended_at)} · {agencyClock(walk.started_at)}–
              {agencyClock(walk.ended_at)} · {minutes(walk.ended_at - walk.started_at)} min en total
            </Text>
            {walk.left_at !== null && (
              <Text style={styles.note}>
                Hasta salir del lugar: unos {minutes(walk.left_at - walk.started_at)} min; después:{' '}
                {minutes(walk.ended_at - walk.left_at)} min.
              </Text>
            )}
            <Text style={styles.note}>
              Inicio {walk.start_source === 'tap' ? 'con tu toque' : 'por GPS'} · fin{' '}
              {walk.end_source === 'tap' ? 'con tu toque' : 'por GPS'} ·{' '}
              {walk.accuracy_m === null
                ? 'precisión sin medir'
                : `precisión ±${Math.round(walk.accuracy_m)} m`}
            </Text>
            {walk.flag && <Text style={styles.label}>{FLAGS[walk.flag]}</Text>}
            <Text style={styles.note}>
              {estimate
                ? `${estimate.minutes} min habituales · rango ${estimate.low}–${estimate.high} min · ${estimate.count} aceptadas.`
                : `${count}/${LEARN_MIN_WALKS} aceptadas para aprender esta dirección.`}{' '}
              {walk.status === 'excluded'
                ? 'Excluida del cálculo.'
                : walk.status === 'accepted'
                  ? 'Aceptada.'
                  : 'Pendiente.'}
            </Text>
            <View style={styles.row}>
              {walk.status !== 'accepted' && (
                <Button
                  label="Aceptar caminata"
                  disabled={busy}
                  onPress={() => void review(walk, 'accepted')}
                />
              )}
              {walk.status !== 'excluded' && (
                <Button
                  label="Excluir caminata"
                  variant="ghost"
                  disabled={busy}
                  onPress={() => void review(walk, 'excluded')}
                />
              )}
              <Button label="Ver recorrido" variant="ghost" onPress={() => onPath(walk)} />
            </View>
          </View>
        );
      })}
      {shown.length > limit && (
        <Button label="Ver más caminatas" variant="ghost" onPress={() => setLimit(limit + 5)} />
      )}
    </Card>
  );
}

const styles = sheet((theme) => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  walk: { gap: 7, paddingVertical: 10, borderTopWidth: 1, borderColor: theme.textDim },
  label: { fontFamily: font.bold, fontSize: 13, color: theme.text },
  note: { fontFamily: font.regular, fontSize: 12, color: theme.textDim, lineHeight: 18 },
  error: { fontFamily: font.bold, fontSize: 13, color: theme.danger },
}));
