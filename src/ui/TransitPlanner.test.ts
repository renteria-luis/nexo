import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plannerFixture } from '../transit/fixtures.ts';
import * as mapLayers from '../transit/map.ts';
import * as planner from '../transit/planner.ts';
import * as realtime from '../transit/realtime.ts';
import * as scheduleModule from '../transit/schedule.ts';
import * as stopChoices from '../transit/stop-choices.ts';
import { buildStopIndex, queryInstant } from '../transit/schedule.ts';
import {
  nearestPlace,
  sortPlaces,
  type Place,
  type StopWalk,
  type WalkLink,
} from '../transit/store.ts';
import * as walks from '../transit/walks.ts';
import { nodes, renderModule, textOf } from './test-render.ts';

const schedule = plannerFixture();
const place = (id: string, name: string, lat: number, lng: number): Place => ({
  id,
  name,
  address: '',
  lat,
  lng,
  gym_id: null,
  icon: 'pin',
  tags: '',
  category: '',
  importance: null,
  updated_at: 0,
});
const places = [place('start', 'Start', 43, -81.2), place('end', 'End', 42.9878, -81.17)];

function mount(saved: unknown[], changes: Record<string, unknown>) {
  // Modules with type parameters are passed in already loaded: the renderer reads every file as
  // TSX, where `<T>` would parse as markup.
  return renderModule('src/ui/TransitPlanner.tsx', {
    '../transit/map.ts': mapLayers,
    '../transit/planner.ts': planner,
    '../transit/realtime.ts': realtime,
    '../transit/stop-choices.ts': stopChoices,
    '../transit/schedule.ts': scheduleModule,
    '../transit/walks.ts': walks,
    '../transit/trip-store.ts': { listAcceptedWalks: async () => [] },
    './icons.ts': new Proxy({}, { get: (_, name) => String(name) }),
    './TextField.tsx': { TextField: 'TextField' },
    './Combobox.tsx': { Combobox: 'Combobox' },
    './TransitPlanMap.tsx': { TransitPlanMap: 'TransitPlanMap' },
    './screens/Screen.tsx': { useScrollIntoView: () => () => undefined },
    '../transit/store.ts': {
      sortPlaces,
      nearestPlace,
      listWalkLinks: async (): Promise<WalkLink[]> => [],
      listStopWalks: async (): Promise<StopWalk[]> => [],
      saveStopWalk: async (_db: unknown, walk: unknown) => {
        saved.push(walk);
      },
      saveWalkLink: async (_db: unknown, link: unknown) => {
        saved.push(link);
      },
    },
  }).mount('TransitPlanner', changes);
}

// Props stay one object, so a test can change one between renders, as the screen would.
function props(lives: unknown[], changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    db: {},
    schedule,
    stopIndex: buildStopIndex(schedule),
    places,
    // He opens Transit at Start.
    here: { point: { lat: 43, lng: -81.2 }, at: 0 },
    onLocate: () => undefined,
    onFindAddress: async () => null,
    snapshot: null,
    active: false,
    today: '2026-10-13',
    walksVersion: 0,
    onLive: (live: unknown) => lives.push(live),
    ...changes,
  };
}

// The search yields to the screen between slices with timers, which settle() alone does not run.
async function searched(screen: ReturnType<typeof mount>, done: (tree: unknown) => boolean) {
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    const tree = await screen.settle();
    if (done(tree)) return tree;
  }
  throw new Error('the search never finished');
}

const picker = (tree: unknown, label: string) =>
  nodes(tree).find((n) => n.type === 'Combobox' && n.props.accessibilityLabel === label)!.props;

const byLabel = (tree: unknown, label: string | RegExp) =>
  nodes(tree).find((n) =>
    typeof label === 'string'
      ? n.props?.accessibilityLabel === label
      : label.test(n.props?.accessibilityLabel ?? ''),
  )!;

const mapOf = (tree: unknown) => nodes(tree).find((n) => n.type === 'TransitPlanMap')!.props;

// Leaving now: tap a stop in the list, then Ver or Elegir in the window over the map.
async function openStop(
  screen: ReturnType<typeof mount>,
  tree: unknown,
  rank: number,
  view: 'lines' | 'buses',
) {
  byLabel(tree, new RegExp(`^Paradero ${rank},`)).props.onPress();
  const shown = await screen.settle();
  mapOf(shown).popup.props.onView(view);
  return screen.settle();
}

test('choosing where to go lists the options with their lines, and a tight one names its backup', async (t) => {
  t.mock.method(Date, 'now', () => queryInstant('2026-10-13', '08:00'));
  const saved: unknown[] = [];
  const lives: { stops: string[]; ride: unknown }[] = [];
  let walkChanges = 0;
  const screen = mount(saved, props(lives, { onWalkChanged: () => walkChanges++ }));
  let tree = await screen.settle();
  assert.match(textOf(tree), /Elige a dónde vas/);
  picker(tree, 'Elegir el destino').onChange('end');
  tree = await searched(screen, (current) => !!byLabel(current, /^Paradero 1,/));
  tree = await openStop(screen, tree, 1, 'buses');
  const text = textOf(tree);
  assert.match(text, /08:17 → 08:41/);
  assert.match(text, /24 min · 1 transbordo · sal en 17 min · justo/);
  assert.match(text, /Si pierdes el transbordo: 20 de las 08:45, llegas 08:56/);
  assert.ok(byLabel(tree, 'Línea 92'), 'the line badge carries its number');
  assert.deepEqual(lives.at(-1), {
    stops: ['ORIGIN_SB', 'CORNER_SB', 'CORNER_EB', 'END_EB'],
    ride: null,
  });

  byLabel(tree, /^Sales 08:17, llegas 08:41/).props.onPress();
  tree = await screen.settle();
  const steps = textOf(tree);
  assert.match(steps, /camina 1 min a ORIGIN SB/);
  assert.match(steps, /estimado · 34 m en línea recta/);
  assert.match(steps, /Transbordo: camina 2 min a CORNER EB/);
  assert.match(steps, /margen 3 min · justo/);
  assert.match(
    steps,
    /Justo: si pierdes el 20, el 20 de las 08:45 sale de CORNER EB y llegas 08:56/,
  );

  const editors = nodes(tree).filter(
    (n) => n.props?.accessibilityLabel === 'Corregir con tus minutos',
  );
  assert.equal(editors.length, 3, 'access, transfer and final walks can be corrected');
  editors[1].props.onPress();
  tree = await screen.settle();
  nodes(tree)
    .find((n) => n.type === 'TextField')!
    .props.onChange('4');
  tree = await screen.settle();
  nodes(tree)
    .find((n) => n.props?.accessibilityLabel === 'Guardar' || n.props?.label === 'Guardar')!
    .props.onPress();
  await searched(screen, () => saved.length > 0);
  assert.deepEqual(saved, [{ from_stop: 'CORNER_SB', to_stop: 'CORNER_EB', minutes: 4, note: '' }]);
  assert.equal(walkChanges, 1, 'the map and saved journey refresh after the transfer is saved');
});

test('the same place on both ends asks for two places instead of searching', async (t) => {
  t.mock.method(Date, 'now', () => queryInstant('2026-10-13', '08:00'));
  const screen = mount([], props([]));
  let tree = await screen.settle();
  picker(tree, 'Elegir el destino').onChange('start');
  tree = await screen.settle();
  assert.match(textOf(tree), /Elige dos lugares distintos/);
});

test('the pickers offer his places by importance, with their icon and the tags they are found by', async (t) => {
  t.mock.method(Date, 'now', () => queryInstant('2026-10-13', '08:00'));
  const ranked = [
    { ...place('start', 'Start', 43, -81.2), icon: 'home' as const },
    { ...place('zoo', 'Zoo', 43.01, -81.21), importance: 2 },
    { ...place('end', 'End', 42.9878, -81.17), tags: 'gym, fit', importance: 1 },
  ];
  const screen = mount([], props([], { places: ranked }));
  const tree = await screen.settle();
  const saved = (label: string) =>
    picker(tree, label).options.filter((o: { id: string }) => !o.id.startsWith('@'));
  const options = saved('Elegir el destino');
  assert.deepEqual(
    options.map((o: { label: string }) => o.label),
    ['End', 'Zoo', 'Start'],
  );
  assert.equal(options[0].keywords, 'gym, fit');
  assert.equal(options[2].icon, 'House', 'each place keeps its icon');
  assert.deepEqual(saved('Elegir el origen'), options);
  assert.deepEqual(
    picker(tree, 'Elegir el origen')
      .options.slice(0, 2)
      .map((o: { label: string }) => o.label),
    ['Tu ubicación', 'Punto en el mapa'],
  );
  assert.deepEqual(
    picker(tree, 'Elegir el destino')
      .options.slice(0, 2)
      .map((o: { label: string }) => o.label),
    ['Buscar una dirección', 'Punto en el mapa'],
  );
});

test('the trip starts where he is, as his saved place when he is at one, unless he chose since', async (t) => {
  let now = queryInstant('2026-10-13', '08:00');
  t.mock.method(Date, 'now', () => now);
  const shown = props([], { places: [...places, place('zoo', 'Zoo', 43.01, -81.21)] });
  const screen = mount([], shown);
  let tree = await screen.settle();
  assert.equal(picker(tree, 'Elegir el origen').value, '@here');
  assert.equal(mapOf(tree).origin.id, 'start');
  assert.equal(mapOf(tree).origin.name, 'Tu ubicación · Start');
  shown.here = { point: { lat: 43.0045, lng: -81.205 }, at: now };
  tree = await screen.settle();
  assert.equal(mapOf(tree).origin.id, '@here', 'away from his places it is just where he is');
  assert.equal(mapOf(tree).origin.saved, false);
  now += 1_000;
  picker(tree, 'Elegir el origen').onChange('end');
  tree = await screen.settle();
  shown.here = { point: { lat: 43.01, lng: -81.21 }, at: now - 500 };
  tree = await screen.settle();
  assert.equal(
    picker(tree, 'Elegir el origen').value,
    'end',
    'a reading asked for before his choice lands after it and does not undo it',
  );
  shown.here = { point: { lat: 43.01, lng: -81.21 }, at: now + 60_000 };
  tree = await screen.settle();
  assert.equal(picker(tree, 'Elegir el origen').value, '@here', 'the next visit reads again');
  assert.equal(mapOf(tree).origin.id, 'zoo');
});

test('Ver más shows every option, not only ten', async (t) => {
  t.mock.method(Date, 'now', () => queryInstant('2026-10-13', '07:15'));
  const busy = plannerFixture();
  for (let i = 0; i < 16; i++)
    busy.trips.push([`92S-Y${i}`, 2, 'daily', 'Express', 1, '', 5, (7 * 60 + 20 + 5 * i) * 60]);
  const screen = mount(
    [],
    props([], {
      schedule: busy,
      stopIndex: buildStopIndex(busy),
      places: [...places, place('corner', 'Corner', 42.9879, -81.2003)],
      journey: {
        id: 'later',
        originId: 'start',
        destinationId: 'corner',
        mode: 'depart',
        at: queryInstant('2026-10-13', '07:15'),
        workoutId: null,
        selectedKey: null,
        selectedAt: null,
        reminders: false,
      },
    }),
  );
  let tree = await searched(screen, (current) => /Ver \d+ más/.test(textOf(current)));
  const rows = (current: unknown) =>
    nodes(current).filter((n) => /^Sales /.test(n.props?.accessibilityLabel ?? '')).length;
  assert.equal(rows(tree), 5);
  const more = Number(/Ver (\d+) más/.exec(textOf(tree))![1]);
  assert.ok(more > 5, `${more} more options than the five shown`);
  nodes(tree)
    .find((n) => n.props?.accessibilityState?.expanded === false && /Ver \d+ más/.test(textOf(n)))!
    .props.onPress();
  tree = await screen.settle();
  assert.equal(rows(tree), 5 + more);
});

test('the map follows both pickers and the expanded option, and clears when either is removed', async (t) => {
  t.mock.method(Date, 'now', () => queryInstant('2026-10-13', '08:00'));
  const endpoints: string[][] = [];
  const settings = props([], {
    here: null,
    onPlacesChange: (ids: string[]) => endpoints.push(ids),
  });
  const screen = mount([], settings);
  const map = mapOf;
  let tree = await screen.settle();
  assert.equal(map(tree).origin, undefined);
  picker(tree, 'Elegir el destino').onChange('end');
  tree = await screen.settle();
  assert.equal(map(tree).origin, undefined);
  assert.equal(map(tree).target.id, 'end');
  assert.deepEqual(endpoints.at(-1), ['end']);
  picker(tree, 'Elegir el origen').onChange('start');
  tree = await searched(screen, (current) => !!byLabel(current, /^Paradero 1,/));
  assert.ok(map(tree).choices.length > 0, 'the stops he can board at are on the map');
  tree = await openStop(screen, tree, 1, 'buses');
  assert.equal(map(tree).origin.id, 'start');
  assert.deepEqual(endpoints.at(-1), ['start', 'end']);
  assert.equal(map(tree).target.id, 'end');
  assert.equal(map(tree).option, null);
  const rows = nodes(tree).filter((n) => /^Sales /.test(n.props.accessibilityLabel ?? ''));
  rows[0].props.onPress();
  tree = await screen.settle();
  const first = map(tree).option;
  assert.ok(first);
  const others = nodes(tree).filter((n) => /^Sales /.test(n.props.accessibilityLabel ?? ''));
  others[1].props.onPress();
  tree = await screen.settle();
  assert.notEqual(map(tree).option.scheduleKey, first.scheduleKey);
  byLabel(tree, 'Quitar desde').props.onPress();
  tree = await screen.settle();
  assert.equal(map(tree).origin, undefined);
  assert.equal(map(tree).target.id, 'end');
  assert.deepEqual(endpoints.at(-1), ['end']);
  assert.equal(map(tree).option, null);
});

test('pull refresh reruns now plans without changing selected places', async (t) => {
  let now = queryInstant('2026-10-13', '08:00');
  t.mock.method(Date, 'now', () => now);
  const settings = props([], { refreshAt: 0 });
  const screen = mount([], settings);
  let tree = await screen.settle();
  picker(tree, 'Elegir el destino').onChange('end');
  tree = await searched(screen, (current) => !!byLabel(current, /^Paradero 1,/));
  now += 12 * 60_000;
  settings.refreshAt = now;
  tree = await searched(screen, (current) => !textOf(current).includes('Actualizando…'));
  assert.equal(picker(tree, 'Elegir el origen').value, '@here');
  assert.equal(picker(tree, 'Elegir el destino').value, 'end');
  assert.ok(byLabel(tree, /^Paradero 1,/));
});

test('pull refresh preserves an explicitly scheduled departure time', async (t) => {
  const now = queryInstant('2026-10-13', '07:00');
  t.mock.method(Date, 'now', () => now);
  const settings = props([], {
    refreshAt: 0,
    journey: {
      originId: 'start',
      destinationId: 'end',
      mode: 'depart',
      at: now + 3_600_000,
    },
  });
  const screen = mount([], settings);
  let tree = await searched(screen, (current) => !!byLabel(current, /^Sales /));
  const rowLabels = (tree: unknown) =>
    nodes(tree)
      .map((n) => n.props.accessibilityLabel)
      .filter((label) => /^Sales /.test(label ?? ''));
  const before = rowLabels(tree);
  settings.refreshAt = now + 20 * 60_000;
  tree = await screen.settle();
  assert.deepEqual(rowLabels(tree), before);
  assert.equal(picker(tree, 'Elegir el origen').value, 'start');
  assert.equal(picker(tree, 'Elegir el destino').value, 'end');
});

test('leaving now, the bus he just missed comes first, says so and cannot be chosen', async (t) => {
  for (const [clock, seconds, says] of [
    ['08:23', 0, 'pasó hace 3 min'],
    ['08:18', 30, 'probablemente no llegues'],
  ] as const) {
    const now = queryInstant('2026-10-13', clock) + seconds * 1_000;
    t.mock.method(Date, 'now', () => now);
    const screen = mount([], props([], { onSelectJourney: async () => undefined }));
    let tree = await screen.settle();
    picker(tree, 'Elegir el destino').onChange('end');
    tree = await searched(screen, (current) => !!byLabel(current, /^Paradero 1,/));
    tree = await openStop(screen, tree, 1, 'buses');
    assert.match(textOf(tree), new RegExp(`24 min · 1 transbordo · ${says}`));
    assert.doesNotMatch(textOf(tree), new RegExp(`${says} · justo`));
    byLabel(tree, /^Sales 08:17, llegas 08:41/).props.onPress();
    tree = await screen.settle();
    assert.equal(byLabel(tree, 'Elegir este viaje').props.disabled, true);
  }
});

test('choosing a trip marks it at once and keeps the list; one chosen elsewhere replaces it', async (t) => {
  const now = queryInstant('2026-10-13', '08:00');
  t.mock.method(Date, 'now', () => now);
  const chosen: string[] = [];
  const trip = (changes: Record<string, unknown>) => ({
    workoutId: null,
    selectedAt: null,
    reminders: false,
    ...changes,
  });
  const settings: Record<string, unknown> = props([], {
    onSelectJourney: async (choice: Record<string, unknown>, option: { scheduleKey: string }) => {
      chosen.push(option.scheduleKey);
      settings.journey = trip({
        id: 'here',
        ...choice,
        selectedKey: option.scheduleKey,
        selectedAt: now,
      });
    },
  });
  const screen = mount([], settings);
  let tree = await screen.settle();
  picker(tree, 'Elegir el destino').onChange('end');
  tree = await searched(screen, (current) => !!byLabel(current, /^Paradero 1,/));
  tree = await openStop(screen, tree, 1, 'buses');
  byLabel(tree, /^Sales 08:17, llegas 08:41/).props.onPress();
  tree = await screen.settle();
  byLabel(tree, 'Elegir este viaje').props.onPress();
  tree = await screen.settle();
  assert.equal(chosen.length, 1);
  assert.match(textOf(tree), /Viaje elegido/);
  assert.match(textOf(tree), /elegido · 24 min/);
  assert.doesNotMatch(textOf(tree), /Actualizando…/, 'no new search');
  assert.equal(picker(tree, 'Elegir el destino').value, 'end');

  settings.journey = trip({
    id: 'today',
    originId: 'end',
    destinationId: 'start',
    mode: 'now',
    at: now,
    selectedKey: null,
  });
  tree = await searched(
    screen,
    (current) =>
      picker(current, 'Elegir el origen').value === 'end' && !!byLabel(current, /^Paradero 1,/),
  );
  assert.doesNotMatch(textOf(tree), /Viaje elegido/);
});

test('from where he is, a stop shows its lines and their route, and he leaves on one of its buses', async (t) => {
  const now = queryInstant('2026-10-13', '08:00');
  t.mock.method(Date, 'now', () => now);
  const left: Record<string, any>[] = [];
  const screen = mount(
    [],
    props([], {
      // Between his places, so it is just where he is.
      here: { point: { lat: 43.0012, lng: -81.2001 }, at: 0 },
      onLeave: async (input: Record<string, any>) => {
        left.push(input);
      },
    }),
  );
  let tree = await screen.settle();
  picker(tree, 'Elegir el destino').onChange('end');
  // With one stop near him the search looks farther, to offer more than one.
  tree = await searched(
    screen,
    (current) => !!byLabel(current, /^Paradero 2,/) && !/Actualizando/.test(textOf(current)),
  );
  assert.match(textOf(tree), /2 min a pie \(estimado\) · 100 m al sur/);
  assert.match(textOf(tree), /busqué hasta 3 km/);
  assert.deepEqual(
    mapOf(tree).choices.map((c: { id: string; rank: number }) => [c.id, c.rank]),
    [
      ['ORIGIN_SB', 1],
      ['CORNER_EB', 2],
    ],
  );

  tree = await openStop(screen, tree, 1, 'lines');
  assert.match(textOf(tree), /Solo las líneas de este paradero que te llevan/);
  byLabel(tree, /^Línea 92 hacia /).props.onPress();
  tree = await screen.settle();
  assert.equal(mapOf(tree).line.trip[0], '92S-1', 'the map draws the line he opened and its bus');

  byLabel(tree, 'Volver a los paraderos').props.onPress();
  tree = await screen.settle();
  assert.equal(mapOf(tree).line, null);
  tree = await openStop(screen, tree, 1, 'buses');
  byLabel(tree, /^Sales 08:16, llegas 08:41/).props.onPress();
  tree = await screen.settle();
  byLabel(tree, 'Salgo ahora').props.onPress();
  await searched(screen, () => left.length > 0);
  assert.deepEqual(
    [left[0].origin.point, left[0].origin.name, left[0].destination.id],
    [true, 'Tu ubicación', 'end'],
  );
  assert.equal(left[0].option.itinerary.rides[0].trip[0], '92S-1');
});

test('a destination found by its address and a start tapped on the map can be looked at only', async (t) => {
  const now = queryInstant('2026-10-13', '08:00');
  t.mock.method(Date, 'now', () => now);
  const asked: string[] = [];
  const screen = mount(
    [],
    props([], {
      onLeave: async () => undefined,
      onFindAddress: async (text: string) => {
        asked.push(text);
        return { lat: 42.9878, lng: -81.17 };
      },
    }),
  );
  let tree = await screen.settle();
  picker(tree, 'Elegir el destino').onChange('@search');
  tree = await screen.settle();
  byLabel(tree, 'Dirección del destino').props.onChange('1 End St');
  tree = await screen.settle();
  byLabel(tree, 'Buscar').props.onPress();
  tree = await searched(screen, (current) => !!byLabel(current, /^Paradero 1,/));
  assert.deepEqual(asked, ['1 End St']);
  assert.equal(picker(tree, 'Elegir el destino').value, '@point');
  assert.equal(mapOf(tree).target.name, '1 End St');

  picker(tree, 'Elegir el origen').onChange('@map');
  tree = await screen.settle();
  assert.match(textOf(tree), /Toca el mapa donde sales/);
  mapOf(tree).onPoint({ lat: 43.0012, lng: -81.2001 });
  tree = await searched(screen, (current) => !!byLabel(current, /^Paradero 1,/));
  assert.equal(mapOf(tree).origin.name, 'Punto en el mapa');
  tree = await openStop(screen, tree, 1, 'buses');
  byLabel(tree, /^Sales 08:16, llegas 08:41/).props.onPress();
  tree = await screen.settle();
  assert.match(textOf(tree), /Desde un punto del mapa solo puedes mirar/);
  assert.equal(byLabel(tree, 'Salgo ahora'), undefined);
});
