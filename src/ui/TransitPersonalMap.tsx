import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Text, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { Coordinates } from '../core/geo.ts';
import { useTransitJourney } from '../shell/TransitJourney.tsx';
import { departureOf, isActive } from '../transit/active-trip.ts';
import {
  deleteMapNote,
  listMapNotes,
  listStopWalks,
  listWalkLinks,
  saveMapNote,
  saveWalkPath,
  type MapNote,
  type StopWalk,
  type WalkLink,
  type WalkPathTarget,
} from '../transit/store.ts';
import {
  parsePath,
  pathFromTrace,
  PATH_MAX_POINTS,
  type WalkObservation,
} from '../transit/walks.ts';
import { Button } from './Button.tsx';
import { Chip } from './Chip.tsx';
import { Combobox } from './Combobox.tsx';
import { TextField } from './TextField.tsx';
import { TransitLiveMap } from './TransitLiveMap.tsx';
import { routeColor } from './routeColors.ts';
import { font, sheet } from './theme.ts';

export type WalkPreview = { key: number; walk: WalkObservation };
type PathChoice = { id: string; label: string; target: WalkPathTarget; points: Coordinates[] };
type NoteDraft = {
  id?: string;
  point: Coordinates | null;
  kind: MapNote['kind'];
  note: string;
  low: string;
  high: string;
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const targetOf = (walk: WalkObservation): WalkPathTarget =>
  walk.kind === 'transfer'
    ? { kind: 'transfer', fromStop: walk.from_stop!, toStop: walk.to_stop! }
    : {
        kind: 'link',
        placeId: walk.place_id!,
        stopId: (walk.to_stop ?? walk.from_stop)!,
        direction: walk.kind === 'access' ? 'to_stop' : 'from_stop',
      };

export function TransitPersonalMap({
  db,
  revision,
  onChanged,
  preview,
  ...map
}: ComponentProps<typeof TransitLiveMap> & {
  db: SQLiteDatabase;
  revision: number;
  onChanged: () => void;
  preview: WalkPreview | null;
}) {
  const { trip } = useTransitJourney();
  const [links, setLinks] = useState<WalkLink[]>([]);
  const [transfers, setTransfers] = useState<StopWalk[]>([]);
  const [notes, setNotes] = useState<MapNote[]>([]);
  const [pathId, setPathId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<Coordinates[] | null>(null);
  const [note, setNote] = useState<NoteDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pointFocus, setPointFocus] = useState<{ key: number; point: Coordinates } | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    let alive = true;
    Promise.all([listWalkLinks(db), listStopWalks(db), listMapNotes(db)])
      .then(([walks, stops, savedNotes]) => {
        // Validate before rendering so a bad restored path leaves the rest of Transit usable.
        [...walks, ...stops].forEach((walk) => parsePath(walk.path));
        if (alive) {
          setLinks(walks);
          setTransfers(stops);
          setNotes(savedNotes);
        }
      })
      .catch((error) => {
        if (alive) setProblem(message(error));
      });
    return () => {
      alive = false;
    };
  }, [db, revision]);
  const choices = useMemo<PathChoice[]>(() => {
    const places = new Map(map.places.map((p) => [p.id, p.name]));
    const stops = new Map(map.schedule.stops.map((s) => [s[0], s[2]]));
    return [
      ...links.map((walk) => {
        const place = places.get(walk.place_id) ?? walk.place_id;
        const stop = stops.get(walk.stop_id) ?? walk.stop_id;
        const target: WalkPathTarget = {
          kind: 'link',
          placeId: walk.place_id,
          stopId: walk.stop_id,
          direction: walk.direction,
        };
        return {
          id: JSON.stringify(target),
          label: walk.direction === 'to_stop' ? `${place} → ${stop}` : `${stop} → ${place}`,
          target,
          points: parsePath(walk.path),
        };
      }),
      ...transfers.map((walk) => {
        const target: WalkPathTarget = {
          kind: 'transfer',
          fromStop: walk.from_stop,
          toStop: walk.to_stop,
        };
        return {
          id: JSON.stringify(target),
          label: `${stops.get(walk.from_stop) ?? walk.from_stop} → ${stops.get(walk.to_stop) ?? walk.to_stop}`,
          target,
          points: parsePath(walk.path),
        };
      }),
    ];
  }, [links, transfers, map.places, map.schedule]);
  const [seenPreview, setSeenPreview] = useState<number | null>(null);
  if (preview && preview.key !== seenPreview) {
    setSeenPreview(preview.key);
    try {
      const points = pathFromTrace(JSON.parse(preview.walk.trace));
      setDrawing(points);
      setPathId(JSON.stringify(targetOf(preview.walk)));
      setNote(null);
      setProblem(null);
      if (points[0]) setPointFocus({ key: preview.key, point: points[0] });
    } catch (error) {
      setProblem(message(error));
    }
  }
  const chosen = choices.find((choice) => choice.id === pathId);
  const following = trip && isActive(trip) ? trip : null;
  const ride = following?.rides[following.leg];
  const paths = useMemo(
    () => [
      ...choices
        .filter((choice) => choice.id !== pathId || drawing === null)
        .map((choice) => ({ id: choice.id, points: choice.points })),
      ...(drawing === null ? [] : [{ id: 'drawing', points: drawing, drawing: true }]),
    ],
    [choices, drawing, pathId],
  );
  const act = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      setProblem(message(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const openNote = (id: string) => {
    if (busy || drawing !== null || map.onPoint) return;
    const saved = notes.find((n) => n.id === id);
    if (!saved) return;
    setNote({
      id,
      point: saved,
      kind: saved.kind,
      note: saved.note,
      low: saved.wait_min === null ? '' : String(saved.wait_min),
      high: saved.wait_max === null ? '' : String(saved.wait_max),
    });
    setConfirmDelete(false);
    setPointFocus({ key: Date.now(), point: saved });
  };
  const pick = (point: Coordinates) => {
    if (busy) return;
    if (map.onPoint) {
      map.onPoint(point);
      return;
    }
    if (note) setNote({ ...note, point });
    else if (drawing !== null) {
      if (drawing.length >= PATH_MAX_POINTS)
        setProblem(`Puedes guardar hasta ${PATH_MAX_POINTS} puntos.`);
      else setDrawing([...drawing, point]);
    }
  };
  const pickStop = (id: string) => {
    const stop = map.schedule.stops.find((s) => s[0] === id);
    if (stop && (map.onPoint || drawing !== null || note)) pick({ lat: stop[3], lng: stop[4] });
    else map.onStop(id);
  };
  const pickPlace = (id: string) => {
    const place = map.places.find((p) => p.id === id);
    if ((drawing !== null || note) && place && !map.onPoint) pick(place);
    else map.onPlace(id);
  };
  const editing = drawing !== null || note !== null;
  return (
    <>
      <TransitLiveMap
        {...map}
        followed={
          following ? (ride ? departureOf(following, ride, 0, map.schedule) : null) : map.followed
        }
        pointFocus={map.onPoint ? null : pointFocus}
        routePoints={following ? (ride?.path ?? []) : map.routePoints}
        routeColor={ride ? routeColor(ride.color) : map.routeColor}
        walkPaths={paths}
        notes={notes}
        location={following?.lastFix}
        draft={map.onPoint ? map.draft : (note?.point ?? drawing?.at(-1) ?? map.draft)}
        onPoint={map.onPoint || editing ? pick : undefined}
        onPlace={pickPlace}
        onStop={pickStop}
        onNote={openNote}
      />
      {problem && (
        <Text accessibilityRole="alert" style={styles.error}>
          {problem}
        </Text>
      )}
      {following?.lastFix && (
        <Button
          label="Ver mi ubicación"
          variant="ghost"
          onPress={() => setPointFocus({ key: Date.now(), point: following.lastFix! })}
        />
      )}
      <Text style={styles.note}>
        Verde discontinuo: tus caminos. Los cruces son notas personales; su espera ya cuenta en los
        minutos de caminata.
      </Text>
      {!map.onPoint && (
        <>
          {!note && (
            <>
              {drawing === null && (
                <Combobox
                  options={choices}
                  value={pathId}
                  onChange={(id) => {
                    if (!busy) setPathId(id);
                  }}
                  placeholder="Elige una caminata guardada"
                  accessibilityLabel="Camino de caminata"
                />
              )}
              {drawing === null ? (
                <Button
                  label="Dibujar o editar camino"
                  disabled={!chosen || busy}
                  onPress={() => {
                    setDrawing(chosen!.points);
                    setProblem(null);
                    if (chosen!.points[0])
                      setPointFocus({ key: Date.now(), point: chosen!.points[0] });
                  }}
                />
              ) : (
                <>
                  <Text style={styles.note}>
                    Toca el mapa, lugares o paradas en el orden en que caminas. {drawing.length}/
                    {PATH_MAX_POINTS} puntos.
                  </Text>
                  {!chosen && (
                    <Text style={styles.note}>
                      Para guardar este recorrido, guarda primero los minutos de esta dirección en
                      «Tu caminata» o en el transbordo de «Cómo llegar».
                    </Text>
                  )}
                  <View style={styles.row}>
                    <Button
                      label="Deshacer punto"
                      disabled={busy || !drawing.length}
                      onPress={() => setDrawing(drawing.slice(0, -1))}
                    />
                    <Button
                      label="Guardar camino"
                      variant="primary"
                      disabled={busy || !chosen || drawing.length === 1}
                      onPress={() =>
                        void act(async () => {
                          await saveWalkPath(db, chosen!.target, drawing);
                          setDrawing(null);
                          onChanged();
                        })
                      }
                    />
                    <Button
                      label="Cancelar camino"
                      variant="ghost"
                      disabled={busy}
                      onPress={() => setDrawing(null)}
                    />
                  </View>
                </>
              )}
              {!choices.length && (
                <Text style={styles.note}>
                  Guarda tus minutos de una caminata para dibujar su camino aquí.
                </Text>
              )}
            </>
          )}
          {!editing && (
            <>
              <Button
                label="Añadir cruce"
                variant="ghost"
                onPress={() => {
                  setNote({ point: null, kind: 'note', note: '', low: '', high: '' });
                  setConfirmDelete(false);
                  setProblem(null);
                }}
              />
              {notes.length > 0 && (
                <Combobox
                  options={notes.map((n) => ({
                    id: n.id,
                    label:
                      n.note ||
                      (n.kind === 'button'
                        ? 'Botón peatonal'
                        : n.kind === 'slow'
                          ? 'Cruce lento'
                          : 'Nota de cruce'),
                  }))}
                  value={null}
                  onChange={openNote}
                  placeholder="Ver o editar un cruce"
                  accessibilityLabel="Notas de cruces"
                />
              )}
            </>
          )}
          {note && (
            <>
              <Text style={styles.note}>
                {note.point
                  ? 'Punto elegido. Toca otro punto del mapa para moverlo.'
                  : 'Toca el mapa para ubicar el cruce.'}
              </Text>
              <View style={styles.row}>
                {(['button', 'slow', 'note'] as const).map((kind) => (
                  <Chip
                    key={kind}
                    label={
                      kind === 'button'
                        ? 'Botón peatonal'
                        : kind === 'slow'
                          ? 'Cruce lento'
                          : 'Nota'
                    }
                    selected={note.kind === kind}
                    disabled={busy}
                    onPress={() => setNote({ ...note, kind })}
                  />
                ))}
              </View>
              <TextField
                accessibilityLabel="Nota del cruce"
                value={note.note}
                onChange={(value) => setNote({ ...note, note: value })}
                placeholder="Qué conviene recordar aquí"
                multiline
              />
              <TextField
                accessibilityLabel="Espera mínima en segundos"
                value={note.low}
                onChange={(low) => setNote({ ...note, low })}
                placeholder="Espera mínima en segundos (opcional)"
              />
              <TextField
                accessibilityLabel="Espera máxima en segundos"
                value={note.high}
                onChange={(high) => setNote({ ...note, high })}
                placeholder="Espera máxima en segundos (opcional)"
              />
              <Text style={styles.note}>
                Es tu espera habitual, sin cuenta regresiva ni estado actual del semáforo.
              </Text>
              <View style={styles.row}>
                <Button
                  label="Guardar cruce"
                  variant="primary"
                  disabled={busy || !note.point}
                  onPress={() =>
                    void act(async () => {
                      await saveMapNote(db, {
                        ...note.point!,
                        id: note.id,
                        kind: note.kind,
                        note: note.note,
                        wait_min: note.low.trim() ? Number(note.low) : null,
                        wait_max: note.high.trim() ? Number(note.high) : null,
                      });
                      setNote(null);
                      onChanged();
                    })
                  }
                />
                <Button
                  label="Cancelar cruce"
                  variant="ghost"
                  disabled={busy}
                  onPress={() => setNote(null)}
                />
                {note.id && (
                  <Button
                    label={confirmDelete ? 'Confirmar eliminación del cruce' : 'Eliminar cruce'}
                    variant="ghost"
                    disabled={busy}
                    onPress={() => {
                      if (!confirmDelete) {
                        setConfirmDelete(true);
                        return;
                      }
                      void act(async () => {
                        await deleteMapNote(db, note.id!);
                        setNote(null);
                        onChanged();
                      });
                    }}
                  />
                )}
              </View>
            </>
          )}
        </>
      )}
    </>
  );
}

const styles = sheet((theme) => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { fontFamily: font.regular, fontSize: 12, color: theme.textDim, lineHeight: 18 },
  error: { fontFamily: font.bold, fontSize: 13, color: theme.danger },
}));
