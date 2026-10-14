import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as activeTrip from '../transit/active-trip.ts';
import { database, plannerFixture } from '../transit/fixtures.ts';
import * as store from '../transit/store.ts';
import * as walks from '../transit/walks.ts';
import { nodes, renderModule, textOf } from './test-render.ts';

async function fixture() {
  const { db } = await database();
  const id = await store.savePlace(db, { name: 'Origin', address: '', lat: 43, lng: -81.2 });
  const places = await store.listPlaces(db);
  await store.saveWalkLink(db, {
    place_id: id,
    stop_id: 'ORIGIN_SB',
    direction: 'to_stop',
    minutes: 3,
    entrance: '',
  });
  await store.saveWalkLink(db, {
    place_id: id,
    stop_id: 'ORIGIN_SB',
    direction: 'from_stop',
    minutes: 4,
    entrance: '',
  });
  const props = {
    db,
    revision: 0,
    onChanged: () => {
      props.revision++;
    },
    preview: null,
    schedule: plannerFixture(),
    places,
    center: places.find((p) => p.id === id),
    stops: [],
    selectedPlace: id,
    selectedStop: null,
    draft: null,
    snapshot: null,
    active: true,
    followed: null,
    focusKey: null,
    onPlace() {},
    onStop() {},
  };
  const screen = renderModule('src/ui/TransitPersonalMap.tsx', {
    '../shell/TransitJourney.tsx': { useTransitJourney: () => ({ trip: null }) },
    '../transit/active-trip.ts': activeTrip,
    '../transit/store.ts': store,
    '../transit/walks.ts': walks,
    './TransitLiveMap.tsx': { TransitLiveMap: 'TransitLiveMap' },
    './Button.tsx': { Button: 'Button' },
    './Chip.tsx': { Chip: 'Chip' },
    './Combobox.tsx': { Combobox: 'Combobox' },
    './TextField.tsx': { TextField: 'TextField' },
  }).mount('TransitPersonalMap', props);
  const control = async (label: string) => {
    const node = nodes(await screen.settle()).find(
      (n) => n.props.label === label || n.props.accessibilityLabel === label,
    );
    assert.ok(node, label);
    return node.props;
  };
  const map = async () =>
    nodes(await screen.settle()).find((n) => n.type === 'TransitLiveMap')!.props;
  return { db, id, props, screen, control, map };
}

test('drawing, undo and cancel keep paths directional and preserve the entered minutes', async () => {
  const f = await fixture();
  const picker = await f.control('Camino de caminata');
  picker.onChange(picker.options.find((o: any) => o.target.direction === 'to_stop').id);
  (await f.control('Dibujar o editar camino')).onPress();
  (await f.map()).onPoint({ lat: 43, lng: -81.2 });
  (await f.map()).onPoint({ lat: 43.0003, lng: -81.2001 });
  (await f.map()).onPoint({ lat: 44, lng: -81 });
  (await f.control('Deshacer punto')).onPress();
  (await f.control('Guardar camino')).onPress();
  await f.screen.settle();
  const saved = await store.listWalkLinks(f.db, f.id);
  assert.equal(saved.find((w) => w.direction === 'to_stop')!.minutes, 3);
  assert.equal(walks.parsePath(saved.find((w) => w.direction === 'to_stop')!.path).length, 2);
  assert.equal(saved.find((w) => w.direction === 'from_stop')!.path, '');
  (await f.control('Dibujar o editar camino')).onPress();
  (await f.map()).onPoint({ lat: 44, lng: -81 });
  (await f.control('Cancelar camino')).onPress();
  assert.deepEqual(await store.listWalkLinks(f.db, f.id), saved);
});

test('crossings validate waits, persist edits and require an explicit delete confirmation', async () => {
  const f = await fixture();
  (await f.control('Añadir cruce')).onPress();
  assert.equal((await f.control('Guardar cruce')).disabled, true);
  (await f.map()).onPoint({ lat: 43.0001, lng: -81.2 });
  (await f.control('Botón peatonal')).onPress();
  (await f.control('Nota del cruce')).onChange('Press the button');
  (await f.control('Espera mínima en segundos')).onChange('90');
  (await f.control('Espera máxima en segundos')).onChange('20');
  (await f.control('Guardar cruce')).onPress();
  assert.match(textOf(await f.screen.settle()), /la menor primero/);
  assert.deepEqual(await store.listMapNotes(f.db), []);
  (await f.control('Espera máxima en segundos')).onChange('120');
  (await f.control('Guardar cruce')).onPress();
  await f.screen.settle();
  const saved = (await store.listMapNotes(f.db))[0];
  assert.equal(saved.kind, 'button');
  assert.equal(saved.wait_max, 120);
  (await f.map()).onNote(saved.id);
  (await f.control('Nota del cruce')).onChange('North button');
  (await f.control('Guardar cruce')).onPress();
  await f.screen.settle();
  assert.equal((await store.listMapNotes(f.db))[0].note, 'North button');
  (await f.map()).onNote(saved.id);
  (await f.control('Eliminar cruce')).onPress();
  assert.equal((await store.listMapNotes(f.db)).length, 1);
  (await f.control('Confirmar eliminación del cruce')).onPress();
  await f.screen.settle();
  assert.deepEqual(await store.listMapNotes(f.db), []);
});
