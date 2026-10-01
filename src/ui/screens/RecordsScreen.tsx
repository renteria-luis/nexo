import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { shortDate } from '../../core/dates.ts';
import { scoreText } from '../../core/day-report.ts';
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

import { Card } from '../Card.tsx';
import { Chip } from '../Chip.tsx';
import { ChevronRight } from '../icons.ts';
import { font, sheet, shape, theme } from '../theme.ts';

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

  if (state.phase !== 'ready') return <Screen title="Registros">{null}</Screen>;
  const unit = state.loaded.unit;

  const sorted = rows === null ? [] : sortDayRows(rows, sort);

  return (
    <Screen title="Registros">
      <Card>
        <Text style={styles.label}>Periodo</Text>
        <View style={styles.chips}>
          {RECORD_WINDOWS.map((option) => (
            <Chip
              key={option.id}
              label={option.label}
              accessibilityLabel={`Ver ${option.label}`}
              selected={option.id === window}
              onPress={() => setWindow(option.id)}
            />
          ))}
        </View>

        <Text style={styles.label}>Ordenar por</Text>
        <View style={styles.chips}>
          {RECORD_SORTS.map((option) => (
            <Chip
              key={option.id}
              label={option.label}
              accessibilityLabel={`Ordenar por ${option.label}`}
              selected={option.id === sort}
              onPress={() => setSort(option.id)}
            />
          ))}
        </View>
      </Card>

      {problem && <Text style={styles.problem}>{problem}</Text>}

      {rows !== null && rows.length === 0 && (
        <Card>
          <Text style={styles.empty}>No hay nada registrado en este periodo.</Text>
        </Card>
      )}

      {sorted.length > 0 && (
        <Card>
          {sorted.map((row, index) => (
            <Pressable
              key={row.date}
              accessibilityRole="button"
              accessibilityLabel={`Ver el ${shortDate(row.date)}`}
              onPress={() => navigation.navigate('Día', { date: row.date })}
              style={({ pressed }) => [
                styles.row,
                index > 0 && styles.ruled,
                pressed && styles.rowPressed,
              ]}
            >
              {/* La nota en su casilla: es lo primero que se busca al recorrer la
                  lista, y un numero suelto en una fila se pierde entre el texto. */}
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {row.score === null ? MISSING : scoreText(row.score)}
                </Text>
              </View>
              <View style={styles.body}>
                <Text style={styles.date}>{shortDate(row.date)}</Text>
                <Text style={styles.detail}>
                  {[
                    row.trained
                      ? `entrenó${row.routineName === null ? '' : ` (${row.routineName})`}`
                      : row.restDay
                        ? 'descanso'
                        : 'sin entreno',
                    row.volume > 0 ? `${Math.round(fromKg(row.volume, unit))} ${unit}` : null,
                    row.proteinG === null ? null : `${Math.round(row.proteinG)} g prot`,
                    row.kcal === null ? null : `${Math.round(row.kcal)} kcal`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <ChevronRight size={18} color={theme.textFaint} strokeWidth={2.5} />
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = sheet((theme) => ({
  label: {
    fontSize: 12,
    fontFamily: font.black,
    letterSpacing: 0.6,
    color: theme.textFaint,
    textTransform: 'uppercase',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  empty: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.textFaint,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  ruled: {
    borderTopWidth: shape.border,
    borderTopColor: theme.line,
  },
  rowPressed: {
    opacity: 0.55,
  },
  badge: {
    minWidth: 46,
    minHeight: 40,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: shape.border,
    borderColor: theme.line,
    borderRadius: shape.radiusSmall,
    backgroundColor: theme.bg,
  },
  badgeText: {
    fontSize: 18,
    fontFamily: font.black,
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  body: {
    flex: 1,
    gap: 2,
  },
  date: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.text,
  },
  detail: {
    fontSize: 12,
    fontFamily: font.regular,
    color: theme.textFaint,
    fontVariant: ['tabular-nums'],
  },
  problem: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.danger,
  },
}));
