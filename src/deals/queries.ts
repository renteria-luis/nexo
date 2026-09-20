// Reading what the module has stored. Spec 16.3 shapes every one of these: a deal
// always travels with the source it came from, and nothing is merged or hidden.

import type { SQLiteDatabase } from 'expo-sqlite';

import type { IsoDate } from '../core/dates.ts';
import type {
  DealsDealRow,
  DealsDiscountRow,
  DealsRetailerRow,
  DealsSourceRow,
  NutritionFoodRow,
} from '../db/types.ts';

export type DealWithContext = {
  deal: DealsDealRow;
  source: DealsSourceRow;
  retailer: DealsRetailerRow | null;
  /** The food it was found for, when the catalogue has it. */
  food: NutritionFoodRow | null;
  /**
   * Spec 16.3 rule 7: past its validity is shown greyed as possibly expired, never
   * hidden. Hiding it would suggest everything on screen is fresh.
   */
  stale: boolean;
};

type JoinedRow = DealsDealRow & {
  retailer_name: string | null;
  retailer_chain: string | null;
  food_id: string | null;
};

export async function listSources(db: SQLiteDatabase): Promise<DealsSourceRow[]> {
  return db.getAllAsync<DealsSourceRow>('SELECT * FROM deals_source ORDER BY name;');
}

export async function listDiscounts(db: SQLiteDatabase): Promise<DealsDiscountRow[]> {
  return db.getAllAsync<DealsDiscountRow>('SELECT * FROM deals_discount WHERE active = 1;');
}

/**
 * Every stored deal, freshest validity first, each carrying its own source. Spec
 * 16.3 rule 1: two sources offering the same chicken are two rows here and two cards
 * on screen, never one merged record with an ambiguous origin.
 */
export async function listDeals(db: SQLiteDatabase, onDate: IsoDate): Promise<DealWithContext[]> {
  const [rows, sources, foods] = await Promise.all([
    db.getAllAsync<JoinedRow>(
      `SELECT d.*, r.name AS retailer_name, r.chain AS retailer_chain, m.food_id AS food_id
         FROM deals_deal d
         LEFT JOIN deals_retailer r ON r.id = d.retailer_id
         LEFT JOIN deals_match m ON m.deal_id = d.id
     ORDER BY d.valid_to DESC, d.title;`,
    ),
    listSources(db),
    db.getAllAsync<NutritionFoodRow>('SELECT * FROM nutrition_food;'),
  ]);

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const foodById = new Map(foods.map((food) => [food.id, food]));

  return rows.map((row) => {
    const source = sourceById.get(row.source_id);
    // A deal whose source is gone cannot be labelled, and spec 16.3 rule 2 says the
    // badge is never optional, so this is an error rather than a blank card.
    if (!source) throw new Error(`deal ${row.id} came from ${row.source_id}, which is gone`);

    const { retailer_name, retailer_chain, food_id, ...deal } = row;
    return {
      deal: deal as DealsDealRow,
      source,
      retailer:
        row.retailer_id === null
          ? null
          : ({
              id: row.retailer_id,
              name: retailer_name ?? row.retailer_id,
              chain: retailer_chain,
              address: null,
              lat: null,
              lng: null,
              province: null,
              city: null,
            } satisfies DealsRetailerRow),
      food: food_id === null ? null : (foodById.get(food_id) ?? null),
      stale: deal.valid_to !== null && deal.valid_to < onDate,
    };
  });
}
