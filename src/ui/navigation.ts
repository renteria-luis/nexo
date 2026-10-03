// Como llegar a una pantalla desde fuera de ella: el menu lateral y el toque de un aviso.
//
// Las pestanas (Hoy, Entreno, Comida) no son pantallas del navegador de arriba: se piden a
// la pantalla de arriba que las contiene, 'nexo'. Y `pop` vuelve a una pantalla que ya esta
// abierta en vez de apilar otra: en React Navigation 7 navegar sin el solo reusa la que
// esta encima, y desde Registros el menu montaba una segunda copia de las pestanas, con la
// palomita donde iba Ajustes y un toque de vuelta por cada pantalla recorrida.

import type { NudgeKind } from '../core/nudges.ts';

export type Navigate = [name: string, params: object | undefined, options: { pop: true }];

export function goTo(route: string, tab: boolean): Navigate {
  return tab ? ['nexo', { screen: route }, { pop: true }] : [route, undefined, { pop: true }];
}

/**
 * Spec 18.1: tocar un aviso abre la pantalla donde se anota eso. Con Ajustes, Registros o
 * un dia abierto encima, pedir "Comida" a secas no lo entendia nadie y se perdia callado:
 * se quedaba en la pantalla que habia dejado abierta.
 */
export function nudgeDestination(kind: NudgeKind): Navigate {
  switch (kind) {
    case 'comida':
      return goTo('Comida', true);
    case 'entreno':
      return goTo('Entreno', true);
    case 'agua':
    case 'manana':
    case 'cierre':
    case 'creatina':
      return goTo('Hoy', true);
    case 'semana':
      return goTo('Resumen semanal', false);
  }
}
