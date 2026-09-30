import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';

import { appendMessage, lastChat, listChats, readChat, startChat } from './assistant.ts';

type SqlValue = string | number | null;

function fresh(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  return {
    getAllAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T[]> =>
      raw.prepare(source).all(...params) as T[],
    getFirstAsync: async <T>(source: string, params: SqlValue[] = []): Promise<T | null> =>
      (raw.prepare(source).get(...params) as T) ?? null,
    runAsync: async (source: string, params: SqlValue[] = []) => {
      raw.prepare(source).run(...params);
      return { changes: 0, lastInsertRowId: 0 };
    },
  } as unknown as SQLiteDatabase;
}

test('un chat guarda lo dicho en orden', async () => {
  const db = fresh();
  const chat = await startChat(db, new Date('2026-09-28T10:00:00Z'));

  await appendMessage(db, chat, 'me', 'pasos 8200', new Date('2026-09-28T10:00:01Z'));
  await appendMessage(db, chat, 'app', '8200 pasos', new Date('2026-09-28T10:00:02Z'));

  const said = await readChat(db, chat);
  assert.deepEqual(
    said.map((message) => [message.role, message.body]),
    [
      ['me', 'pasos 8200'],
      ['app', '8200 pasos'],
    ],
  );
});

test('el historial va del mas nuevo al mas viejo y se reconoce por lo que el escribio', async () => {
  const db = fresh();
  const old = await startChat(db, new Date('2026-09-20T10:00:00Z'));
  await appendMessage(db, old, 'me', 'agua 710', new Date('2026-09-20T10:00:01Z'));
  const recent = await startChat(db, new Date('2026-09-27T10:00:00Z'));
  await appendMessage(db, recent, 'app', 'buenas', new Date('2026-09-27T10:00:01Z'));
  await appendMessage(db, recent, 'me', 'peso 74.2', new Date('2026-09-27T10:00:02Z'));

  const chats = await listChats(db);
  assert.deepEqual(
    chats.map((chat) => chat.opener),
    ['peso 74.2', 'agua 710'],
  );
  assert.equal(await lastChat(db), recent);
});

test('sin ningun chat todavia no hay ninguno que abrir', async () => {
  assert.equal(await lastChat(fresh()), null);
});
