// Lo que el quiere que le avisen, y nada mas.
//
// La pantalla de ofertas era una lista de cuatrocientas cosas que hay que recorrer; lo
// que de verdad hace falta es "hay pollo en oferta en Food Basics hasta el jueves". Eso
// se resuelve con una lista de palabras suyas y una regla simple: si la palabra aparece
// en alguna parte del nombre o de la letra chica, la oferta entra.
//
// De mas antes que de menos, por decision suya: "prefiero que me muestre de mas a que no
// me muestre algo". Por eso busca dentro de la palabra ("egg" encuentra "EGGS") y no
// intenta ser lista con singulares y plurales.
//
// Ese mismo buscar dentro es generoso en las dos direcciones: "milk" trae leche
// condensada, de coco, con chocolate, de avena y la de biberon para perros. Por eso hay
// una segunda lista, la de palabras que la tiran aunque coincida. Si una palabra esta en
// las dos gana la de fuera, asi que lo que quiere ver no puede estar excluido.

import { fold } from '../nutrition/picker.ts';

import type { DealWithContext } from './queries.ts';
import { unitPrice } from './value.ts';

/** Las palabras de su lista, ya limpias. La coma es lo unico que las separa. */
export function watchWords(list: string | null | undefined): string[] {
  if (typeof list !== 'string') return [];
  return [
    ...new Set(
      list
        .split(',')
        .map((word) => fold(word))
        .filter((word) => word !== ''),
    ),
  ];
}

export type WatchedDeal = {
  item: DealWithContext;
  /** Que palabra suya lo trajo, para poder agruparlo por eso. */
  word: string;
};

/**
 * Las ofertas que alguna de sus palabras encuentra, sin repetir: si "egg" y "eggs"
 * traen la misma, la trae la primera que la encontro.
 */
export function watchedDeals(
  deals: readonly DealWithContext[],
  words: readonly string[],
  blocked: readonly string[] = [],
): WatchedDeal[] {
  if (words.length === 0) return [];

  const found: WatchedDeal[] = [];
  const seen = new Set<string>();

  for (const item of deals) {
    const haystack = fold(`${item.deal.title} ${item.deal.description ?? ''}`);
    const word = words.find((needle) => haystack.includes(needle));
    if (word === undefined || seen.has(item.deal.id)) continue;
    if (blocked.some((needle) => haystack.includes(needle))) continue;
    seen.add(item.deal.id);
    found.push({ item, word });
  }

  // En el orden de sus palabras, y dentro de cada una lo de su lista primero y lo mas
  // barato por medida despues: ciento y pico de ofertas sin orden no es un aviso.
  return found.sort((a, b) => {
    if (a.word !== b.word) return words.indexOf(a.word) - words.indexOf(b.word);
    if (a.item.deal.staple !== b.item.deal.staple) {
      return b.item.deal.staple - a.item.deal.staple;
    }
    const left = unitPrice(a.item.deal);
    const right = unitPrice(b.item.deal);
    if (left !== null && right !== null) return left.cents - right.cents;
    if (left !== null) return -1;
    if (right !== null) return 1;
    return 0;
  });
}

/** Lo mas nuevo que trajo la ultima recoleccion, para saber si ya lo vio. */
export function newestFetch(deals: readonly DealWithContext[]): number | null {
  let newest: number | null = null;
  for (const { deal } of deals) {
    if (newest === null || deal.fetched_at > newest) newest = deal.fetched_at;
  }
  return newest;
}
