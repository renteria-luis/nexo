import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { sleepMinutesFrom, type DailyLogEntry } from '../core/daily-log.ts';
import type { CoreDailyLogRow, NutritionContainerRow, SleepSource } from '../db/types.ts';
import { mono, theme } from './theme.ts';

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
  // Dos casillas porque asi lo dice en voz alta: siete y media, o ciento treinta
  // minutos. Cualquiera de las dos sola vale, y 7.5 en horas tambien.
  const slept = log?.sleep_minutes ?? null;
  const [sleepHours, setSleepHours] = useState(
    slept === null ? '' : String(Math.floor(slept / 60)),
  );
  const [sleepMinutes, setSleepMinutes] = useState(slept === null ? '' : String(slept % 60));
  const [stepsDraft, setStepsDraft] = useState(
    log?.steps === null || log?.steps === undefined ? '' : String(log.steps),
  );

  const commitSleep = () => {
    const total = sleepMinutesFrom(sleepHours, sleepMinutes);
    if (total === null) return;
    // El esquema pide de donde salio el dato, y escrito a mano es 'manual'. Sin
    // esto, escribir la hora antes de tocar un chip rompe la escritura.
    onLog({ sleepMinutes: total, sleepSource: log?.sleep_source ?? 'manual' });
    setSleepHours(String(Math.floor(total / 60)));
    setSleepMinutes(String(total % 60));
  };

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
            value={sleepHours}
            onChangeText={setSleepHours}
            onBlur={commitSleep}
            keyboardType="numeric"
            accessibilityLabel="Horas de sueño"
            placeholder="horas"
            placeholderTextColor={theme.textGhost}
            style={styles.input}
          />
          <TextInput
            value={sleepMinutes}
            onChangeText={setSleepMinutes}
            onBlur={commitSleep}
            keyboardType="numeric"
            accessibilityLabel="Minutos de sueño"
            placeholder="min"
            placeholderTextColor={theme.textGhost}
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
          placeholderTextColor={theme.textGhost}
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
    color: theme.textFaint,
    fontFamily: mono,
  },
  value: {
    fontSize: 14,
    fontFamily: mono,
    color: theme.text,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipSelected: {
    borderColor: theme.lineStrong,
    backgroundColor: theme.surfaceHigh,
  },
  chipText: {
    fontSize: 12,
    fontFamily: mono,
    color: theme.text,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.lineSoft,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
    minWidth: 96,
    fontFamily: mono,
    color: theme.text,
  },
});
