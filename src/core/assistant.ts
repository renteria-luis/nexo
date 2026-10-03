// Lo que se habla con el asistente, leido y escrito. Migracion 047.
//
// Un chat no existe hasta que hay algo escrito en el: abrir uno nuevo y no decir nada
// no deja una fila vacia en el historial.

import type { SQLiteDatabase } from 'expo-sqlite';

import type { AssistantRole, CoreAssistantMessageRow } from '../db/types.ts';

/** Una conversacion en la lista del historial, con la primera cosa que el escribio. */
export type ChatSummary = {
  id: string;
  startedAt: string;
  /** Lo primero que dijo, que es como se reconoce un chat. Vacio si solo hablo la app. */
  opener: string;
};

export type ChatMessage = {
  id: string;
  role: AssistantRole;
  body: string;
  createdAt: string;
};

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export async function startChat(db: SQLiteDatabase, at: Date = new Date()): Promise<string> {
  const id = newId('chat');
  await db.runAsync('INSERT INTO core_assistant_chat (id, started_at) VALUES (?, ?);', [
    id,
    at.toISOString(),
  ]);
  return id;
}

export async function appendMessage(
  db: SQLiteDatabase,
  chatId: string,
  role: AssistantRole,
  body: string,
  at: Date = new Date(),
): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: newId('msg'),
    role,
    body,
    createdAt: at.toISOString(),
  };
  await db.runAsync(
    'INSERT INTO core_assistant_message (id, chat_id, role, body, created_at) VALUES (?, ?, ?, ?, ?);',
    [message.id, chatId, message.role, message.body, message.createdAt],
  );
  return message;
}

/**
 * Las lineas de un chat, de la primera a la ultima. Con `limit`, solo las ultimas: la
 * bola siempre abre el ultimo chat, y un chat de meses se leia y se dibujaba entero cada
 * vez que se tocaba, entre serie y serie.
 */
export async function readChat(
  db: SQLiteDatabase,
  chatId: string,
  limit?: number,
): Promise<ChatMessage[]> {
  const rows =
    limit === undefined
      ? await db.getAllAsync<CoreAssistantMessageRow>(
          'SELECT * FROM core_assistant_message WHERE chat_id = ? ORDER BY created_at, rowid;',
          [chatId],
        )
      : await db.getAllAsync<CoreAssistantMessageRow>(
          `SELECT * FROM (
             SELECT *, rowid AS position FROM core_assistant_message
              WHERE chat_id = ?
           ORDER BY created_at DESC, rowid DESC
              LIMIT ?
           ) ORDER BY created_at, position;`,
          [chatId, limit],
        );
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    body: row.body,
    createdAt: row.created_at,
  }));
}

/** Los chats del mas nuevo al mas viejo. Solo se leen cuando abre el historial. */
export async function listChats(db: SQLiteDatabase, limit = 40): Promise<ChatSummary[]> {
  const rows = await db.getAllAsync<{ id: string; started_at: string; opener: string | null }>(
    `SELECT c.id,
            c.started_at,
            (SELECT m.body
               FROM core_assistant_message m
              WHERE m.chat_id = c.id AND m.role = 'me'
              ORDER BY m.created_at, m.rowid
              LIMIT 1) AS opener
       FROM core_assistant_chat c
      ORDER BY c.started_at DESC
      LIMIT ?;`,
    [limit],
  );
  return rows.map((row) => ({ id: row.id, startedAt: row.started_at, opener: row.opener ?? '' }));
}

/** El chat en el que estaba, para no abrir uno nuevo cada vez que toca la bola. */
export async function lastChat(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM core_assistant_chat ORDER BY started_at DESC LIMIT 1;',
  );
  return row?.id ?? null;
}
