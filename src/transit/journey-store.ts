import type { SQLiteDatabase } from 'expo-sqlite';
import { inTransaction, whenIdle } from '../db/transaction.ts';
import { DEFAULT_TRAVEL_PREFERENCES, parseJourneyState, type JourneyState } from './journey.ts';

export async function readJourneyState(db: SQLiteDatabase): Promise<JourneyState> {
  await whenIdle(db);
  const row = await db.getFirstAsync<{ content: string }>(
    'SELECT content FROM transit_journey_state WHERE id = 1;',
  );
  return row
    ? parseJourneyState(row.content)
    : { preferences: { ...DEFAULT_TRAVEL_PREFERENCES }, next: null };
}

export async function saveJourneyState(db: SQLiteDatabase, state: JourneyState): Promise<void> {
  const content = JSON.stringify(state);
  parseJourneyState(content);
  await inTransaction(db, async () => {
    await db.runAsync(
      'INSERT INTO transit_journey_state (id, content) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET content = excluded.content;',
      [content],
    );
    await db.runAsync('DELETE FROM transit_reminder_event WHERE journey_id <> ?;', [
      state.next?.id ?? '',
    ]);
  });
}
