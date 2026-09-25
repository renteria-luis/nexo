import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  isBodyWeightKg,
  sleepMinutesFrom,
  type DailyLogEntry,
  type LastWeight,
} from '../core/daily-log.ts';
import { addDays, shortDate } from '../core/dates.ts';
import type { CoreDailyLogRow, NutritionContainerRow, SleepSource } from '../db/types.ts';
import { NumericField } from './NumericField.tsx';
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
  /** El ultimo peso anotado, que se sigue mostrando los dias que no se pesa. */
  lastWeight: LastWeight | null;
  onLog: (entry: Omit<DailyLogEntry, 'date'>) => void;
};

/** Solo el numero del dia: el mes ya esta en la cabecera de la pantalla. */
function dayOfMonth(date: string): string {
  return String(Number(date.slice(8, 10)));
}

export function TodayLog({ log, containers, waterTargetMl, lastWeight, onLog }: TodayLogProps) {
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

  // El peso se queda puesto: si hoy no se peso, sigue valiendo el ultimo, y se ve de
  // donde salio. Anotarlo es cambiarlo, no volver a escribirlo todos los dias.
  const shownWeight = log?.weight_kg ?? lastWeight?.kg ?? null;
  const [weightDraft, setWeightDraft] = useState(shownWeight === null ? '' : String(shownWeight));

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

      <Section title="Peso">
        <View style={styles.row}>
          <NumericField
            value={weightDraft}
            onChange={setWeightDraft}
            allowDecimal
            accessibilityLabel="Peso corporal"
            placeholder="kg"
            onCommit={() => {
              const parsed = Number(weightDraft);
              if (isBodyWeightKg(parsed) && parsed !== log?.weight_kg) onLog({ weightKg: parsed });
            }}
            style={styles.input}
          />
          <Text style={styles.weightNote}>
            {log?.weight_kg != null
              ? 'de hoy'
              : lastWeight
                ? `del ${shortDate(lastWeight.date)}`
                : 'sin pesarte todavía'}
          </Text>
        </View>
      </Section>

      <Section title="Sueño">
        {/* La casilla es la noche anterior, y decirlo evita anotar la de anteanoche
            el dia que se levanta tarde. Se puntua en este dia porque es la noche que
            sostiene lo que haga hoy. */}
        {log?.date && (
          <Text style={styles.weightNote}>
            la noche del {dayOfMonth(addDays(log.date, -1))} al {dayOfMonth(log.date)}
          </Text>
        )}
        <View style={styles.row}>
          <NumericField
            value={sleepHours}
            onChange={setSleepHours}
            allowDecimal
            accessibilityLabel="Horas de sueño"
            placeholder="horas"
            onCommit={commitSleep}
            style={styles.input}
          />
          <NumericField
            value={sleepMinutes}
            onChange={setSleepMinutes}
            accessibilityLabel="Minutos de sueño"
            placeholder="min"
            onCommit={commitSleep}
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
        <NumericField
          value={stepsDraft}
          onChange={setStepsDraft}
          accessibilityLabel="Pasos"
          placeholder="pasos"
          onCommit={() => {
            // Un campo vacio es "no lo anote", no "cero pasos".
            if (stepsDraft.trim() === '') return;
            const parsed = Number(stepsDraft);
            if (Number.isInteger(parsed) && parsed >= 0) onLog({ steps: parsed });
          }}
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
    paddingVertical: 9,
    minHeight: 38,
    justifyContent: 'center',
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
  weightNote: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
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
