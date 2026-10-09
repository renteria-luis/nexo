import { useState } from 'react';
import { Text, View } from 'react-native';

import { clockTime, shortDay, type IsoDate } from '../core/dates.ts';
import { hoursAndMinutes, thousands } from '../core/day-report.ts';
import { HEALTH_SOURCE_LABEL, type HealthResult } from '../core/health-import.ts';
import type { HealthMetric } from '../db/types.ts';
import type { HealthArrival } from '../shell/AppData.tsx';

import { Button } from './Button.tsx';
import { Card } from './Card.tsx';
import { font, sheet } from './theme.ts';

function amount(metric: HealthMetric, value: number): string {
  return metric === 'sleep' ? hoursAndMinutes(value) : thousands(value);
}

/** Lo que llego de un dato, en una linea: cuanto, de donde y, si lo dice, la noche. */
function line(result: HealthResult, today: IsoDate): string {
  const { metric, source, date, value, startedAt, endedAt } = result.reading;
  const label = `${metric === 'sleep' ? 'Sueño' : 'Pasos'}${date === today ? '' : ` del ${shortDay(date)}`}`;
  const from = HEALTH_SOURCE_LABEL[source];
  const before = result.current === null ? null : amount(metric, result.current);
  if (result.outcome === 'empty' || value === null) {
    return `${label}: sin datos de ${from}, no se cambió nada.`;
  }
  if (result.outcome === 'conflict') {
    return `${label}: anotaste ${before} a mano y ${from} dice ${amount(metric, value)}.`;
  }
  if (result.outcome === 'kept') return `${label}: se quedó el tuyo, ${before}.`;
  const night =
    startedAt !== null && endedAt !== null
      ? `, de ${clockTime(startedAt)} a ${clockTime(endedAt)}`
      : endedAt !== null
        ? `, hasta las ${clockTime(endedAt)}`
        : '';
  const replaced = before !== null && result.current !== value ? ` Antes: ${before}.` : '';
  return `${label}: ${amount(metric, value)} de ${from}${night}.${replaced}`;
}

/**
 * Lo que trajo el Atajo de iOS, dicho en Hoy, que es a donde lleva la app al recibirlo.
 *
 * Lo que el escribio a mano no se pisa sin preguntarle: cada choque trae sus dos botones,
 * y la cartilla no se cierra hasta que los contesta.
 */
export function HealthArrivalCard({
  arrival,
  today,
  onAnswer,
  onDismiss,
}: {
  arrival: HealthArrival;
  today: IsoDate;
  onAnswer: (metric: HealthMetric, replace: boolean) => Promise<void>;
  onDismiss: () => void;
}) {
  const [answering, setAnswering] = useState<HealthMetric | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const asking = arrival.results.some((result) => result.outcome === 'conflict');

  const answer = (metric: HealthMetric, replace: boolean) => {
    setAnswering(metric);
    setProblem(null);
    onAnswer(metric, replace)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(`No se pudo guardar: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => setAnswering(null));
  };

  return (
    <Card tone={arrival.problem === null ? 'info' : 'warn'}>
      <Text style={styles.title}>
        {arrival.problem === null ? 'Llegó del Atajo' : 'El Atajo no se pudo usar'}
      </Text>
      {arrival.problem !== null && <Text style={styles.text}>{arrival.problem}</Text>}
      {arrival.results.map((result) => (
        <View key={result.reading.metric} style={styles.result}>
          <Text style={styles.text}>{line(result, today)}</Text>
          {result.outcome === 'conflict' && (
            <View style={styles.buttons}>
              <Button
                label={`Usar ${HEALTH_SOURCE_LABEL[result.reading.source]}`}
                variant="primary"
                loading={answering === result.reading.metric}
                disabled={answering !== null}
                onPress={() => answer(result.reading.metric, true)}
              />
              <Button
                label="Dejar el mío"
                disabled={answering !== null}
                onPress={() => answer(result.reading.metric, false)}
              />
            </View>
          )}
        </View>
      ))}
      {problem !== null && <Text style={styles.problem}>{problem}</Text>}
      {!asking && (
        <Button
          label="Listo"
          accessibilityLabel="Cerrar lo que llegó del Atajo"
          onPress={onDismiss}
        />
      )}
    </Card>
  );
}

const styles = sheet((theme) => ({
  title: {
    fontSize: 15,
    fontFamily: font.black,
    color: theme.accentInk,
  },
  text: {
    fontSize: 13,
    fontFamily: font.regular,
    color: theme.accentInk,
  },
  result: {
    gap: 8,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  problem: {
    fontSize: 13,
    fontFamily: font.bold,
    color: theme.danger,
  },
}));
