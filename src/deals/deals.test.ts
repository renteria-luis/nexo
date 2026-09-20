import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { migrations } from '../db/migrations/index.ts';

import { listDeals, listSources } from './queries.ts';
import { applySnapshot, parseSnapshot, recordFailure, type SnapshotDeal } from './snapshot.ts';

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
    withTransactionAsync: async (work: () => Promise<void>) => {
      raw.exec('BEGIN;');
      try {
        await work();
        raw.exec('COMMIT;');
      } catch (error) {
        raw.exec('ROLLBACK;');
        throw error;
      }
    },
  } as unknown as SQLiteDatabase;
}

function snapshotDeal(overrides: Partial<SnapshotDeal> = {}): SnapshotDeal {
  return {
    id: 'item-1',
    title: 'Boneless skinless chicken breasts',
    merchant: 'Food Basics',
    priceCents: 881,
    originalPriceCents: 1099,
    unit: 'kg',
    validFrom: '2026-09-17',
    validTo: '2026-09-24',
    imageUrl: null,
    sourceUrl: 'https://flipp.com/item/1',
    confidence: 'exact',
    foodId: null,
    raw: { current_price: 8.81 },
    ...overrides,
  };
}

function snapshot(deals: SnapshotDeal[], source = 'flipp') {
  return {
    version: 1,
    source,
    fetchedAt: 1_758_000_000_000,
    postalCode: 'N6A3K7',
    deals,
  };
}

test('a malformed snapshot fails loudly instead of arriving half built', () => {
  assert.throws(() => parseSnapshot('no soy json'), /not valid JSON/);
  assert.throws(
    () => parseSnapshot(JSON.stringify({ version: 9, source: 'x', deals: [] })),
    /version/,
  );
  assert.throws(() => parseSnapshot(JSON.stringify({ version: 1, source: 'flipp' })), /no list/);
  assert.throws(
    () =>
      parseSnapshot(
        JSON.stringify(
          snapshot([{ ...snapshotDeal(), confidence: 'guessed' } as unknown as SnapshotDeal]),
        ),
      ),
    /confidence/,
  );
});

test('a snapshot with no deals is valid and is not a failure', () => {
  // Spec 16.7: an empty dataset and a blocked request must be distinguishable.
  const parsed = parseSnapshot(JSON.stringify(snapshot([])));
  assert.equal(parsed.deals.length, 0);
  assert.equal(parsed.source, 'flipp');
});

test('applying a snapshot stores the deal with its shop and its source', async () => {
  const db = fresh();
  const count = await applySnapshot(db, parseSnapshot(JSON.stringify(snapshot([snapshotDeal()]))));
  assert.equal(count, 1);

  const [stored] = await listDeals(db, '2026-09-20');
  assert.equal(stored.deal.title, 'Boneless skinless chicken breasts');
  assert.equal(stored.deal.price_cents, 881);
  assert.equal(stored.deal.unit, 'kg');
  assert.equal(stored.source.name, 'Flipp');
  assert.equal(stored.retailer?.name, 'Food Basics');
  assert.equal(stored.stale, false);

  // Spec 16.5: the untouched response is kept so a wrong parse can be checked.
  assert.match(stored.deal.raw_payload ?? '', /current_price/);

  const [source] = await listSources(db);
  assert.equal(source.health, 'ok');
  assert.equal(source.last_success_at, 1_758_000_000_000);
});

test('fetching again replaces that source instead of piling up copies', async () => {
  const db = fresh();
  await applySnapshot(db, parseSnapshot(JSON.stringify(snapshot([snapshotDeal()]))));
  await applySnapshot(
    db,
    parseSnapshot(JSON.stringify(snapshot([snapshotDeal({ priceCents: 799 })]))),
  );

  const deals = await listDeals(db, '2026-09-20');
  assert.equal(deals.length, 1);
  assert.equal(deals[0].deal.price_cents, 799);
});

test('an expired deal is kept and marked, never hidden', async () => {
  const db = fresh();
  await applySnapshot(
    db,
    parseSnapshot(
      JSON.stringify(snapshot([snapshotDeal({ validFrom: '2026-09-03', validTo: '2026-09-10' })])),
    ),
  );

  // Spec 16.3 rule 7: greyed as possibly expired, because hiding it would suggest
  // everything left on screen is fresh.
  const [stored] = await listDeals(db, '2026-09-20');
  assert.equal(stored.stale, true);
});

test('the deal points at the food it was found for, without copying it', async () => {
  const db = fresh();
  await applySnapshot(
    db,
    parseSnapshot(JSON.stringify(snapshot([snapshotDeal({ foodId: 'eggs-large' })]))),
  );

  const [stored] = await listDeals(db, '2026-09-20');
  assert.equal(stored.food?.id, 'eggs-large');

  // A food that is not in the catalogue leaves the deal unmatched rather than
  // inventing a row that points nowhere.
  await applySnapshot(
    db,
    parseSnapshot(JSON.stringify(snapshot([snapshotDeal({ foodId: 'no-existe' })]))),
  );
  assert.equal((await listDeals(db, '2026-09-20'))[0].food, null);
});

test('a source that failed says so and keeps the reason', async () => {
  const db = fresh();
  await recordFailure(db, 'flipp', 'la respuesta no era JSON');

  const [source] = await listSources(db);
  assert.equal(source.health, 'down');
  assert.equal(source.last_error, 'la respuesta no era JSON');
});
