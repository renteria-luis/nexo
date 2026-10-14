import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plannerFixture } from '../transit/fixtures.ts';
import * as planner from '../transit/planner.ts';
import * as realtime from '../transit/realtime.ts';
import * as scheduleModule from '../transit/schedule.ts';
import { buildStopIndex, queryInstant } from '../transit/schedule.ts';
import { sortPlaces, type Place, type StopWalk, type WalkLink } from '../transit/store.ts';
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
  importance: null,
  updated_at: 0,
});
const places = [place('start', 'Start', 43, -81.2), place('end', 'End', 42.9878, -81.17)];

function mount(saved: unknown[], changes: Record<string, unknown>) {
  // Modules with type parameters are passed in already loaded: the renderer reads every file as
  // TSX, where `<T>` would parse as markup.
  return renderModule('src/ui/TransitPlanner.tsx', {
    '../transit/planner.ts': planner,
    '../transit/realtime.ts': realtime,
    '../transit/schedule.ts': scheduleModule,
    '../transit/walks.ts': walks,
    '../transit/trip-store.ts': { listAcceptedWalks: async () => [] },
    './icons.ts': new Proxy({}, { get: (_, name) => String(name) }),
    './TextField.tsx': { TextField: 'TextField' },
    './Combobox.tsx': { Combobox: 'Combobox' },
    '../transit/store.ts': {
      sortPlaces,
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
    initialOrigin: 'start',
    located: null,
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

test('choosing where to go lists the options with their lines, and a tight one names its backup', async (t) => {
  t.mock.method(Date, 'now', () => queryInstant('2026-10-13', '08:00'));
  const saved: unknown[] = [];
  const lives: { stops: string[]; ride: unknown }[] = [];
  let walkChanges = 0;
  const screen = mount(saved, props(lives, { onWalkChanged: () => walkChanges++ }));
  let tree = await screen.settle();
  assert.match(textOf(tree), /Elige a dónde vas/);
  picker(tree, 'Elegir el destino').onChange('end');
  tree = await searched(screen, (current) => /→/.test(textOf(current)));
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
  const options = picker(tree, 'Elegir el destino').options;
  assert.deepEqual(
    options.map((o: { label: string }) => o.label),
    ['End', 'Zoo', 'Start'],
  );
  assert.equal(options[0].keywords, 'gym, fit');
  assert.equal(options[2].icon, 'House', 'each place keeps its icon');
  assert.deepEqual(picker(tree, 'Elegir el origen').options, options);
});

test('the trip starts at the place nearest to where he opened Transit, unless he chose one since', async (t) => {
  let now = queryInstant('2026-10-13', '08:00');
  t.mock.method(Date, 'now', () => now);
  const shown = props([], { places: [...places, place('zoo', 'Zoo', 43.01, -81.21)] });
  const screen = mount([], shown);
  let tree = await screen.settle();
  assert.equal(picker(tree, 'Elegir el origen').value, 'start');
  shown.located = { id: 'zoo', at: now };
  tree = await screen.settle();
  assert.equal(picker(tree, 'Elegir el origen').value, 'zoo');
  now += 1_000;
  picker(tree, 'Elegir el origen').onChange('end');
  tree = await screen.settle();
  shown.located = { id: 'zoo', at: now - 500 };
  tree = await screen.settle();
  assert.equal(
    picker(tree, 'Elegir el origen').value,
    'end',
    'a reading asked for before his choice lands after it and does not undo it',
  );
  shown.located = { id: 'start', at: now + 60_000 };
  tree = await screen.settle();
  assert.equal(picker(tree, 'Elegir el origen').value, 'start', 'the next visit reads again');
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
    }),
  );
  let tree = await screen.settle();
  picker(tree, 'Elegir el destino').onChange('corner');
  tree = await searched(screen, (current) => /Ver \d+ más/.test(textOf(current)));
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
