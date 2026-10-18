import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as activeTrip from '../transit/active-trip.ts';
import { database, plannerFixture } from '../transit/fixtures.ts';
import * as store from '../transit/store.ts';
import * as tripStore from '../transit/trip-store.ts';
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
  const props: Record<string, any> = {
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
    '../transit/trip-store.ts': tripStore,
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

test('choosing a place point from a stop copies its coordinates instead of changing the inspected stop', async () => {
  const f = await fixture();
  const points: { lat: number; lng: number }[] = [];
  const stops: string[] = [];
  Object.assign(f.props, {
    onPoint: (point: { lat: number; lng: number }) => points.push(point),
    onStop: (id: string) => stops.push(id),
  });
  (await f.map()).onStop('ORIGIN_SB');
  assert.deepEqual(points, [{ lat: 43.0003, lng: -81.2001 }]);
  assert.deepEqual(stops, []);
  Object.assign(f.props, { onPoint: undefined });
  (await f.map()).onStop('ORIGIN_SB');
  assert.deepEqual(stops, ['ORIGIN_SB'], 'ordinary exploration still selects the stop');
});

test('an accepted walk preview can save its path and seed minutes even before manual minutes exist', async () => {
  const f = await fixture();
  f.props.preview = {
    key: 1,
    walk: {
      id: 'obs-1',
      trip_id: 'trip-1',
      kind: 'access',
      place_id: f.id,
      from_stop: null,
      to_stop: 'MIDDLE_SB',
      started_at: 0,
      left_at: null,
      ended_at: 5 * 60_000,
      start_source: 'tap',
      end_source: 'gps',
      accuracy_m: 8,
      path_m: 320,
      straight_m: 250,
      planned_minutes: 4,
      trace: JSON.stringify([
        [43, -81.2, 0],
        [42.994, -81.2001, 5 * 60_000],
      ]),
      flag: null,
      status: 'accepted',
      created_at: 5 * 60_000,
    },
  };
  const saveButton = await f.control('Guardar camino');
  assert.equal(saveButton.disabled, false);
  saveButton.onPress();
  await f.screen.settle();
  const saved = (await store.listWalkLinks(f.db, f.id)).find((w) => w.stop_id === 'MIDDLE_SB')!;
  assert.equal(saved.minutes, 5);
  assert.equal(walks.parsePath(saved.path).length, 2);
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
