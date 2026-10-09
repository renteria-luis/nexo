// Reading what the module has stored. Spec 16.3 shapes every one of these: a deal
// always travels with the source it came from, and nothing is merged or hidden.

import type { SQLiteDatabase } from 'expo-sqlite';

import type { IsoDate } from '../core/dates.ts';
import { fold } from '../nutrition/picker.ts';
import type {
  DealsDiscountRow,
  DealsRetailerRow,
  DealsSourceRow,
  ListedDeal,
  NutritionFoodRow,
} from '../db/types.ts';

export type DealWithContext = {
  deal: ListedDeal;
  source: DealsSourceRow;
  retailer: DealsRetailerRow | null;
  /**
   * The food its figures are computed for: the one it was found for, unless he said it
   * is not that food.
   */
  food: NutritionFoodRow | null;
  /** The food it was found for and that its title names, before he answers anything. */
  candidate: NutritionFoodRow | null;
  /** Spec 16.5: his answer about the candidate; null while he has not answered. */
  confirmed: boolean | null;
  /**
   * Spec 16.3 rule 7: past its validity is shown greyed as possibly expired, never
   * hidden. Hiding it would suggest everything on screen is fresh.
   */
  stale: boolean;
};

type JoinedRow = ListedDeal & {
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
 * Si la oferta es el alimento con el que se busco, y no solo algo que salio en esa
 * busqueda. La de "milk" trae leche de coco y condensada y la de "oats" un champu de avena
 * para perros, y todas salian con la proteina por dolar de su alimento, pintada de verde y
 * arriba de la lista: la mitad de esas cifras eran de otra cosa. Hace falta que el titulo
 * nombre lo que se busco y que no traiga ninguna de las palabras que el excluyo. Lo que
 * nombra el alimento sin serlo (pechuga empanizada) todavia pasa: eso lo resuelve el toque
 * de confirmar de spec 16.5, abajo.
 */
function namesTheFood(deal: ListedDeal, blocked: readonly string[]): boolean {
  if (deal.category === null) return false;
  const title = fold(deal.title);
  return title.includes(fold(deal.category)) && !blocked.some((word) => title.includes(word));
}

/** El texto de una oferta como se recuerda una respuesta: sin mayusculas ni tildes. */
export function verdictKey(title: string): string {
  return fold(title);
}

/**
 * Spec 16.5: un toque confirma o descarta que la oferta sea ese alimento, y vale para las
 * ofertas que vengan con el mismo texto. Null borra la respuesta.
 */
export async function answerDealMatch(
  db: SQLiteDatabase,
  title: string,
  foodId: string,
  confirmed: boolean | null,
  answeredAt: number,
): Promise<void> {
  if (confirmed === null) {
    await db.runAsync('DELETE FROM deals_match_verdict WHERE title_key = ? AND food_id = ?;', [
      verdictKey(title),
      foodId,
    ]);
    return;
  }
  await db.runAsync(
    `INSERT INTO deals_match_verdict (title_key, food_id, confirmed, answered_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (title_key, food_id) DO UPDATE SET
       confirmed = excluded.confirmed,
       answered_at = excluded.answered_at;`,
    [verdictKey(title), foodId, confirmed ? 1 : 0, answeredAt],
  );
}

/**
 * Every stored deal, freshest validity first, each carrying its own source. Spec
 * 16.3 rule 1: two sources offering the same chicken are two rows here and two cards
 * on screen, never one merged record with an ambiguous origin.
 *
 * `blocked` are his excluded words, already folded (`watchWords`).
 */
export async function listDeals(
  db: SQLiteDatabase,
  onDate: IsoDate,
  blocked: readonly string[] = [],
): Promise<DealWithContext[]> {
  const [rows, sources, foods, verdicts] = await Promise.all([
    db.getAllAsync<JoinedRow>(
      `SELECT d.id, d.source_id, d.retailer_id, d.title, d.description, d.price_cents,
              d.original_price_cents, d.savings_pct, d.unit, d.grams, d.pack_ml, d.pack_count,
              d.quantity_available, d.best_before, d.valid_from, d.valid_to, d.category,
              d.image_url, d.source_url, d.deep_link, d.fetched_at, d.expires_at, d.confidence,
              d.staple,
              r.name AS retailer_name, r.chain AS retailer_chain, m.food_id AS food_id
         FROM deals_deal d
         LEFT JOIN deals_retailer r ON r.id = d.retailer_id
         LEFT JOIN deals_match m ON m.deal_id = d.id
     ORDER BY d.valid_to DESC, d.title;`,
    ),
    listSources(db),
    db.getAllAsync<NutritionFoodRow>('SELECT * FROM nutrition_food;'),
    db.getAllAsync<{ title_key: string; food_id: string; confirmed: 0 | 1 }>(
      'SELECT title_key, food_id, confirmed FROM deals_match_verdict;',
    ),
  ]);
  const answers = new Map(
    verdicts.map((row) => [`${row.title_key}\n${row.food_id}`, row.confirmed === 1]),
  );

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const foodById = new Map(foods.map((food) => [food.id, food]));

  return rows.map((row) => {
    const source = sourceById.get(row.source_id);
    // A deal whose source is gone cannot be labelled, and spec 16.3 rule 2 says the
    // badge is never optional, so this is an error rather than a blank card.
    if (!source) throw new Error(`deal ${row.id} came from ${row.source_id}, which is gone`);

    const { retailer_name, retailer_chain, food_id, ...deal } = row;
    const candidate =
      food_id === null || !namesTheFood(deal, blocked) ? null : (foodById.get(food_id) ?? null);
    const confirmed =
      candidate === null
        ? null
        : (answers.get(`${verdictKey(deal.title)}\n${candidate.id}`) ?? null);
    return {
      deal,
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
      food: confirmed === false ? null : candidate,
      candidate,
      confirmed,
      stale: deal.valid_to !== null && deal.valid_to < onDate,
    };
  });
}
