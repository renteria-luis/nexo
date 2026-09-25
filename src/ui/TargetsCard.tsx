import { StyleSheet, Text, View } from 'react-native';

import { fatBand, kcalBand, proteinBand, type TargetValues } from '../core/targets.ts';
import { mono, theme } from './theme.ts';

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
    <View style={styles.card}>
      <Text style={styles.heading}>Metas de hoy</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  heading: {
    fontSize: 14,
    fontFamily: mono,
    color: theme.text,
  },
  basis: {
    fontSize: 11,
    color: theme.textGhost,
    marginBottom: 4,
    fontFamily: mono,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  label: {
    fontSize: 13,
    color: theme.textDim,
    fontFamily: mono,
  },
  values: {
    alignItems: 'flex-end',
  },
  value: {
    fontSize: 13,
    fontFamily: mono,
    color: theme.text,
  },
  note: {
    fontSize: 11,
    color: theme.textGhost,
  },
});
