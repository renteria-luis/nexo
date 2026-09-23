import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { todayIso } from '../../core/dates.ts';
import type { ExperimentWithReadings } from '../../core/experiments.ts';
import { useAppData } from '../../shell/AppData.tsx';

import { Screen } from './Screen.tsx';
import { mono, theme } from '../theme.ts';

/** Spec 7.5 point 3, the test the spec actually proposes. Placeholders, not defaults. */
const DAIRY = {
  name: 'Fuera la leche 1%',
  hypothesis: 'La leche 1% me empeora la piel',
  variableChanged: 'Leche 1% cambiada por una bebida sin lácteos',
  outcomeMetric: 'Piel de 0 a 5, una vez por semana',
};

const SCALE = [0, 1, 2, 3, 4, 5];

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={theme.textGhost}
        style={styles.input}
      />
    </View>
  );
}

function Experiment({
  item,
  onReading,
  onFinish,
}: {
  item: ExperimentWithReadings;
  onReading: (value: number) => void;
  onFinish: () => void;
}) {
  const { experiment, readings, weeksRunning, halves } = item;
  const running = experiment.end_date === null;

  return (
    <View style={styles.card}>
      <Text style={styles.name}>{experiment.name}</Text>
      <Text style={styles.detail}>{experiment.hypothesis}</Text>
      <Text style={styles.detail}>Cambié: {experiment.variable_changed}</Text>
      <Text style={styles.detail}>
        {experiment.outcome_metric} · semana {weeksRunning} · {readings.length} lecturas
        {running ? '' : ` · terminó el ${experiment.end_date}`}
      </Text>

      {halves && (
        <Text style={styles.halves}>
          Primera mitad {halves.first.toFixed(1)} · segunda mitad {halves.second.toFixed(1)}
        </Text>
      )}

      {running && (
        <>
          <Text style={styles.fieldLabel}>Cómo está hoy</Text>
          <View style={styles.chips}>
            {SCALE.map((value) => (
              <Pressable
                key={value}
                accessibilityLabel={`Anotar ${value} en ${experiment.name}`}
                onPress={() => onReading(value)}
                style={styles.chip}
              >
                <Text style={styles.chipText}>{value}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityLabel={`Terminar ${experiment.name}`}
            onPress={onFinish}
            style={styles.finish}
          >
            <Text style={styles.finishText}>Terminar</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

/**
 * Spec 5.11. One thing changed at a time, with a date on both ends, because the
 * dairy literature is mixed enough that eight weeks of his own skin tells him more
 * than the meta-analyses do (spec 7.5).
 */
export function ExperimentsScreen() {
  const { loadExperiments, beginExperiment, logExperimentReading, finishExperiment } = useAppData();
  const [experiments, setExperiments] = useState<ExperimentWithReadings[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [variable, setVariable] = useState('');
  const [metric, setMetric] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const reload = useCallback(() => {
    loadExperiments()
      .then(setExperiments)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(error instanceof Error ? error.message : String(error));
      });
  }, [loadExperiments]);

  useEffect(reload, [reload]);

  const canSave = [name, hypothesis, variable, metric].every((value) => value.trim() !== '');

  const save = () => {
    if (!canSave) return;
    beginExperiment({
      name,
      hypothesis,
      variableChanged: variable,
      outcomeMetric: metric,
      startDate: todayIso(),
    })
      .then(() => {
        setCreating(false);
        setName('');
        setHypothesis('');
        setVariable('');
        setMetric('');
        setProblem(null);
        reload();
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem(error instanceof Error ? error.message : String(error));
      });
  };

  return (
    <Screen>
      <Text style={styles.intro}>
        Un experimento es una pregunta con fecha: cambias una sola cosa, la anotas cada dia en la
        misma escala y al final ves si movio algo. Por ejemplo dormir media hora mas durante dos
        semanas y apuntar como amaneces del 1 al 10.
      </Text>
      <Text style={styles.intro}>
        Una cosa a la vez, con fecha de inicio y una lectura en la misma escala. Cambiar dos cosas
        al mismo tiempo no responde ninguna.
      </Text>

      {problem && <Text style={styles.problem}>{problem}</Text>}

      {experiments?.map((item) => (
        <Experiment
          key={item.experiment.id}
          item={item}
          onReading={(value) => {
            logExperimentReading(item.experiment.id, todayIso(), value);
            // The list is loaded here rather than by the provider, so it refreshes
            // itself once the write has had its turn.
            setTimeout(reload, 300);
          }}
          onFinish={() => {
            finishExperiment(item.experiment.id, todayIso());
            setTimeout(reload, 300);
          }}
        />
      ))}

      {experiments?.length === 0 && !creating && (
        <Text style={styles.empty}>Todavía no hay ninguno.</Text>
      )}

      {!creating ? (
        <Pressable
          accessibilityLabel="Nuevo experimento"
          onPress={() => setCreating(true)}
          style={styles.newOne}
        >
          <Text style={styles.newOneText}>+ Nuevo experimento</Text>
        </Pressable>
      ) : (
        <View style={styles.form}>
          <Field label="Nombre" value={name} onChange={setName} placeholder={DAIRY.name} />
          <Field
            label="Qué creo que pasa"
            value={hypothesis}
            onChange={setHypothesis}
            placeholder={DAIRY.hypothesis}
          />
          <Field
            label="Qué cambio"
            value={variable}
            onChange={setVariable}
            placeholder={DAIRY.variableChanged}
          />
          <Field
            label="Qué mido"
            value={metric}
            onChange={setMetric}
            placeholder={DAIRY.outcomeMetric}
          />
          <View style={styles.row}>
            <Pressable
              accessibilityLabel="Guardar experimento"
              disabled={!canSave}
              onPress={save}
              style={[styles.save, !canSave && styles.saveDisabled]}
            >
              <Text style={styles.saveText}>Empezar</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Cancelar experimento"
              onPress={() => setCreating(false)}
              style={styles.cancel}
            >
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontSize: 12,
    color: theme.textFaint,
  },
  problem: {
    fontSize: 12,
    color: theme.danger,
  },
  empty: {
    fontSize: 12,
    color: theme.textGhost,
  },
  card: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    padding: 10,
    gap: 4,
    marginTop: 10,
  },
  name: {
    fontSize: 14,
    fontFamily: mono,
    color: theme.text,
  },
  detail: {
    fontSize: 11,
    color: theme.textFaint,
  },
  halves: {
    fontSize: 12,
    color: theme.ok,
    fontFamily: mono,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  chip: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 38,
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.text,
  },
  finish: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  finishText: {
    fontSize: 12,
    color: theme.textFaint,
    fontFamily: mono,
  },
  newOne: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 6,
  },
  newOneText: {
    fontSize: 12,
    color: theme.textDim,
    fontFamily: mono,
  },
  form: {
    gap: 8,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
  },
  field: {
    gap: 2,
  },
  fieldLabel: {
    fontSize: 10,
    color: theme.textFaint,
    fontFamily: mono,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.lineSoft,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  save: {
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveDisabled: {
    borderColor: theme.lineSoft,
  },
  saveText: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.text,
  },
  cancel: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 12,
    color: theme.textFaint,
    fontFamily: mono,
  },
});
