import { useState } from 'react';
import { Text, View } from 'react-native';

import {
  typedSleep,
  typedSteps,
  typedWeight,
  type DailyLogEntry,
  type LastWeight,
} from '../core/daily-log.ts';
import { addDays, shortDate } from '../core/dates.ts';
import type { CoreDailyLogRow, NutritionContainerRow, SleepSource } from '../db/types.ts';

import { Chip } from './Chip.tsx';
import { Droplets, Footprints, Moon, Pill, Scale, Wine, type LucideIcon } from './icons.ts';
import { NumericField } from './NumericField.tsx';
import { Toggle } from './Toggle.tsx';
import { font, sheet, shape, theme } from './theme.ts';

const SLEEP_SOURCES: { value: SleepSource; label: string }[] = [
  { value: 'autosleep', label: 'AutoSleep' },
  { value: 'apple_health', label: 'Apple Health' },
  { value: 'manual', label: 'A mano' },
];

/**
 * Un dato del dia, con su icono y su raya.
 *
 * El icono va en su propia cajita con borde, que es como el estilo marca un icono, y
 * la raya de arriba separa un dato del siguiente sin gastar el alto que gastaria una
 * cartilla por cada uno.
 */
function Field({
  title,
  icon: Icon,
  first = false,
  children,
}: {
  title: string;
  icon: LucideIcon;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.field, !first && styles.fieldRuled]}>
      <View style={styles.head}>
        <View style={styles.badge}>
          <Icon size={15} color={theme.text} strokeWidth={2.5} />
        </View>
        <Text style={styles.title}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

export type TodayLogProps = {
  log: CoreDailyLogRow | null;
  containers: NutritionContainerRow[];
  waterTargetMl: number | null;
  /** El ultimo peso anotado, que se sigue mostrando los dias que no se pesa. */
  lastWeight: LastWeight | null;
  /** Con el lapiz apagado solo se lee, que es lo que hace el resto del dia. */
  editing: boolean;
  onLog: (entry: Omit<DailyLogEntry, 'date'>) => void;
};

/**
 * Lo mismo en una linea por dato: icono, nombre y lo que hay.
 *
 * Es lo que se mira noventa y nueve veces de cada cien; escribir es lo raro. Con todos
 * los botones puestos, leer el dia entero era media pantalla de deslizar.
 */
function Summary({
  log,
  waterTargetMl,
  lastWeight,
}: Pick<TodayLogProps, 'log' | 'waterTargetMl' | 'lastWeight'>) {
  const weightKg = log?.weight_kg ?? lastWeight?.kg ?? null;
  const rows: { icon: LucideIcon; label: string; value: string }[] = [
    {
      icon: Droplets,
      label: 'Agua',
      value: `${((log?.water_ml ?? 0) / 1000).toFixed(2)} L${
        waterTargetMl === null ? '' : ` de ${(waterTargetMl / 1000).toFixed(1)} L`
      }`,
    },
    {
      icon: Pill,
      label: 'Creatina',
      value:
        log?.creatine_taken == null ? 'sin anotar' : log.creatine_taken === 1 ? 'tomada' : 'no',
    },
    {
      icon: Scale,
      label: 'Peso',
      value:
        weightKg === null
          ? 'sin anotar'
          : `${weightKg} kg${log?.weight_kg == null ? ' (del último día)' : ''}`,
    },
    {
      icon: Moon,
      label: 'Sueño',
      value:
        log?.sleep_minutes == null
          ? 'sin anotar'
          : `${Math.floor(log.sleep_minutes / 60)} h ${log.sleep_minutes % 60} min`,
    },
    {
      icon: Footprints,
      label: 'Pasos',
      value: log?.steps == null ? 'sin anotar' : String(log.steps),
    },
    {
      icon: Wine,
      label: 'Alcohol',
      value: log?.alcohol_drinks == null ? 'sin anotar' : `${log.alcohol_drinks} tragos`,
    },
  ];

  return (
    <View style={styles.wrapper}>
      {rows.map((row) => (
        <View key={row.label} style={styles.line}>
          <row.icon size={15} color={theme.textDim} strokeWidth={2.5} />
          <Text style={styles.lineLabel}>{row.label}:</Text>
          <Text style={styles.lineValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

/** Solo el numero del dia: el mes ya esta en la cabecera de la pantalla. */
function dayOfMonth(date: string): string {
  return String(Number(date.slice(8, 10)));
}

/** Lo guardado tal como se ve en su casilla: vacia si no hay nada. */
function asText(value: number | null): string {
  return value === null ? '' : String(value);
}

type Typed = { sleep: boolean; steps: boolean; weight: boolean };

export function TodayLog({
  log,
  containers,
  waterTargetMl,
  lastWeight,
  editing,
  onLog,
}: TodayLogProps) {
  // Dos casillas porque asi lo dice en voz alta: siete y media, o ciento treinta
  // minutos. Cualquiera de las dos sola vale, y 7.5 en horas tambien.
  const slept = log?.sleep_minutes ?? null;
  const steps = log?.steps ?? null;
  const sleptHours = slept === null ? null : Math.floor(slept / 60);
  const sleptMinutes = slept === null ? null : slept % 60;
  const [sleepHours, setSleepHours] = useState(asText(sleptHours));
  const [sleepMinutes, setSleepMinutes] = useState(asText(sleptMinutes));
  const [stepsDraft, setStepsDraft] = useState(asText(steps));

  // El peso se queda puesto: si hoy no se peso, sigue valiendo el ultimo, y se ve de
  // donde salio. Anotarlo es cambiarlo, no volver a escribirlo todos los dias.
  const shownWeight = log?.weight_kg ?? lastWeight?.kg ?? null;
  const [weightDraft, setWeightDraft] = useState(asText(shownWeight));

  // Los campos en los que esta escribiendo, desde la primera tecla hasta que lo suelta.
  // Solo esos guardan, y solo esos se quedan con lo suyo si lo guardado cambia mientras.
  const [typed, setTyped] = useState<Typed>({ sleep: false, steps: false, weight: false });
  const typing = (field: keyof Typed) =>
    setTyped((current) => (current[field] ? current : { ...current, [field]: true }));
  const done = (field: keyof Typed) => setTyped((current) => ({ ...current, [field]: false }));

  // Hoy se queda montado en el carrusel, asi que lo que guardan el asistente o el dia
  // abierto desde Registros no llegaba a estos campos: seguian con lo de antes.
  const [seen, setSeen] = useState({ slept, steps, shownWeight });
  if (seen.slept !== slept || seen.steps !== steps || seen.shownWeight !== shownWeight) {
    setSeen({ slept, steps, shownWeight });
    if (seen.slept !== slept && !typed.sleep) {
      setSleepHours(asText(sleptHours));
      setSleepMinutes(asText(sleptMinutes));
    }
    if (seen.steps !== steps && !typed.steps) setStepsDraft(asText(steps));
    if (seen.shownWeight !== shownWeight && !typed.weight) setWeightDraft(asText(shownWeight));
  }

  const commitSleep = () => {
    const total = typedSleep(sleepHours, sleepMinutes, typed.sleep);
    if (total === null) return;
    // El esquema pide de donde salio el dato, y escrito a mano es 'manual'. Sin
    // esto, escribir la hora antes de tocar un chip rompe la escritura.
    onLog({ sleepMinutes: total, sleepSource: log?.sleep_source ?? 'manual' });
    setSleepHours(String(Math.floor(total / 60)));
    setSleepMinutes(String(total % 60));
  };

  const waterMl = log?.water_ml ?? 0;
  const drinks = log?.alcohol_drinks ?? 0;

  if (!editing) {
    return <Summary log={log} waterTargetMl={waterTargetMl} lastWeight={lastWeight} />;
  }

  return (
    <View style={styles.wrapper}>
      <Field title="Agua" icon={Droplets} first>
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
      </Field>

      <Field title="Creatina" icon={Pill}>
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
      </Field>

      <Field title="Peso" icon={Scale}>
        <View style={styles.row}>
          <NumericField
            value={weightDraft}
            onChange={(next) => {
              setWeightDraft(next);
              typing('weight');
            }}
            allowDecimal
            accessibilityLabel="Peso corporal"
            placeholder="kg"
            onBlur={() => done('weight')}
            onCommit={() => {
              const kg = typedWeight(weightDraft, typed.weight, log?.weight_kg ?? null);
              if (kg !== null) onLog({ weightKg: kg });
            }}
            style={styles.input}
          />
          <Text style={styles.note}>
            {log?.weight_kg != null
              ? 'de hoy'
              : lastWeight
                ? `del ${shortDate(lastWeight.date)}`
                : 'sin pesarte todavía'}
          </Text>
        </View>
      </Field>

      <Field title="Sueño" icon={Moon}>
        {/* La casilla es la noche anterior, y decirlo evita anotar la de anteanoche
            el dia que se levanta tarde. Se puntua en este dia porque es la noche que
            sostiene lo que haga hoy. */}
        {log?.date && (
          <Text style={styles.note}>
            la noche del {dayOfMonth(addDays(log.date, -1))} al {dayOfMonth(log.date)}
          </Text>
        )}
        <View style={styles.row}>
          <NumericField
            value={sleepHours}
            onChange={(next) => {
              setSleepHours(next);
              typing('sleep');
            }}
            allowDecimal
            accessibilityLabel="Horas de sueño"
            placeholder="horas"
            onBlur={() => done('sleep')}
            onCommit={commitSleep}
            style={styles.input}
          />
          <NumericField
            value={sleepMinutes}
            onChange={(next) => {
              setSleepMinutes(next);
              typing('sleep');
            }}
            accessibilityLabel="Minutos de sueño"
            placeholder="min"
            onBlur={() => done('sleep')}
            onCommit={commitSleep}
            style={styles.input}
          />
        </View>
        <View style={styles.row}>
          {SLEEP_SOURCES.map((source) => (
            <Chip
              key={source.value}
              label={source.label}
              selected={log?.sleep_source === source.value}
              onPress={() => onLog({ sleepSource: source.value })}
            />
          ))}
        </View>
      </Field>

      <Field title="Pasos" icon={Footprints}>
        <NumericField
          value={stepsDraft}
          onChange={(next) => {
            setStepsDraft(next);
            typing('steps');
          }}
          accessibilityLabel="Pasos"
          placeholder="pasos"
          onBlur={() => done('steps')}
          onCommit={() => {
            const typedValue = typedSteps(stepsDraft, typed.steps);
            if (typedValue !== null) onLog({ steps: typedValue });
          }}
          style={styles.input}
        />
      </Field>

      <Field title="Alcohol" icon={Wine}>
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
        </View>
        {drinks > 0 && (
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Dentro de 6 h del entreno</Text>
            <Toggle
              value={log?.alcohol_after_training === 1}
              accessibilityLabel="Fue dentro de 6 horas del entreno"
              onChange={(next) => onLog({ alcoholAfterTraining: next })}
            />
          </View>
        )}
      </Field>
    </View>
  );
}

const styles = sheet((theme) => ({
  wrapper: {
    alignSelf: 'stretch',
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
  },
  lineLabel: {
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.textDim,
  },
  lineValue: {
    flex: 1,
    fontSize: 14,
    fontFamily: font.black,
    color: theme.text,
  },
  field: {
    gap: 7,
    paddingVertical: 12,
  },
  fieldRuled: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: 6,
    backgroundColor: theme.surfaceHigh,
  },
  title: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  value: {
    fontSize: 17,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  note: {
    fontSize: 12,
    color: theme.textFaint,
    fontFamily: font.regular,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 40,
  },
  switchLabel: {
    flexShrink: 1,
    fontSize: 14,
    fontFamily: font.bold,
    color: theme.text,
  },
  input: {
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.surface,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 16,
    minWidth: 92,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
}));
