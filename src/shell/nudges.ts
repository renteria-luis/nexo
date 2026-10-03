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

import { readDailyLog, upsertDailyLog } from '../core/daily-log.ts';
import { addDays, type IsoDate } from '../core/dates.ts';
import { trainingDebt } from '../core/discipline.ts';
import {
  DEFAULT_NUDGE_RULES,
  WATER_ACTION_ML,
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
    firesAt: row.fires_at,
  }));
}

/** La hora local a la que sale un aviso. */
export function fireAt(nudge: Nudge): Date {
  const [year, month, day] = nudge.date.split('-').map(Number);
  return new Date(year, month - 1, day, Math.floor(nudge.atMinute / 60), nudge.atMinute % 60, 0);
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
    creatineLogged: assembled.log?.creatine_taken != null,
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
          creatineLogged: false,
        },
        learnHours(samples),
        rules,
      ),
    );
  }

  return plan;
}

/** Un aviso que quedo programado en iOS, y la hora a la que sale. */
export type Scheduled = { nudge: Nudge; firesAt: number };

/**
 * Deja escrito lo que se acaba de programar y lo que paso con lo de antes, que es lo que
 * despues dice si lo ignoro (spec 18.2 regla 4).
 *
 * Lo que estaba programado y ya no esta, sin haber llegado su hora, se cancelo antes de
 * salir: no lo vio, asi que se borra. Lo de hoy que ya salio y ya no esta en el plan es
 * que anoto lo que pedia: eso tambien es hacer caso, aunque no tocara el aviso.
 */
export async function recordNudges(
  db: SQLiteDatabase,
  plan: readonly Nudge[],
  scheduled: readonly Scheduled[],
  today: IsoDate,
  now = Date.now(),
): Promise<void> {
  const planned = new Set(plan.map((nudge) => nudge.id));
  const kept = new Set(scheduled.map(({ nudge }) => nudge.id));

  const pending = await db.getAllAsync<{ id: string; date: IsoDate; fires_at: number }>(
    `SELECT id, date, fires_at FROM core_nudge
      WHERE acted_at IS NULL AND fires_at IS NOT NULL AND date >= ?;`,
    [today],
  );
  for (const row of pending) {
    if (row.fires_at > now) {
      if (!kept.has(row.id)) await db.runAsync('DELETE FROM core_nudge WHERE id = ?;', [row.id]);
    } else if (row.date === today && !planned.has(row.id)) {
      await db.runAsync('UPDATE core_nudge SET acted_at = ? WHERE id = ?;', [now, row.id]);
    }
  }

  for (const { nudge, firesAt } of scheduled) {
    // La hora puede moverse de un dia para otro, porque se aprende de el.
    await db.runAsync(
      `INSERT INTO core_nudge (id, kind, date, sent_at, acted_at, fires_at)
       VALUES (?, ?, ?, ?, NULL, ?)
       ON CONFLICT (id) DO UPDATE SET fires_at = excluded.fires_at WHERE acted_at IS NULL;`,
      [nudge.id, nudge.kind, nudge.date, now, firesAt],
    );
  }
}

/**
 * Y que si hizo caso, que es lo unico que distingue un recordatorio del ruido. Devuelve si
 * es la primera vez: un toque que llega dos veces no se vuelve a aplicar. Si el aviso no
 * quedo anotado al programarlo (uno de una version anterior), se anota aqui: el toque vale
 * igual.
 */
export async function recordNudgeAction(
  db: SQLiteDatabase,
  { nudgeId, kind }: { nudgeId: string; kind: NudgeKind },
  date: IsoDate,
  now = Date.now(),
): Promise<boolean> {
  const result = await db.runAsync(
    `INSERT INTO core_nudge (id, kind, date, sent_at, acted_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET acted_at = excluded.acted_at
      WHERE core_nudge.acted_at IS NULL;`,
    [nudgeId, kind, date, now, now],
  );
  return result.changes === 1;
}

/**
 * Lo que toco en un aviso, aplicado una sola vez y en el mismo sitio que si lo hubiera
 * anotado en la app (spec 18.3). El mismo toque puede llegar dos veces, por lo que guardo
 * iOS al abrir y por el oyente, y la segunda no puede sumar otra botella.
 */
export async function applyNudgeAction(
  db: SQLiteDatabase,
  { nudgeId, kind, action }: { nudgeId: string; kind: NudgeKind; action: string },
  date: IsoDate,
  now = Date.now(),
): Promise<void> {
  if (!(await recordNudgeAction(db, { nudgeId, kind }, date, now))) return;
  if (action === 'descanso') await upsertDailyLog(db, { date, restDay: true });
  if (action === 'agua') {
    const log = await readDailyLog(db, date);
    await upsertDailyLog(db, { date, waterMl: (log?.water_ml ?? 0) + WATER_ACTION_ML });
  }
}
