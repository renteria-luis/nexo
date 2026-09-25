import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DatabaseSync } from 'node:sqlite';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';

import {
  fold,
  loadFoodHistory,
  matchesSearch,
  summarizeFoodHistory,
  type FoodEntryTrace,
} from './picker.ts';
import { addFoodEntry } from './queries.ts';

function entry(
  foodId: string,
  mealSlot: string,
  timestamp: number,
  quantity = 1,
  date = '2026-09-20',
): FoodEntryTrace {
  return { foodId, mealSlot, quantity, unit: 'unidad', date, timestamp };
}

test('el historial sale de la base tal cual lo anoto', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const migration of migrations) raw.exec(migration.sql);
  const db = {
    getAllAsync: async <T>(source: string, params: (string | number)[] = []): Promise<T[]> =>
      raw.prepare(source).all(...params) as T[],
    runAsync: async (source: string, params: (string | number | null)[] = []) => {
      raw.prepare(source).run(...params);
      return { changes: 0, lastInsertRowId: 0 };
    },
  } as unknown as SQLiteDatabase;

  await addFoodEntry(db, {
    date: '2026-09-23',
    foodId: 'eggs-costco-xl',
    quantity: 6,
    unit: 'huevo',
    mealSlot: 'desayuno',
  });
  await addFoodEntry(db, {
    date: '2026-09-24',
    foodId: 'protein-bar-60g',
    quantity: 1,
    unit: 'unidad',
    mealSlot: 'tarde',
  });

  const history = await loadFoodHistory(db, '2026-09-24');
  assert.deepEqual(history.usualBySlot.get('desayuno'), ['eggs-costco-xl']);
  assert.equal(history.lastQuantity.get('eggs-costco-xl'), 6);
  // Los dos se guardan en el mismo milisegundo, asi que aqui solo importa que esten
  // los dos: el orden por recencia se prueba aparte, con sellos de tiempo distintos.
  assert.deepEqual([...history.recent].sort(), ['eggs-costco-xl', 'protein-bar-60g']);

  // Fuera de la ventana no cuenta nada.
  const narrow = await loadFoodHistory(db, '2026-09-24', 1);
  assert.deepEqual(narrow.recent, ['protein-bar-60g']);
});

test('lo que mas come en un espacio de comida sale primero en ese espacio', () => {
  const history = summarizeFoodHistory([
    entry('huevos', 'desayuno', 10),
    entry('huevos', 'desayuno', 20),
    entry('huevos', 'desayuno', 30),
    entry('barra', 'desayuno', 40),
    entry('pollo', 'mediodía', 50),
    entry('pollo', 'mediodía', 60),
    entry('pasta', 'mediodía', 70),
  ]);

  assert.deepEqual(history.usualBySlot.get('desayuno'), ['huevos', 'barra']);
  assert.deepEqual(history.usualBySlot.get('mediodía'), ['pollo', 'pasta']);
  // Un espacio en el que nunca anoto nada no inventa una lista.
  assert.equal(history.usualBySlot.get('cena'), undefined);
});

test('empatados en veces manda el mas reciente', () => {
  const history = summarizeFoodHistory([
    entry('viejo', 'cena', 10),
    entry('viejo', 'cena', 20),
    entry('nuevo', 'cena', 90),
    entry('nuevo', 'cena', 95),
  ]);

  assert.deepEqual(history.usualBySlot.get('cena'), ['nuevo', 'viejo']);
});

test('los recientes van del ultimo al primero y sin repetir', () => {
  const history = summarizeFoodHistory([
    entry('huevos', 'desayuno', 10),
    entry('pollo', 'mediodía', 50),
    entry('huevos', 'cena', 80),
  ]);

  assert.deepEqual(history.recent, ['huevos', 'pollo']);
});

test('la cantidad que recuerda es la de la ultima vez', () => {
  const history = summarizeFoodHistory([
    entry('huevos', 'desayuno', 10, 4),
    entry('huevos', 'desayuno', 80, 6),
    entry('pollo', 'mediodía', 50, 200),
  ]);

  assert.equal(history.lastQuantity.get('huevos'), 6);
  assert.equal(history.lastQuantity.get('pollo'), 200);
});

test('buscar no se tropieza con las tildes ni con las mayusculas', () => {
  assert.equal(fold('Plátano Maduro'), 'platano maduro');

  const eggs = ['Huevo extra grande', 'Costco'];
  assert.equal(matchesSearch(eggs, 'huevo'), true);
  assert.equal(matchesSearch(eggs, 'HUEVO'), true);
  assert.equal(matchesSearch(eggs, 'costco'), true);
  // Cada palabra por separado, asi que el orden no importa.
  assert.equal(matchesSearch(eggs, 'costco huevo'), true);
  assert.equal(matchesSearch(eggs, 'pollo'), false);
  // Sin nada escrito no filtra nada.
  assert.equal(matchesSearch(eggs, '  '), true);

  assert.equal(matchesSearch(['Sopa instantanea vegetal', null], 'sopá'), true);
});

test('la ultima vez que lleno un espacio de comida se puede repetir entera', () => {
  const history = summarizeFoodHistory(
    [
      entry('huevos', 'desayuno', 10, 6, '2026-09-21'),
      entry('cafe', 'desayuno', 20, 1, '2026-09-21'),
      entry('barra', 'desayuno', 30, 1, '2026-09-22'),
      entry('pollo', 'mediodía', 40, 200, '2026-09-22'),
      // Lo de hoy no cuenta: repetir hoy sobre hoy no es repetir nada.
      entry('avena', 'desayuno', 50, 60, '2026-09-23'),
    ],
    '2026-09-23',
  );

  const breakfast = history.lastMealBySlot.get('desayuno');
  assert.equal(breakfast?.date, '2026-09-22');
  assert.deepEqual(breakfast?.entries, [{ foodId: 'barra', quantity: 1, unit: 'unidad' }]);

  const lunch = history.lastMealBySlot.get('mediodía');
  assert.equal(lunch?.date, '2026-09-22');
  assert.equal(lunch?.entries.length, 1);

  // Un espacio que nunca lleno no tiene nada que repetir.
  assert.equal(history.lastMealBySlot.get('cena'), undefined);
});

test('una comida de varias cosas se repite completa', () => {
  const history = summarizeFoodHistory(
    [
      entry('huevos', 'desayuno', 10, 6, '2026-09-21'),
      entry('cafe', 'desayuno', 20, 1, '2026-09-21'),
      entry('pan', 'desayuno', 30, 2, '2026-09-21'),
    ],
    '2026-09-23',
  );

  assert.deepEqual(
    history.lastMealBySlot.get('desayuno')?.entries.map((portion) => portion.foodId),
    ['huevos', 'cafe', 'pan'],
  );
});
