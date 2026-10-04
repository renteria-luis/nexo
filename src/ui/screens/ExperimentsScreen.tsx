import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { todayIso } from '../../core/dates.ts';
import type { ExperimentWithReadings } from '../../core/experiments.ts';
import { useAppData } from '../../shell/AppData.tsx';

import { Button } from '../Button.tsx';
import { Card } from '../Card.tsx';
import { Chip } from '../Chip.tsx';
import { Plus } from '../icons.ts';
import { ConfirmAction } from '../InfoBubble.tsx';
import { TextField } from '../TextField.tsx';
import { font, sheet, shape } from '../theme.ts';

import { Screen } from './Screen.tsx';

/** Spec 7.5 point 3, the test the spec actually proposes. Placeholders, not defaults. */
const DAIRY = {
  name: 'Fuera la leche 1%',
  hypothesis: 'La leche 1% me empeora la piel',
  variableChanged: 'Leche 1% cambiada por una bebida sin lácteos',
  outcomeMetric: 'Piel de 0 a 5, una vez por semana',
};

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
      <TextField
        value={value}
        onChange={onChange}
        accessibilityLabel={label}
        placeholder={placeholder}
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
  const range = /\b([01])\s*(?:a|al|[-–]|to)\s*(5|10)\b/i.exec(experiment.outcome_metric);
  const from = Number(range?.[1] ?? 0);
  const to = Number(range?.[2] ?? 10);
  const scale = Array.from({ length: to - from + 1 }, (_, index) => from + index);
  const today = readings.find((reading) => reading.date === todayIso())?.value;

  return (
    <Card>
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
            {scale.map((value) => (
              <Chip
                key={value}
                label={String(value)}
                selected={today === value}
                accessibilityLabel={`Anotar ${value} en ${experiment.name}`}
                onPress={() => onReading(value)}
              />
            ))}
          </View>
          <ConfirmAction
            label="Terminar"
            accessibilityLabel={`Terminar ${experiment.name}`}
            question={`¿Terminar ${experiment.name}?`}
            yes="Sí, terminar"
            onConfirm={onFinish}
          />
        </>
      )}
    </Card>
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
    <Screen title="Experimentos">
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
          // La lista se carga aqui y no en el proveedor, asi que se recarga en
          // cuanto la escritura termina, sin adivinar cuanto tarda.
          onReading={(value) => {
            logExperimentReading(item.experiment.id, todayIso(), value)
              .then(reload)
              .catch((error: unknown) => console.error(error));
          }}
          onFinish={() => {
            finishExperiment(item.experiment.id, todayIso())
              .then(reload)
              .catch((error: unknown) => console.error(error));
          }}
        />
      ))}

      {experiments?.length === 0 && !creating && (
        <Card>
          <Text style={styles.empty}>Todavía no hay ninguno.</Text>
        </Card>
      )}

      {!creating ? (
        <Button
          label="Nuevo experimento"
          accessibilityLabel="Nuevo experimento"
          icon={Plus}
          variant="primary"
          block
          onPress={() => setCreating(true)}
        />
      ) : (
        <Card title="Nuevo experimento">
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
            <Button
              label="Empezar"
              accessibilityLabel="Guardar experimento"
              variant="primary"
              disabled={!canSave}
              style={styles.grow}
              onPress={save}
            />
            <Button
              label="Cancelar"
              accessibilityLabel="Cancelar experimento"
              variant="ghost"
              onPress={() => setCreating(false)}
            />
          </View>
        </Card>
      )}
    </Screen>
  );
}

const styles = sheet((theme) => ({
  intro: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  problem: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.danger,
  },
  empty: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  name: {
    fontSize: 16,
    fontFamily: font.black,
    color: theme.text,
  },
  detail: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  halves: {
    fontSize: 14,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  field: {
    gap: 5,
  },
  fieldLabel: {
    fontSize: 12,
    fontFamily: font.black,
    letterSpacing: 0.6,
    color: theme.textFaint,
    textTransform: 'uppercase',
  },
  input: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 15,
    fontFamily: font.bold,
    color: theme.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  grow: {
    flex: 1,
  },
}));
