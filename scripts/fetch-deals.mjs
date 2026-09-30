// Spec 16.2 and 16.4: the collector. It runs on a schedule away from the phone and
// leaves a snapshot the app reads. Today that snapshot is a file in this repository;
// when it becomes a server the app changes a URL and nothing else.
//
// Flipp needs no account, which is why it is the first source (spec 16.4): there is
// nothing here to ban and no credential to keep.
//
// Two things it does beyond listing prices, and they are the whole point:
//
// 1. **It reads the weight.** The search answer almost never puts it in the unit: of
//    224 offers on a normal day, 113 had no unit at all and two had one the app could
//    use. The weight is in the title ("SEASONED CHICKEN BREAST, 4 KG") or in the small
//    print of the item ("11.00/kg"), which needs a second request per item. Without it
//    there is no protein per dollar, and without that this module is a worse Flipp.
// 2. **It writes the link that opens the app.** flipp.com declares universal links for
//    /action, so https://flipp.com/action/item/<id> opens the Flipp app on that very
//    item, and the website when the app is not installed. A custom flipp:// scheme
//    cannot work from here: iOS only answers canOpenURL for schemes declared in the
//    app's own Info.plist.
//
// The postal code decides which shops appear. It arrives from the environment rather
// than the repository because this repository is public and where he lives is his.

import { readFile, writeFile, mkdir } from 'node:fs/promises';

import { centsPerKgFromText, dealPack, normaliseUnit } from '../src/deals/parse.ts';

const SEARCH = 'https://backflipp.wishabi.com/flipp/items/search';
const ITEM = 'https://backflipp.wishabi.com/flipp/items';
const SNAPSHOT_VERSION = 1;
/** Cuantos detalles se piden a la vez. Esto corre una vez al dia y no hay prisa. */
const AT_A_TIME = 4;

// Flipp exige el codigo postal completo y sin espacio: con tres caracteres, o
// vacio, responde 422 a todo. Y un secreto sin configurar llega como cadena vacia,
// no como ausente, asi que un valor por defecto con ?? no lo atrapa. Sin codigo se
// para aqui, que es mas util que seis busquedas fallando una por una.
const POSTAL_CODE = (process.env.DEALS_POSTAL_CODE ?? '').trim().toUpperCase();
if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(POSTAL_CODE)) {
  throw new Error(
    'falta DEALS_POSTAL_CODE, o no es un codigo postal completo sin espacio como N6A3K7. ' +
      'Se configura en GitHub, en Settings > Secrets and variables > Actions.',
  );
}

function cents(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100)
    : null;
}

function isoDate(value) {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : null;
}

/** Solo lo que sirve para revisar despues de donde salio una cifra. */
function evidence(item, detail) {
  return {
    id: item.id,
    flyer_id: item.flyer_id ?? null,
    merchant_id: item.merchant_id ?? null,
    current_price: item.current_price ?? null,
    original_price: item.original_price ?? null,
    pre_price_text: item.pre_price_text ?? null,
    post_price_text: item.post_price_text ?? null,
    sale_story: item.sale_story ?? detail?.sale_story ?? null,
    description: detail?.description ?? null,
    valid_from: item.valid_from ?? null,
    valid_to: item.valid_to ?? null,
  };
}

function normalise(item, detail, term, foodId, staple) {
  const description = typeof detail?.description === 'string' ? detail.description.trim() : null;
  const unit = normaliseUnit(item.post_price_text ?? item.pre_price_text);
  const pack = dealPack(String(item.name ?? ''), description, unit);
  // El precio por kilo de la letra chica manda sobre cualquier cuenta nuestra: es el
  // mismo precio dicho en metrico por quien lo puso.
  const perKg = centsPerKgFromText(description);
  const price = cents(item.current_price);
  const grams =
    perKg !== null && price !== null
      ? Math.round((price / perKg) * 1000)
      : pack !== null && 'grams' in pack
        ? pack.grams
        : null;

  return {
    id: String(item.id),
    title: String(item.name ?? '').trim(),
    merchant: String(item.merchant_name ?? '').trim(),
    priceCents: price,
    originalPriceCents: cents(item.original_price),
    unit,
    // Con el precio por kilo escrito, el peso que compra el precio es exacto.
    grams,
    // Y lo que no se pesa: litros de leche, huevos por docena.
    packMl: pack !== null && 'millilitres' in pack ? pack.millilitres : null,
    packCount: pack !== null && 'count' in pack ? pack.count : null,
    description,
    validFrom: isoDate(item.valid_from),
    validTo: isoDate(item.valid_to),
    imageUrl: item.clean_image_url ?? item.clipping_image_url ?? null,
    // El enlace universal: abre la app de Flipp en ese articulo, o su web si no esta.
    sourceUrl: `https://flipp.com/action/item/${String(item.id)}`,
    // It came from a structured response, not from reading a flyer image.
    confidence: 'exact',
    // Lo que se buscaba para encontrarla, que es como se agrupan por producto en la
    // pantalla: "pechuga de pollo" y no "Food Basics".
    category: term,
    foodId,
    staple,
    raw: evidence(item, detail),
  };
}

async function json(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Flipp answered ${response.status}`);
  return response.json();
}

async function search(term) {
  const body = await json(
    `${SEARCH}?q=${encodeURIComponent(term)}&postal_code=${encodeURIComponent(POSTAL_CODE)}`,
  );
  if (!Array.isArray(body.items)) throw new Error(`Flipp returned no item list for "${term}"`);
  return body.items;
}

/** La letra chica de un articulo. Si falla, la oferta se queda con lo que ya tenia. */
async function details(id) {
  try {
    const body = await json(`${ITEM}/${id}?postal_code=${encodeURIComponent(POSTAL_CODE)}`);
    return body.item ?? null;
  } catch {
    return null;
  }
}

const config = JSON.parse(
  await readFile(new URL('../deals/queries.json', import.meta.url), 'utf8'),
);

const found = new Map();
const failures = [];

for (const { term, foodId, staple } of config.queries) {
  try {
    for (const item of await search(term)) {
      const id = String(item.id);
      // The same item answers several searches. Keeping one copy is not merging
      // sources (spec 16.3 rule 1): it is the same record from the same source.
      if (found.has(id)) continue;
      if (String(item.name ?? '').trim() === '' || String(item.merchant_name ?? '').trim() === '') {
        continue;
      }
      found.set(id, { item, term, foodId, staple: staple === true });
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

const entries = [...found.values()];
const deals = [];
for (let at = 0; at < entries.length; at += AT_A_TIME) {
  const batch = entries.slice(at, at + AT_A_TIME);
  const detailed = await Promise.all(batch.map(({ item }) => details(item.id)));
  batch.forEach(({ item, term, foodId, staple }, index) => {
    deals.push(normalise(item, detailed[index], term, foodId, staple));
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
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

const sized = deals.filter(
  (deal) => deal.grams !== null || deal.packMl !== null || deal.packCount !== null,
).length;
console.log(
  `${deals.length} ofertas de ${new Set(deals.map((d) => d.merchant)).size} tiendas, ` +
    `${sized} con tamano`,
);
if (failures.length > 0) console.warn(`busquedas fallidas: ${failures.join('; ')}`);
