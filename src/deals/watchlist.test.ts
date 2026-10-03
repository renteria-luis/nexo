import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DealsDealRow } from '../db/types.ts';

import type { DealWithContext } from './queries.ts';
import { liveDeals, newestFetch, watchedDeals, watchWords } from './watchlist.ts';

function deal(
  title: string,
  description: string | null = null,
  fetchedAt = 1,
  extra: Partial<DealsDealRow> = {},
): DealWithContext {
  return {
    deal: {
      id: title,
      title,
      description,
      fetched_at: fetchedAt,
      staple: 0,
      price_cents: null,
      grams: null,
      pack_ml: null,
      pack_count: null,
      unit: null,
      ...extra,
    } as DealsDealRow,
    source: { id: 'flipp', name: 'Flipp' },
    retailer: null,
    food: null,
    stale: false,
  } as unknown as DealWithContext;
}

test('la lista de palabras se limpia y no repite', () => {
  assert.deepEqual(watchWords('  Egg , eggs ,, EGG '), ['egg', 'eggs']);
  assert.deepEqual(watchWords('plátano'), ['platano']);
  assert.deepEqual(watchWords(null), []);
});

test('una palabra encuentra la oferta esté donde esté y como esté escrita', () => {
  const deals = [
    deal('SELECTION LARGE EGGS', "18'S"),
    deal('LACTANTIA PURFILTRE MILK', '1%, 2%, SKIMMED\n4 L'),
    deal('Fresh Atlantic Salmon'),
  ];

  const found = watchedDeals(deals, watchWords('egg, milk'));
  assert.deepEqual(
    found.map((entry) => `${entry.word}:${entry.item.deal.title}`),
    ['egg:SELECTION LARGE EGGS', 'milk:LACTANTIA PURFILTRE MILK'],
  );

  // De mas antes que de menos: la palabra vale dentro de otra.
  assert.equal(watchedDeals(deals, watchWords('salmon')).length, 1);
  // Y tambien si esta solo en la letra chica.
  assert.equal(watchedDeals(deals, watchWords('skimmed')).length, 1);
  // Sin palabras no se avisa de nada.
  assert.equal(watchedDeals(deals, []).length, 0);
});

test('una oferta no sale dos veces aunque dos palabras la encuentren', () => {
  const found = watchedDeals([deal('LARGE EGGS')], watchWords('egg, eggs'));
  assert.equal(found.length, 1);
  assert.equal(found[0].word, 'egg');
});

test('una palabra excluida tira la oferta aunque la haya encontrado otra', () => {
  const deals = [
    deal('LACTANTIA PURFILTRE MILK', '4 L'),
    deal('EAGLE BRAND SWEETENED CONDENSED MILK', '300 ML'),
    deal('ROOSTER COCONUT MILK', '398 ML'),
    deal('PetAg Esbilac Milk Replacer', null),
  ];

  const found = watchedDeals(
    deals,
    watchWords('milk'),
    watchWords('condensed, coconut, milk replacer'),
  );
  assert.deepEqual(
    found.map((one) => one.item.deal.title),
    ['LACTANTIA PURFILTRE MILK'],
  );
});

test('excluir gana a vigilar, asi que lo que quiere ver no puede estar en las dos', () => {
  const deals = [deal('CHOCOLATE MILK', '2 L')];
  assert.equal(watchedDeals(deals, watchWords('chocolate'), watchWords('chocolate')).length, 0);
  assert.equal(watchedDeals(deals, watchWords('chocolate'), []).length, 1);
});

test('lo mas nuevo de la recoleccion decide si ya lo vio', () => {
  assert.equal(newestFetch([deal('a', null, 10), deal('b', null, 30)]), 30);
  assert.equal(newestFetch([]), null);
});

test('el aviso llega ordenado: sus palabras, su lista y lo mas barato', () => {
  const deals = [
    deal('MILK 2 L', null, 1, { price_cents: 400, pack_ml: 2000 }),
    deal('EGGS 12', null, 1, { price_cents: 600, pack_count: 12 }),
    deal('MILK 4 L', null, 1, { price_cents: 600, pack_ml: 4000 }),
  ];
  const found = watchedDeals(deals, watchWords('milk, eggs'));
  assert.deepEqual(
    found.map((entry) => entry.item.deal.title),
    // Las dos leches primero, y entre ellas la de menos por litro.
    ['MILK 4 L', 'MILK 2 L', 'EGGS 12'],
  );
});

test('lo vencido sigue en el aviso, pero despues de lo vigente y sin contar', () => {
  const expired = { ...deal('Chicken thighs, last week'), stale: true };
  const found = watchedDeals(
    [expired, deal('Chicken breast'), deal('Large eggs')],
    ['chicken', 'eggs'],
  );

  // Antes iba primero por ser de la primera palabra, pintado igual que uno vivo.
  assert.deepEqual(
    found.map(({ item }) => item.deal.title),
    ['Chicken breast', 'Large eggs', 'Chicken thighs, last week'],
  );
  assert.equal(found.length, 3, 'spec 16.3 rule 7: never hidden');
  assert.equal(liveDeals(found).length, 2);
});
