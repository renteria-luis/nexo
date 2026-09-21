// Spec 16.2 and 16.4: the collector. It runs on a schedule away from the phone and
// leaves a snapshot the app reads. Today that snapshot is a file in this repository;
// when it becomes a server the app changes a URL and nothing else.
//
// Flipp needs no account, which is why it is the first source (spec 16.4): there is
// nothing here to ban and no credential to keep.
//
// The postal code decides which shops appear. It arrives from the environment rather
// than the repository because this repository is public and where he lives is his.

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ENDPOINT = 'https://backflipp.wishabi.com/flipp/items/search';
const POSTAL_CODE = process.env.DEALS_POSTAL_CODE ?? 'N6A3K7';
const SNAPSHOT_VERSION = 1;

function cents(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100)
    : null;
}

function isoDate(value) {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : null;
}

function unitOf(item) {
  const text = item.post_price_text ?? item.pre_price_text;
  if (typeof text !== 'string') return null;
  const clean = text.trim().toLowerCase();
  return clean === '' ? null : clean;
}

function normalise(item, foodId, staple) {
  return {
    id: String(item.id),
    title: String(item.name ?? '').trim(),
    merchant: String(item.merchant_name ?? '').trim(),
    priceCents: cents(item.current_price),
    originalPriceCents: cents(item.original_price),
    unit: unitOf(item),
    validFrom: isoDate(item.valid_from),
    validTo: isoDate(item.valid_to),
    imageUrl: item.clean_image_url ?? item.clipping_image_url ?? null,
    // Flipp publishes no stable per item web page, so rather than invent a link that
    //404s the card falls back to the source's own site (spec 16.3 rule 4).
    sourceUrl: null,
    // It came from a structured response, not from reading a flyer image.
    confidence: 'exact',
    foodId,
    staple,
    raw: item,
  };
}

async function search(term) {
  const url = `${ENDPOINT}?q=${encodeURIComponent(term)}&postal_code=${encodeURIComponent(POSTAL_CODE)}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Flipp answered ${response.status} for "${term}"`);
  const body = await response.json();
  if (!Array.isArray(body.items)) throw new Error(`Flipp returned no item list for "${term}"`);
  return body.items;
}

const config = JSON.parse(await readFile(new URL('../deals/queries.json', import.meta.url), 'utf8'));

const deals = [];
const seen = new Set();
const failures = [];

for (const { term, foodId, staple } of config.queries) {
  try {
    for (const item of await search(term)) {
      const deal = normalise(item, foodId, staple === true);
      if (deal.title === '' || deal.merchant === '') continue;
      // The same item answers several searches. Keeping one copy is not merging
      // sources (spec 16.3 rule 1): it is the same record from the same source.
      if (seen.has(deal.id)) continue;
      seen.add(deal.id);
      deals.push(deal);
    }
  } catch (error) {
    failures.push(`${term}: ${error.message}`);
  }
  // Polite spacing. Nothing here is urgent and this runs once a day.
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

// Spec 16.7: a partial collection is not a success. If every search failed the job
// fails loudly rather than publishing an empty snapshot that reads as "no offers".
if (failures.length === config.queries.length) {
  console.error(failures.join('\n'));
  throw new Error('every Flipp search failed, not writing a snapshot');
}

const snapshot = {
  version: SNAPSHOT_VERSION,
  source: 'flipp',
  fetchedAt: Date.now(),
  // The postal code decides which shops answer, but it does not travel in the
  // published file: this repository is public and it is close enough to where he
  // lives to be his business and nobody else's.
  postalCode: '',
  deals,
};

await mkdir(new URL('../deals/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../deals/flipp.json', import.meta.url),
  `${JSON.stringify(snapshot, null, 1)}\n`,
);

console.log(`${deals.length} ofertas de ${new Set(deals.map((d) => d.merchant)).size} tiendas`);
if (failures.length > 0) console.warn(`busquedas fallidas: ${failures.join('; ')}`);
