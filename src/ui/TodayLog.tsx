import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { DailyLogEntry } from '../core/daily-log.ts';
import type { CoreDailyLogRow, NutritionContainerRow, SleepSource } from '../db/types.ts';

const SLEEP_SOURCES: { value: SleepSource; label: string }[] = [
  { value: 'autosleep', label: 'AutoSleep' },
  { value: 'apple_health', label: 'Apple Health' },
  { value: 'manual', label: 'A mano' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

export type TodayLogProps = {
  log: CoreDailyLogRow | null;
  containers: NutritionContainerRow[];
  waterTargetMl: number | null;
  onLog: (entry: Omit<DailyLogEntry, 'date'>) => void;
};

export function TodayLog({ log, containers, waterTargetMl, onLog }: TodayLogProps) {
  const [sleepDraft, setSleepDraft] = useState(
    log?.sleep_minutes === null || log?.sleep_minutes === undefined
      ? ''
      : String(log.sleep_minutes),
  );
  const [stepsDraft, setStepsDraft] = useState(
    log?.steps === null || log?.steps === undefined ? '' : String(log.steps),
  );

  const waterMl = log?.water_ml ?? 0;
  const drinks = log?.alcohol_drinks ?? 0;

  return (
    <View style={styles.wrapper}>
      <Section title="Agua">
        <Text style={styles.value}>
          {(waterMl / 1000).toFixed(2)} L
          {waterTargetMl === null ? '' : ` de ${(waterTargetMl / 1000).toFixed(1)} L`}
        </Text>
        <View style={styles.row}>
          {containers.map((container) => (
            <Chip
              key={container.id}
              label={`+ ${container.name}`}
              onPress={() => onLog({ waterMl: waterMl + container.volume_ml })}
            />
          ))}
          {waterMl > 0 && <Chip label="Reiniciar" onPress={() => onLog({ waterMl: 0 })} />}
        </View>
      </Section>

      <Section title="Creatina">
        <View style={styles.row}>
          <Chip
            label="Tomada"
            selected={log?.creatine_taken === 1}
            onPress={() => onLog({ creatineTaken: true })}
          />
          <Chip
            label="No"
            selected={log?.creatine_taken === 0}
            onPress={() => onLog({ creatineTaken: false })}
          />
        </View>
      </Section>

      <Section title="Sueño">
        <View style={styles.row}>
          <TextInput
            value={sleepDraft}
            onChangeText={setSleepDraft}
            onBlur={() => {
              const parsed = Number(sleepDraft);
              if (Number.isInteger(parsed) && parsed > 0) onLog({ sleepMinutes: parsed });
            }}
            keyboardType="numeric"
            accessibilityLabel="Minutos de sueño"
            placeholder="minutos"
            style={styles.input}
          />
          {SLEEP_SOURCES.map((source) => (
            <Chip
              key={source.value}
              label={source.label}
              selected={log?.sleep_source === source.value}
              onPress={() => onLog({ sleepSource: source.value })}
            />
          ))}
        </View>
      </Section>

      <Section title="Pasos">
        <TextInput
          value={stepsDraft}
          onChangeText={setStepsDraft}
          onBlur={() => {
            const parsed = Number(stepsDraft);
            if (Number.isInteger(parsed) && parsed >= 0) onLog({ steps: parsed });
          }}
          keyboardType="numeric"
          accessibilityLabel="Pasos"
          placeholder="pasos"
          style={styles.input}
        />
      </Section>

      <Section title="Alcohol">
        <Text style={styles.value}>{drinks} tragos</Text>
        <View style={styles.row}>
          <Chip label="+1" onPress={() => onLog({ alcoholDrinks: drinks + 1 })} />
          {drinks > 0 && (
            <Chip label="−1" onPress={() => onLog({ alcoholDrinks: Math.max(0, drinks - 1) })} />
          )}
          <Chip
            label="Ninguno"
            selected={log?.alcohol_drinks === 0}
            onPress={() => onLog({ alcoholDrinks: 0 })}
          />
          {drinks > 0 && (
            <Chip
              label="Dentro de 6 h del entreno"
              selected={log?.alcohol_after_training === 1}
              onPress={() => onLog({ alcoholAfterTraining: log?.alcohol_after_training !== 1 })}
            />
          )}
        </View>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'stretch',
    gap: 12,
  },
  section: {
    gap: 5,
  },
  sectionTitle: {
    fontSize: 12,
    color: '#666',
  },
  value: {
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#e2e2e2',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipSelected: {
    borderColor: '#555',
    backgroundColor: '#f3f3f3',
  },
  chipText: {
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
    minWidth: 96,
  },
});
