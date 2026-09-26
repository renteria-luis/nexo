import { Text, View } from 'react-native';

import { fatBand, kcalBand, proteinBand, type TargetValues } from '../core/targets.ts';
import { Card } from './Card.tsx';
import { font, sheet } from './theme.ts';

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.values}>
        <Text style={styles.value}>{value}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
    </View>
  );
}

export function TargetsCard({ targets }: { targets: TargetValues }) {
  const kcal = kcalBand(targets);
  const protein = proteinBand(targets);
  const fat = fatBand(targets);

  return (
    <Card title="Metas de hoy">
      <Text style={styles.basis}>Calculadas sobre {targets.weightBasisKg} kg</Text>

      <Row
        label="Calorías"
        value={`${targets.kcal} kcal`}
        note={`banda ${kcal.from} a ${kcal.to}`}
      />
      <Row
        label="Proteína"
        value={`${targets.proteinG} g`}
        note={`banda ${protein.from} a ${protein.to}`}
      />
      <Row
        label="Grasa"
        value={`${targets.fatG} g`}
        note={`banda ${fat.from} a ${fat.to}, piso ${fat.hardFloor}`}
      />
      <Row label="Carbohidratos" value={`${targets.carbsG} g`} />
      <Row
        label="Agua"
        value={`${(targets.waterMlTraining / 1000).toFixed(1)} L`}
        note={`${(targets.waterMlRest / 1000).toFixed(1)} L en día de descanso`}
      />
      <Row
        label="Sueño"
        value={`${Math.floor(targets.sleepMinutes / 60)} h ${targets.sleepMinutes % 60} min`}
      />
      <Row label="Pasos" value={`${targets.steps}`} />
    </Card>
  );
}

const styles = sheet((theme) => ({
  basis: {
    fontSize: 12,
    color: theme.textFaint,
    marginBottom: 2,
    fontFamily: font.regular,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  label: {
    fontSize: 14,
    color: theme.text,
    fontFamily: font.bold,
  },
  values: {
    alignItems: 'flex-end',
  },
  value: {
    fontSize: 14,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  note: {
    fontSize: 11,
    color: theme.textFaint,
    fontFamily: font.regular,
    fontVariant: ['tabular-nums'],
  },
}));
