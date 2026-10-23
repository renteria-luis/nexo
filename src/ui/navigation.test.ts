import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CommonActions,
  StackRouter,
  TabRouter,
  type ParamListBase,
  type StackNavigationState,
} from '@react-navigation/routers';

import { fromMenu, goTo, nudgeDestination } from './navigation.ts';

// Las pantallas de verdad de App.tsx, con el router de verdad de la libreria instalada.
const STACK = ['nexo', 'Ajustes', 'Registros', 'Gráficas', 'Día', 'Resumen semanal', 'Lecturas'];
const TABS = ['Hoy', 'Entreno', 'Comida'];

const stack = StackRouter({});
const options = {
  routeNames: STACK,
  routeParamList: {},
  routeGetIdList: {},
};

type State = StackNavigationState<ParamListBase>;

function apply(state: State, args: ReturnType<typeof goTo>): State {
  const next = stack.getStateForAction(state, CommonActions.navigate(...args), options);
  assert.ok(next !== null, `${args[0]} was not handled`);
  return next as State;
}

const navigate = (state: State, route: string, tab: boolean) => apply(state, goTo(route, tab));

const names = (state: State) => state.routes.map((route) => route.name).join(' > ');

test('el menu vuelve a las pestanas que ya estan abiertas en vez de apilar otra copia', () => {
  let state = stack.getInitialState(options) as State;
  state = navigate(state, 'Registros', false);
  state = navigate(state, 'Hoy', true);
  assert.equal(names(state), 'nexo');

  // El nombre de la pestana viaja en los parametros, que es lo que lee el de abajo.
  assert.deepEqual(state.routes[0].params, { screen: 'Hoy' });

  state = navigate(state, 'Registros', false);
  state = navigate(state, 'Gráficas', false);
  state = navigate(state, 'Registros', false);
  // Registros ya estaba abierta debajo de Graficas: se vuelve a ella, no se apila una tercera.
  assert.equal(names(state), 'nexo > Registros');
  state = navigate(state, 'Comida', true);
  assert.equal(names(state), 'nexo');
});

test('la pestana pedida es una que el navegador de abajo conoce', () => {
  const tabs = TabRouter({});
  const [, params] = goTo('Comida', true);
  const tabOptions = { routeNames: TABS, routeParamList: {}, routeGetIdList: {} };
  const initial = tabs.getInitialState(tabOptions);
  const next = tabs.getStateForAction(
    initial,
    CommonActions.navigate((params as { screen: string }).screen),
    tabOptions,
  );
  assert.ok(next);
  assert.equal(next.routes[next.index ?? 0].name, 'Comida');
});

test('tocar un aviso de comida con Ajustes abierto lleva a Comida, no se pierde', () => {
  let state = stack.getInitialState(options) as State;
  state = navigate(state, 'Ajustes', false);

  const comida = apply(state, nudgeDestination('comida'));
  assert.equal(names(comida), 'nexo');
  assert.deepEqual(comida.routes[0].params, { screen: 'Comida' });

  const week = apply(state, nudgeDestination('semana'));
  assert.equal(names(week), 'nexo > Ajustes > Resumen semanal');

  // Lo que hacia antes: pedir la pestana a secas. La pila de arriba no la conoce.
  const before = stack.getStateForAction(state, CommonActions.navigate('Comida'), options);
  assert.equal(before, null);
});

test('una pantalla abierta desde el menu queda sola encima de las pestanas', () => {
  const menu = (state: State, route: string) => {
    const next = stack.getStateForAction(state, fromMenu(state, route), options);
    assert.ok(next !== null, `${route} was not handled`);
    return next as State;
  };
  let state = stack.getInitialState(options) as State;
  state = menu(state, 'Registros');
  state = navigate(state, 'Día', false);
  assert.equal(names(state), 'nexo > Registros > Día');

  state = menu(state, 'Gráficas');
  assert.equal(names(state), 'nexo > Gráficas', 'Listo vuelve al dia, no a Registros');
  state = menu(state, 'Lecturas');
  assert.equal(names(state), 'nexo > Lecturas');

  // Las pestanas siguen siendo las mismas: no se rearman al abrir algo encima.
  const tabsKey = state.routes[0].key;
  state = menu(state, 'Ajustes');
  assert.equal(state.routes[0].key, tabsKey);

  // Si ya estaba abierta, se vuelve a ella tal como estaba.
  state = navigate(state, 'Registros', false);
  const open = state.routes[2];
  state = menu(state, 'Registros');
  assert.equal(names(state), 'nexo > Registros');
  assert.equal(state.routes[1].key, open.key);
});
