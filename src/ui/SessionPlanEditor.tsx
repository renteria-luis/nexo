import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { fold } from '../nutrition/picker.ts';
import type { CatalogExercise } from '../training/queries.ts';
import type { PlannedSet } from '../training/routines.ts';
import type { SessionPlanEdit } from '../training/session-plan.ts';
import { replacePendingSets } from '../training/variants.ts';
import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { OrderList, type OrderItem } from './OrderList.tsx';
import { SearchField } from './SearchField.tsx';
import { font, sheet } from './theme.ts';

export type SessionPlanEditorProps = {
  sessionId: string;
  routineId?: string;
  catalog: readonly CatalogExercise[];
  onLoad: (sessionId: string, routineId?: string) => Promise<SessionPlanEdit>;
  onSave: (edit: SessionPlanEdit) => Promise<void>;
  onApplied: (edit: SessionPlanEdit) => void;
  onCancel: () => void;
  /** Para que la pantalla no se desplace mientras arrastra una fila. */
  onDragging: (dragging: boolean) => void;
};

export function SessionPlanEditor({
  sessionId,
  routineId,
  catalog,
  onLoad,
  onSave,
  onApplied,
  onCancel,
  onDragging,
}: SessionPlanEditorProps) {
  const [draft, setDraft] = useState<SessionPlanEdit | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [picker, setPicker] = useState<{ from: string | null } | null>(null);
  const [search, setSearch] = useState('');
  const writing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    onLoad(sessionId, routineId)
      .then((edit) => {
        if (!cancelled) setDraft(edit);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setProblem(error instanceof Error ? error.message : 'No se pudo cargar el plan.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, routineId, onLoad, revision]);

  const done = new Map(draft?.done.map((entry) => [entry.exerciseId, entry.sets]));
  const nameOf = (id: string) => catalog.find((entry) => entry.id === id)?.name_es ?? id;
  const change = (work: (entries: PlannedSet[]) => PlannedSet[]) => {
    if (writing.current) return;
    setDraft((current) => current && { ...current, exercises: work(current.exercises) });
  };
  const setCount = (id: string, count: number) =>
    change((entries) =>
      entries
        .map((entry) =>
          entry.exerciseId === id ? { ...entry, sets: Math.max(done.get(id) ?? 0, count) } : entry,
        )
        .filter((entry) => entry.sets > 0),
    );
  const reorder = (from: number, to: number) =>
    change((entries) => {
      const next = entries.slice();
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
  const nudge = (id: string, direction: 1 | -1) => {
    const entry = draft?.exercises.find((one) => one.exerciseId === id);
    if (entry) setCount(id, entry.sets + direction);
  };
  const swap = (id: string) => {
    setPicker((current) => (current?.from === id ? null : { from: id }));
    setSearch('');
  };
  const choose = (exercise: CatalogExercise) => {
    if (!draft || !picker || writing.current) return;
    const from = picker.from;
    change((entries) => replacePendingSets(entries, done, from, exercise));
    setPicker(null);
    setSearch('');
  };
  const save = async () => {
    if (!draft || writing.current || loading) return;
    writing.current = true;
    setSaving(true);
    setProblem(null);
    const approved = {
      ...draft,
      exercises: draft.exercises.map((entry, index) => ({ ...entry, position: index + 1 })),
    };
    try {
      await onSave(approved);
      onApplied(approved);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'No se pudo guardar el plan.');
    } finally {
      writing.current = false;
      setSaving(false);
    }
  };
  const candidates = catalog.filter(
    (exercise) =>
      !exercise.archived &&
      exercise.id !== picker?.from &&
      fold(exercise.name_es).includes(fold(search)),
  );
  const items = useMemo<OrderItem[]>(() => {
    if (!draft) return [];
    const doneNow = new Map(draft.done.map((entry) => [entry.exerciseId, entry.sets]));
    return draft.exercises.map((entry) => {
      const completed = doneNow.get(entry.exerciseId) ?? 0;
      return {
        id: entry.exerciseId,
        name: catalog.find((one) => one.id === entry.exerciseId)?.name_es ?? entry.exerciseId,
        detail: `${completed} de ${entry.sets} ${entry.sets === 1 ? 'serie' : 'series'}`,
        // Lo hecho no se quita ni se cambia: solo lo que falta.
        canRemove: entry.sets > completed,
        canSwap: entry.sets > completed,
      };
    });
  }, [draft, catalog]);
  const pending =
    draft?.exercises.reduce(
      (total, entry) => total + entry.sets - (done.get(entry.exerciseId) ?? 0),
      0,
    ) ?? 0;

  const pickerContent = picker && !saving && (
    <View style={styles.picker}>
      <Text style={styles.title}>
        {picker.from ? `Cambiar ${nameOf(picker.from)} por…` : 'Añadir 3 series de…'}
      </Text>
      <View style={styles.controls}>
        {picker.from !== null && (
          <Button
            label="Omitir pendientes"
            accessibilityLabel={`Omitir pendientes de ${nameOf(picker.from)}`}
            onPress={() => {
              const from = picker.from;
              if (from !== null) setCount(from, done.get(from) ?? 0);
              setPicker(null);
            }}
          />
        )}
        <Button label="Cerrar" variant="ghost" onPress={() => setPicker(null)} />
      </View>
      <SearchField
        value={search}
        onChange={setSearch}
        accessibilityLabel="Buscar ejercicio para el plan"
        placeholder="Nombre del ejercicio"
      />
      {candidates.slice(0, 8).map((exercise) => (
        <Button
          key={exercise.id}
          label={exercise.name_es}
          accessibilityLabel={`Elegir ${exercise.name_es} para el plan`}
          onPress={() => choose(exercise)}
        />
      ))}
      {candidates.length === 0 && (
        <Text style={styles.note}>No hay ejercicios con ese nombre.</Text>
      )}
      {candidates.length > 8 && (
        <Text style={styles.note}>Escribe para encontrar más ejercicios.</Text>
      )}
    </View>
  );

  return (
    <Card
      title={draft?.routineName ? `Revisar cambio a ${draft.routineName}` : 'Plan de este entreno'}
    >
      {loading ? (
        <Text style={styles.note}>Cargando plan…</Text>
      ) : (
        draft && (
          <>
            {draft.removedPending > 0 && (
              <Text style={styles.note}>
                La propuesta retira {draft.removedPending} series pendientes de los ejercicios que
                no están en la nueva rutina. Revísala antes de guardar.
              </Text>
            )}
            <Text style={styles.title}>{pending} series pendientes</Text>
            <OrderList
              items={items}
              onReorder={reorder}
              onNudge={nudge}
              onDragging={onDragging}
              onSwap={swap}
              swapping={picker?.from ?? null}
            />
            {picker !== null && picker.from !== null && pickerContent}
            <Button
              label="Añadir ejercicio"
              disabled={saving}
              onPress={() => {
                setPicker({ from: null });
                setSearch('');
              }}
            />
            {picker?.from === null && pickerContent}
          </>
        )
      )}
      {problem && (
        <View style={styles.picker}>
          <Text accessibilityRole="alert" style={styles.error}>
            {problem} Tus cambios aún no se guardaron.
          </Text>
          <Button
            label={draft ? 'Descartar cambios y actualizar' : 'Reintentar carga'}
            disabled={saving || loading}
            onPress={() => {
              setDraft(null);
              setPicker(null);
              setLoading(true);
              setProblem(null);
              setRevision((value) => value + 1);
            }}
          />
        </View>
      )}
      <View style={styles.actions}>
        <Button
          label={problem && draft ? 'Reintentar guardar plan' : 'Guardar plan'}
          variant="primary"
          loading={saving}
          disabled={loading || !draft}
          onPress={() => {
            void save();
          }}
          style={styles.save}
        />
        <Button
          label="Cancelar"
          accessibilityLabel="Cancelar cambios"
          variant="ghost"
          disabled={saving}
          onPress={onCancel}
        />
      </View>
    </Card>
  );
}

const styles = sheet((theme) => ({
  title: { color: theme.text, fontFamily: font.bold, fontSize: 15 },
  note: { color: theme.textFaint, fontFamily: font.regular, fontSize: 13 },
  error: { color: theme.text, fontFamily: font.bold, fontSize: 14 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  save: { flex: 1 },
  picker: { gap: 8, paddingVertical: 8 },
}));
