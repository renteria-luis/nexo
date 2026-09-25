// El plan de avisos de los proximos dias, sacado de la base.
//
// iOS no deja pensar en segundo plano: lo que se programa hoy es lo que sonara
// manana, se abra la app o no. Por eso se programan varios dias por delante y se
// rehace el plan en cada arranque y despues de cada cosa que anota, que es cuando
// cambia la respuesta a "esto ya lo hizo".
//
// De los dias que todavia no empiezan no se sabe nada, asi que se planean vacios: lo
// unico que sobrevive de ellos es el aviso de cierre, que es justamente la red que
// hay que tender cuando lleva dias sin abrir la app.

import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays, type IsoDate } from '../core/dates.ts';
import { trainingDebt } from '../core/discipline.ts';
import {
  DEFAULT_NUDGE_RULES,
  learnHours,
  nudgesFor,
  silencedKinds,
  type HourSample,
  type Nudge,
  type NudgeDay,
  type NudgeKind,
  type NudgeRecord,
} from '../core/nudges.ts';
import { nudgesEnabled, nudgesOffFrom, readSettings } from '../core/settings.ts';
import type { CoreNudgeRow } from '../db/types.ts';
import { listSessionDates, sessionsInTrailingWeek } from '../training/index.ts';

import { assembleDay } from './day.ts';

/** Tres dias por delante: unos veinte avisos, muy por debajo del tope de iOS. */
export const SCHEDULE_DAYS = 3;
/** De donde se sacan sus horas y lo que viene ignorando. */
const HISTORY_DAYS = 90;

function minuteOf(timestamp: number): number {
  const when = new Date(timestamp);
  return when.getHours() * 60 + when.getMinutes();
}

async function hourSamples(db: SQLiteDatabase, from: IsoDate): Promise<HourSample[]> {
  const rows = await db.getAllAsync<{
    kind: 'comida' | 'entreno';
    slot: string | null;
    date: IsoDate;
    timestamp: number;
  }>(
    `SELECT 'comida' AS kind, meal_slot AS slot, date, timestamp
       FROM nutrition_food_entry
      WHERE date >= ?
      UNION ALL
     SELECT 'entreno' AS kind, NULL AS slot, date, start_time AS timestamp
       FROM training_session
      WHERE date >= ?;`,
    [from, from],
  );

  return rows.map((row) => ({
    kind: row.kind,
    slot: row.slot ?? undefined,
    date: row.date,
    minute: minuteOf(row.timestamp),
  }));
}

async function sentNudges(db: SQLiteDatabase, from: IsoDate): Promise<NudgeRecord[]> {
  const rows = await db.getAllAsync<CoreNudgeRow>(
    'SELECT * FROM core_nudge WHERE date >= ? ORDER BY date;',
    [from],
  );
  return rows.map((row) => ({
    kind: row.kind as NudgeKind,
    date: row.date,
    actedAt: row.acted_at,
  }));
}

export async function nudgePlan(
  db: SQLiteDatabase,
  today: IsoDate,
  days = SCHEDULE_DAYS,
): Promise<Nudge[]> {
  const settings = await readSettings(db);
  if (!nudgesEnabled(settings)) return [];

  const since = addDays(today, -HISTORY_DAYS);
  const [assembled, sessionDates, samples, records] = await Promise.all([
    assembleDay(db, today, today),
    listSessionDates(db, { from: since, to: today }),
    hourSamples(db, since),
    sentNudges(db, since),
  ]);

  const filled = await db.getAllAsync<{ slot: string }>(
    'SELECT DISTINCT meal_slot AS slot FROM nutrition_food_entry WHERE date = ?;',
    [today],
  );

  const debt = trainingDebt(sessionsInTrailingWeek(sessionDates, today));
  // Sin metas no hay meta de agua, y sin meta no hay nada que reclamar.
  const waterTargetMl = assembled.targets
    ? assembled.trained === true
      ? assembled.targets.waterMlTraining
      : assembled.targets.waterMlRest
    : 0;

  const now: NudgeDay = {
    date: today,
    filledSlots: filled.map((row) => row.slot),
    trained: assembled.trained === true,
    restDay: assembled.log?.rest_day === 1,
    trainingDebt: debt,
    waterMl: assembled.log?.water_ml ?? null,
    waterTargetMl,
    sleepMinutes: assembled.log?.sleep_minutes ?? null,
    weightKg: assembled.log?.weight_kg ?? null,
    criteriaWithData: assembled.result?.criteriaWithData ?? 0,
  };

  const rules = {
    ...DEFAULT_NUDGE_RULES,
    silenced: [...silencedKinds(records, today), ...(nudgesOffFrom(settings) as NudgeKind[])],
  };

  const plan = nudgesFor(now, learnHours(samples), rules);

  for (let ahead = 1; ahead < days; ahead += 1) {
    const date = addDays(today, ahead);
    plan.push(
      ...nudgesFor(
        {
          ...now,
          date,
          // De un dia que no ha empezado no hay nada anotado todavia.
          filledSlots: [],
          trained: false,
          restDay: false,
          waterMl: null,
          sleepMinutes: null,
          weightKg: null,
          criteriaWithData: 0,
        },
        learnHours(samples),
        rules,
      ),
    );
  }

  return plan;
}

/** Deja escrito que se programo, para poder saber despues si lo ignoro. */
export async function recordNudges(
  db: SQLiteDatabase,
  plan: readonly Nudge[],
  now = Date.now(),
): Promise<void> {
  for (const nudge of plan) {
    await db.runAsync(
      `INSERT INTO core_nudge (id, kind, date, sent_at, acted_at)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT (id) DO NOTHING;`,
      [nudge.id, nudge.kind, nudge.date, now],
    );
  }
}

/** Y que si hizo caso, que es lo unico que distingue un recordatorio del ruido. */
export async function recordNudgeAction(
  db: SQLiteDatabase,
  nudgeId: string,
  now = Date.now(),
): Promise<void> {
  await db.runAsync('UPDATE core_nudge SET acted_at = ? WHERE id = ? AND acted_at IS NULL;', [
    now,
    nudgeId,
  ]);
}
