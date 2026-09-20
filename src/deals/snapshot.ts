// The contract between whatever collects deals and the app that reads them.
//
// Today the collector is a scheduled job that writes a JSON file; spec 16.2 wants a
// read-only REST API and that is still the plan. This file is the seam that makes
// the swap a change of URL rather than a rewrite: the app parses a snapshot, it does
// not care whether the bytes came from a file in a repository or from a server.
//
// Spec 16.7: an empty dataset and a failed fetch must be distinguishable. A snapshot
// with zero deals is valid and means "nothing on sale". A malformed one throws.

import type { SQLiteDatabase } from 'expo-sqlite';

import type { IsoDate } from '../core/dates.ts';

export const SNAPSHOT_VERSION = 1;

export type SnapshotDeal = {
  /** Stable for the life of the offer within its source, so refetching updates. */
  id: string;
  title: string;
  merchant: string;
  priceCents: number | null;
  originalPriceCents: number | null;
  /** As the source worded it: 'lb', 'kg', 'ea'. Null when it did not say. */
  unit: string | null;
  validFrom: IsoDate | null;
  validTo: IsoDate | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  confidence: 'exact' | 'parsed';
  /**
   * The food this deal was found for. The collector searches the source once per
   * tracked food, so the search term is the link and no fuzzy title matching is
   * needed. Spec 16.5 still calls it a fuzzy match and leaves it unconfirmed,
   * because "chicken breast" finding a 3-piece pack is a guess, just a good one.
   */
  foodId: string | null;
  /** The untouched source record, kept so a wrong parse can be checked (spec 16.5). */
  raw: unknown;
};

export type DealSnapshot = {
  version: number;
  source: string;
  fetchedAt: number;
  postalCode: string;
  deals: SnapshotDeal[];
};

function fail(what: string): never {
  throw new Error(`the deals snapshot is not usable: ${what}`);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} is missing`);
  return value;
}

function asOptionalString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') fail(`${field} is not text`);
  return value;
}

function asOptionalCents(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${field} is not an amount in cents`);
  }
  return Math.round(value);
}

/**
 * Parses and checks a snapshot. Throws with a readable reason rather than returning
 * something half built: spec 16.7 wants structured failure, and a deals screen that
 * silently shows nothing is indistinguishable from a gym with no offers.
 */
export function parseSnapshot(text: string): DealSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail('it is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) fail('it is not an object');

  const body = raw as Record<string, unknown>;
  if (body.version !== SNAPSHOT_VERSION) fail(`version ${String(body.version)} is not supported`);
  if (!Array.isArray(body.deals)) fail('it carries no list of deals');

  const source = asString(body.source, 'source');
  const fetchedAt = body.fetchedAt;
  if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) fail('fetchedAt is missing');

  const deals = body.deals.map((entry, index): SnapshotDeal => {
    if (typeof entry !== 'object' || entry === null) fail(`deal ${index} is not an object`);
    const deal = entry as Record<string, unknown>;
    const confidence = asString(deal.confidence, `deal ${index} confidence`);
    if (confidence !== 'exact' && confidence !== 'parsed') {
      fail(`deal ${index} has confidence ${confidence}`);
    }
    return {
      id: asString(deal.id, `deal ${index} id`),
      title: asString(deal.title, `deal ${index} title`),
      merchant: asString(deal.merchant, `deal ${index} merchant`),
      priceCents: asOptionalCents(deal.priceCents, `deal ${index} price`),
      originalPriceCents: asOptionalCents(deal.originalPriceCents, `deal ${index} original price`),
      unit: asOptionalString(deal.unit, `deal ${index} unit`),
      validFrom: asOptionalString(deal.validFrom, `deal ${index} validFrom`) as IsoDate | null,
      validTo: asOptionalString(deal.validTo, `deal ${index} validTo`) as IsoDate | null,
      imageUrl: asOptionalString(deal.imageUrl, `deal ${index} image`),
      sourceUrl: asOptionalString(deal.sourceUrl, `deal ${index} url`),
      confidence,
      foodId: asOptionalString(deal.foodId, `deal ${index} foodId`),
      raw: deal.raw ?? null,
    };
  });

  return {
    version: SNAPSHOT_VERSION,
    source,
    fetchedAt,
    postalCode: asOptionalString(body.postalCode, 'postalCode') ?? '',
    deals,
  };
}

function retailerId(source: string, merchant: string): string {
  return `${source}-${merchant
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

/**
 * Writes a snapshot into the module's tables, replacing that source's deals with
 * what the snapshot holds. Only that source's rows are touched: spec 16.7 says one
 * broken source never breaks the module, and that has to be true of a good one too.
 */
export async function applySnapshot(db: SQLiteDatabase, snapshot: DealSnapshot): Promise<number> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM deals_deal WHERE source_id = ?;', [snapshot.source]);

    for (const deal of snapshot.deals) {
      const retailer = retailerId(snapshot.source, deal.merchant);
      await db.runAsync(
        `INSERT INTO deals_retailer (id, name, chain) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, chain = excluded.chain;`,
        [retailer, deal.merchant, deal.merchant],
      );

      await db.runAsync(
        `INSERT INTO deals_deal
           (id, source_id, retailer_id, title, price_cents, original_price_cents, unit,
            valid_from, valid_to, image_url, source_url, fetched_at, confidence, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          `${snapshot.source}-${deal.id}`,
          snapshot.source,
          retailer,
          deal.title,
          deal.priceCents,
          deal.originalPriceCents,
          deal.unit,
          deal.validFrom,
          deal.validTo,
          deal.imageUrl,
          deal.sourceUrl,
          snapshot.fetchedAt,
          deal.confidence,
          deal.raw === null ? null : JSON.stringify(deal.raw),
        ],
      );

      if (deal.foodId !== null) {
        // Spec 17.4 rule 2: a foreign key into nutrition, never a copy of it. The
        // row is skipped when the food is not in the catalogue, because a match
        // pointing nowhere is worse than no match.
        await db.runAsync(
          `INSERT INTO deals_match (deal_id, food_id, match_confidence, matched_by, user_confirmed)
           SELECT ?, id, NULL, 'fuzzy', NULL FROM nutrition_food WHERE id = ?
           ON CONFLICT (deal_id, food_id) DO NOTHING;`,
          [`${snapshot.source}-${deal.id}`, deal.foodId],
        );
      }
    }

    await db.runAsync(
      `UPDATE deals_source
          SET last_success_at = ?, last_error = NULL, health = 'ok'
        WHERE id = ?;`,
      [snapshot.fetchedAt, snapshot.source],
    );
  });

  return snapshot.deals.length;
}

/** Spec 16.7: a source that failed says so, with the reason kept for the screen. */
export async function recordFailure(
  db: SQLiteDatabase,
  sourceId: string,
  reason: string,
): Promise<void> {
  await db.runAsync(`UPDATE deals_source SET last_error = ?, health = 'down' WHERE id = ?;`, [
    reason,
    sourceId,
  ]);
}
