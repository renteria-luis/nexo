import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { fold } from '../nutrition/picker.ts';
import type { CatalogExercise } from '../training/queries.ts';
import type { PlannedSet } from '../training/routines.ts';
import type { SessionPlanEdit } from '../training/session-plan.ts';
import { replacePendingSets } from '../training/variants.ts';
import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
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
};

export function SessionPlanEditor({
  sessionId,
  routineId,
  catalog,
  onLoad,
  onSave,
  onApplied,
  onCancel,
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
  const move = (id: string, offset: number) =>
    change((entries) => {
      const next = entries.slice();
      const index = next.findIndex((entry) => entry.exerciseId === id);
      if (index + offset < 0 || index + offset >= next.length) return entries;
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
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
  const pending =
    draft?.exercises.reduce(
      (total, entry) => total + entry.sets - (done.get(entry.exerciseId) ?? 0),
      0,
    ) ?? 0;

  const pickerContent = picker && !saving && (
    <View style={styles.picker}>
      <Text style={styles.title}>
        {picker.from ? `Reemplazar pendientes de ${nameOf(picker.from)}` : 'Añadir 3 series de…'}
      </Text>
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
      <Button label="Cerrar búsqueda" variant="ghost" onPress={() => setPicker(null)} />
    </View>
  );

  return (
    <Card
      title={draft?.routineName ? `Revisar cambio a ${draft.routineName}` : 'Plan de este entreno'}
    >
      <Text style={styles.note}>
        Los cambios son solo para este entreno. Las series hechas se conservan.
      </Text>
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
            {draft.exercises.map((entry, index) => {
              const name = nameOf(entry.exerciseId);
              const completed = done.get(entry.exerciseId) ?? 0;
              const left = entry.sets - completed;
              return (
                <View key={entry.exerciseId} style={styles.row}>
                  <Text style={styles.title}>
                    {index + 1}. {name}
                  </Text>
                  <Text style={styles.note}>
                    {completed} hechas · {left} pendientes
                  </Text>
                  <View style={styles.controls}>
                    <Button
                      label="− Serie"
                      accessibilityLabel={`Quitar una serie pendiente de ${name}`}
                      disabled={saving || left === 0}
                      onPress={() => setCount(entry.exerciseId, entry.sets - 1)}
                    />
                    <Button
                      label="+ Serie"
                      accessibilityLabel={`Añadir una serie pendiente a ${name}`}
                      disabled={saving}
                      onPress={() => setCount(entry.exerciseId, entry.sets + 1)}
                    />
                  </View>
                  <View style={styles.controls}>
                    <Button
                      label="Cambiar"
                      accessibilityLabel={`Cambiar ejercicio ${name}`}
                      variant="ghost"
                      disabled={saving || left === 0}
                      onPress={() => {
                        setPicker({ from: entry.exerciseId });
                        setSearch('');
                      }}
                    />
                    <Button
                      label="Omitir pendientes"
                      accessibilityLabel={`Omitir pendientes de ${name}`}
                      variant="ghost"
                      disabled={saving || left === 0}
                      onPress={() => setCount(entry.exerciseId, completed)}
                    />
                  </View>
                  <View style={styles.controls}>
                    <Button
                      label="↑ Subir"
                      accessibilityLabel={`Subir ${name}`}
                      variant="ghost"
                      disabled={saving || index === 0}
                      onPress={() => move(entry.exerciseId, -1)}
                    />
                    <Button
                      label="↓ Bajar"
                      accessibilityLabel={`Bajar ${name}`}
                      variant="ghost"
                      disabled={saving || index === draft.exercises.length - 1}
                      onPress={() => move(entry.exerciseId, 1)}
                    />
                  </View>
                  {picker?.from === entry.exerciseId && pickerContent}
                </View>
              );
            })}
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
      <Button
        label={problem && draft ? 'Reintentar guardar plan' : 'Guardar plan'}
        variant="primary"
        loading={saving}
        disabled={loading || !draft}
        onPress={() => {
          void save();
        }}
      />
      <Button label="Cancelar cambios" disabled={saving} onPress={onCancel} />
    </Card>
  );
}

const styles = sheet((theme) => ({
  title: { color: theme.text, fontFamily: font.bold, fontSize: 15 },
  note: { color: theme.textFaint, fontFamily: font.regular, fontSize: 13 },
  error: { color: theme.text, fontFamily: font.bold, fontSize: 14 },
  row: { borderTopWidth: 1, borderColor: theme.lineSoft, paddingVertical: 10, gap: 6 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  picker: { gap: 8, paddingVertical: 8 },
}));
