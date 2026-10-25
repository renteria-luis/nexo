import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plannerFixture } from '../transit/fixtures.ts';
import * as realtime from '../transit/realtime.ts';
import { nodes, renderModule, textOf } from './test-render.ts';

function fixture() {
  const props = {
    schedule: plannerFixture(),
    snapshot: null,
    active: false,
    followed: null,
    focusKey: null,
    center: { lat: 43, lng: -81.2 },
    places: [
      { id: 'fit', name: 'Fit', category: 'gym' },
      { id: 'fanshawe', name: 'Fanshawe', category: 'gym' },
      { id: 'store', name: 'Store', category: 'Compras' },
      { id: 'home', name: 'Home', category: '' },
    ],
    tripPlaceIds: [] as string[],
    selectedPlace: null,
    selectedStop: null,
    draft: null,
    onPlace() {},
    onStop() {},
  };
  const screen = renderModule('src/ui/TransitLiveMap.tsx', {
    './TransitMap': { TransitMap: 'TransitMap' },
    '../transit/realtime.ts': realtime,
    './TransitDepartures.tsx': { useLiveClock: () => 0 },
    './icons.ts': {
      ChevronDown: 'ChevronDown',
      ChevronRight: 'ChevronRight',
    },
  }).mount('TransitLiveMap', props);
  const current = async () => nodes(await screen.settle());
  const map = async () => (await current()).find((n) => n.type === 'TransitMap')!.props;
  const control = async (label: string) =>
    (await current()).find((n) => n.props.accessibilityLabel === label)!.props;
  // A layer is a switch and a route or category a chip.
  const click = async (label: string) => {
    const props = await control(label);
    if (props.onPress) props.onPress();
    else (props.onChange ?? props.onValueChange)(!props.value);
  };
  const text = async () => textOf(await screen.settle());
  return { props, map, control, click, text };
}

test('offline route checkboxes show both directions, union routes and preserve the camera', async () => {
  const f = fixture();
  const original = await f.map();
  await f.click('Paraderos');
  assert.deepEqual((await f.map()).stops, []);
  await f.click('Mostrar rutas');
  await f.click('Paraderos de la ruta 16');
  assert.equal((await f.control('Paraderos')).value, false, 'partly shown reads off');
  assert.match(await f.text(), /Paraderos · algunas/);
  const ids = async () => (await f.map()).stops.map((stop: string[]) => stop[0]).sort();
  assert.deepEqual(await ids(), [
    'CORNER_NB',
    'CORNER_SB',
    'MIDDLE_NB',
    'MIDDLE_SB',
    'ORIGIN_NB',
    'ORIGIN_SB',
  ]);
  await f.click('Paraderos de la ruta 20');
  assert.equal((await ids()).length, 12);
  await f.click('Ocultar rutas');
  assert.equal((await ids()).length, 12, 'folding only hides the controls');
  await f.click('Paraderos');
  assert.equal((await f.control('Paraderos')).value, true, 'the parent restores all routes');
  assert.deepEqual((await f.map()).center, original.center);
  assert.deepEqual((await f.map()).places, original.places);
});

test('category and trip filters handle zero, one or two endpoints without affecting the other map', async () => {
  const a = fixture(),
    b = fixture();
  const ids = async () => (await a.map()).places.map((p: { id: string }) => p.id);
  await a.click('Mostrar categorías');
  await a.click('Mis lugares');
  await a.click('Lugares de categoría gym');
  assert.deepEqual(await ids(), ['fit', 'fanshawe']);
  assert.equal((await b.map()).places.length, 4, 'another map owns its own selection');
  await a.click('Viaje');
  assert.deepEqual(await ids(), []);
  a.props.tripPlaceIds = ['home'];
  assert.deepEqual(await ids(), ['home']);
  a.props.tripPlaceIds = ['fit', 'home'];
  assert.deepEqual(await ids(), ['fit', 'home']);
  await a.click('Viaje');
  assert.deepEqual(await ids(), ['fit', 'fanshawe'], 'leaving trip mode restores the categories');
  await a.click('Mis lugares');
  assert.equal((await ids()).length, 4, 'the parent restores every place');
  await a.click('Mis lugares');
  await a.click('Lugares de categoría Sin categoría');
  assert.deepEqual(await ids(), ['home']);
  a.props.places = a.props.places.map((p) => (p.id === 'store' ? { ...p, category: 'Nueva' } : p));
  assert.equal((await a.control('Lugares de categoría Nueva')).accessibilityState.selected, false);
  await a.click('Lugares de categoría Nueva');
  assert.deepEqual(await ids(), ['store', 'home'], 'a newly saved category becomes selectable');
});
