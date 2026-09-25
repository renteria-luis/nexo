import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { shortDate } from '../core/dates.ts';
import { hoursAndMinutes, litres, thousands } from '../core/day-report.ts';
import { fromKg, type WeightUnit } from '../core/units.ts';
import type { DayDetail } from '../shell/records.ts';

import { mono, theme } from './theme.ts';

const MISSING = '—';

export type DayDialogProps = {
  date: string;
  unit: WeightUnit;
  load: (date: string) => Promise<DayDetail>;
  onClose: () => void;
  onOpenDetail: () => void;
};

/**
 * El vistazo rapido de un dia: la nota, si entreno y lo que comio. Lo que no cabe
 * aqui vive un toque mas adentro, para que tocar un cuadrito no sea abrir una
 * pantalla entera cuando solo querias acordarte de que pasó ese martes.
 */
export function DayDialog({ date, unit, load, onClose, onOpenDetail }: DayDialogProps) {
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load(date)
      .then((loaded) => {
        if (!cancelled) setDetail(loaded);
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setProblem(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [load, date]);

  const day = detail?.day ?? null;
  const report = detail?.report ?? null;

  const rows: { label: string; value: string }[] = [
    {
      label: 'entreno',
      value:
        day === null
          ? MISSING
          : day.session
            ? `${detail?.routineName ?? 'suelto'} · ${Math.round(fromKg(day.sessionVolume, unit))} ${unit}`
            : day.log?.rest_day === 1
              ? 'descanso planeado'
              : 'sin entreno',
    },
    {
      label: 'comida',
      value:
        day?.nutrition == null
          ? MISSING
          : `${Math.round(day.nutrition.kcal)} kcal · ${Math.round(day.nutrition.proteinG)} g prot`,
    },
    {
      label: 'sueño',
      value: day?.log?.sleep_minutes == null ? MISSING : hoursAndMinutes(day.log.sleep_minutes),
    },
    { label: 'agua', value: day?.log?.water_ml == null ? MISSING : litres(day.log.water_ml) },
    { label: 'pasos', value: day?.log?.steps == null ? MISSING : thousands(day.log.steps) },
  ];

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable accessibilityLabel="Cerrar" onPress={onClose} style={styles.backdrop}>
        {/* El toque de dentro no cierra: solo el de fuera. */}
        <Pressable style={styles.card} onPress={() => undefined}>
          <View style={styles.head}>
            <Text style={styles.date}>{shortDate(date)}</Text>
            <Text style={styles.score}>
              {report?.score == null ? MISSING : Math.round(report.score)}
            </Text>
          </View>

          {report?.noScore === 'sin-metas' && (
            <Text style={styles.why}>Sin nota: faltan tus metas en Ajustes.</Text>
          )}
          {report?.noScore === 'pocos-datos' && (
            <Text style={styles.why}>Sin nota: no anotaste nada ese día.</Text>
          )}
          {/* La nota es sobre cien, asi que un dia a medio anotar y un dia malo dan
              parecido. Esta linea es la que los separa. */}
          {report !== null && report.score !== null && report.pointsWithoutData > 0 && (
            <Text style={styles.why}>
              {Math.round(report.pointsWithoutData)} puntos sin anotar de los 100 del día.
            </Text>
          )}

          {rows.map((row) => (
            <View key={row.label} style={styles.row}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowValue}>{row.value}</Text>
            </View>
          ))}

          {problem && <Text style={styles.problem}>{problem}</Text>}

          <View style={styles.buttons}>
            <Pressable accessibilityLabel="Cerrar" onPress={onClose} style={styles.close}>
              <Text style={styles.closeText}>cerrar</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Ver detalles del día"
              onPress={onOpenDetail}
              style={styles.open}
            >
              <Text style={styles.openText}>Ver detalles</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    padding: 16,
    gap: 8,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  date: {
    fontSize: 16,
    color: theme.text,
    fontFamily: mono,
  },
  score: {
    fontSize: 30,
    color: theme.text,
    fontFamily: mono,
  },
  why: {
    fontSize: 11,
    color: theme.warn,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  rowLabel: {
    fontSize: 12,
    color: theme.textGhost,
    fontFamily: mono,
    width: 62,
  },
  rowValue: {
    flex: 1,
    fontSize: 13,
    color: theme.text,
    fontFamily: mono,
  },
  problem: {
    fontSize: 11,
    color: theme.danger,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  close: {
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  closeText: {
    fontSize: 13,
    color: theme.textGhost,
    fontFamily: mono,
  },
  open: {
    borderWidth: 1,
    borderColor: theme.accent,
    backgroundColor: theme.accent,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  openText: {
    fontSize: 13,
    color: theme.accentInk,
    fontFamily: mono,
  },
});
