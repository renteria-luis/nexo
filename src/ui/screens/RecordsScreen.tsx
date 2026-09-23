import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { shortDate } from '../../core/dates.ts';
import { fromKg } from '../../core/units.ts';
import { useAppData } from '../../shell/AppData.tsx';
import {
  RECORD_SORTS,
  RECORD_WINDOWS,
  sortDayRows,
  type DayRow,
  type RecordSort,
  type RecordWindow,
} from '../../shell/records.ts';
import { ChevronRight } from 'lucide-react-native';

import { mono, theme } from '../theme.ts';

import { Screen } from './Screen.tsx';

const MISSING = '—';

/**
 * Todo lo registrado, del dia mas nuevo al mas viejo. El orden por defecto es ese
 * porque el 90% de las veces viene a ver lo de ayer; los otros ordenes son para
 * buscar el mejor dia o el mas cargado, que es otra pregunta distinta.
 */
export function RecordsScreen() {
  const { state, loadRecords } = useAppData();
  const navigation = useNavigation<{
    navigate: (name: string, params: { date: string }) => void;
  }>();

  const [window, setWindow] = useState<RecordWindow>('month');
  const [sort, setSort] = useState<RecordSort>('recent');
  const [rows, setRows] = useState<DayRow[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const reload = useCallback(() => {
    loadRecords(window)
      .then(setRows)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(error instanceof Error ? error.message : String(error));
      });
  }, [loadRecords, window]);

  useEffect(reload, [reload]);

  if (state.phase !== 'ready') return <Screen>{null}</Screen>;
  const unit = state.loaded.unit;

  const sorted = rows === null ? [] : sortDayRows(rows, sort);

  return (
    <Screen>
      <Text style={styles.label}>periodo</Text>
      <View style={styles.chips}>
        {RECORD_WINDOWS.map((option) => (
          <Pressable
            key={option.id}
            accessibilityLabel={`Ver ${option.label}`}
            onPress={() => setWindow(option.id)}
            style={[styles.chip, option.id === window && styles.chipSelected]}
          >
            <Text style={[styles.chipText, option.id === window && styles.chipTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>ordenar por</Text>
      <View style={styles.chips}>
        {RECORD_SORTS.map((option) => (
          <Pressable
            key={option.id}
            accessibilityLabel={`Ordenar por ${option.label}`}
            onPress={() => setSort(option.id)}
            style={[styles.chip, option.id === sort && styles.chipSelected]}
          >
            <Text style={[styles.chipText, option.id === sort && styles.chipTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {rows !== null && rows.length === 0 && (
        <Text style={styles.empty}>No hay nada registrado en este periodo.</Text>
      )}

      {sorted.map((row) => (
        <Pressable
          key={row.date}
          accessibilityLabel={`Ver el ${shortDate(row.date)}`}
          onPress={() => navigation.navigate('Día', { date: row.date })}
          style={styles.row}
        >
          <Text style={styles.rowScore}>
            {row.score === null ? MISSING : Math.round(row.score)}
          </Text>
          <View style={styles.rowBody}>
            <Text style={styles.rowDate}>{shortDate(row.date)}</Text>
            <Text style={styles.rowDetail}>
              {[
                row.trained ? 'entrenó' : row.restDay ? 'descanso' : 'sin entreno',
                row.volume > 0 ? `${Math.round(fromKg(row.volume, unit))} ${unit}` : null,
                row.proteinG === null ? null : `${Math.round(row.proteinG)} g prot`,
                row.kcal === null ? null : `${Math.round(row.kcal)} kcal`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <ChevronRight size={18} color={theme.textGhost} strokeWidth={1.75} />
        </Pressable>
      ))}

      {problem && <Text style={styles.problem}>{problem}</Text>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    color: theme.textGhost,
    fontFamily: mono,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
    borderColor: theme.accent,
    backgroundColor: theme.accent,
  },
  chipText: {
    fontSize: 12,
    color: theme.text,
    fontFamily: mono,
  },
  chipTextSelected: {
    color: theme.accentInk,
  },
  empty: {
    fontSize: 12,
    color: theme.textGhost,
    marginTop: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingVertical: 12,
  },
  rowScore: {
    fontSize: 20,
    color: theme.text,
    fontFamily: mono,
    width: 42,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowDate: {
    fontSize: 14,
    color: theme.text,
    fontFamily: mono,
  },
  rowDetail: {
    fontSize: 11,
    color: theme.textFaint,
    fontFamily: mono,
  },
  problem: {
    fontSize: 12,
    color: theme.danger,
  },
});
