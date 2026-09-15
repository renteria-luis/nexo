// Spec 5.11. One thing changed, one number logged, and a date on both ends. The
// dairy question in spec 7.5 is the reason this exists: the literature is mixed
// enough that eight weeks of his own skin says more to him than the meta-analyses.

import type { SQLiteDatabase } from 'expo-sqlite';

import type { CoreExperimentReadingRow, CoreExperimentRow } from '../db/types.ts';

import { daysBetween, type IsoDate } from './dates.ts';

export type NewExperiment = {
  name: string;
  hypothesis: string;
  variableChanged: string;
  startDate: IsoDate;
  outcomeMetric: string;
  notes?: string | null;
};

export type ExperimentWithReadings = {
  experiment: CoreExperimentRow;
  readings: CoreExperimentReadingRow[];
  /** Whole weeks since it started, which is how spec 7.5 counts the dairy test. */
  weeksRunning: number;
  /** The average before and after the halfway point, null until both halves exist. */
  halves: { first: number; second: number } | null;
};

export async function startExperiment(
  db: SQLiteDatabase,
  experiment: NewExperiment,
): Promise<string> {
  for (const [field, value] of [
    ['name', experiment.name],
    ['hypothesis', experiment.hypothesis],
    ['variable', experiment.variableChanged],
    ['metric', experiment.outcomeMetric],
  ] as const) {
    if (value.trim() === '') throw new Error(`an experiment without a ${field} proves nothing`);
  }

  const id = `experiment-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await db.runAsync(
    `INSERT INTO core_experiment
       (id, name, hypothesis, variable_changed, start_date, end_date, outcome_metric, notes)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?);`,
    [
      id,
      experiment.name.trim(),
      experiment.hypothesis.trim(),
      experiment.variableChanged.trim(),
      experiment.startDate,
      experiment.outcomeMetric.trim(),
      experiment.notes?.trim() || null,
    ],
  );
  return id;
}

export async function endExperiment(
  db: SQLiteDatabase,
  experimentId: string,
  endDate: IsoDate,
): Promise<void> {
  const experiment = await db.getFirstAsync<CoreExperimentRow>(
    'SELECT * FROM core_experiment WHERE id = ?;',
    [experimentId],
  );
  if (!experiment) throw new Error(`there is no experiment called ${experimentId}`);
  if (endDate < experiment.start_date) {
    throw new Error('an experiment cannot end before it started');
  }
  await db.runAsync('UPDATE core_experiment SET end_date = ? WHERE id = ?;', [
    endDate,
    experimentId,
  ]);
}

/** One reading per day: a second one on the same day replaces the first. */
export async function addReading(
  db: SQLiteDatabase,
  experimentId: string,
  date: IsoDate,
  value: number,
  note?: string | null,
): Promise<void> {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${value} is not a reading`);
  await db.runAsync(
    `INSERT INTO core_experiment_reading (experiment_id, date, value, note)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (experiment_id, date) DO UPDATE SET value = excluded.value, note = excluded.note;`,
    [experimentId, date, value, note?.trim() || null],
  );
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export async function listExperiments(
  db: SQLiteDatabase,
  onDate: IsoDate,
): Promise<ExperimentWithReadings[]> {
  const [experiments, readings] = await Promise.all([
    db.getAllAsync<CoreExperimentRow>(
      'SELECT * FROM core_experiment ORDER BY start_date DESC, rowid DESC;',
    ),
    db.getAllAsync<CoreExperimentReadingRow>(
      'SELECT * FROM core_experiment_reading ORDER BY date;',
    ),
  ]);

  return experiments.map((experiment) => {
    const mine = readings.filter((reading) => reading.experiment_id === experiment.id);
    const until = experiment.end_date ?? onDate;

    // Half the readings against the other half. Crude on purpose: with one subject
    // and a handful of weekly readings, anything fancier would dress up noise.
    const half = Math.floor(mine.length / 2);
    const halves =
      mine.length >= 4
        ? {
            first: mean(mine.slice(0, half).map((reading) => reading.value)),
            second: mean(mine.slice(mine.length - half).map((reading) => reading.value)),
          }
        : null;

    return {
      experiment,
      readings: mine,
      weeksRunning: Math.max(0, Math.floor(daysBetween(experiment.start_date, until) / 7)),
      halves,
    };
  });
}
