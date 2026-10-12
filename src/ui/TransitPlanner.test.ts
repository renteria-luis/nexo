import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plannerFixture } from '../transit/fixtures.ts';
import * as planner from '../transit/planner.ts';
import * as realtime from '../transit/realtime.ts';
import * as scheduleModule from '../transit/schedule.ts';
import { buildStopIndex, queryInstant } from '../transit/schedule.ts';
import type { Place, StopWalk, WalkLink } from '../transit/store.ts';
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
  updated_at: 0,
});
const places = [place('start', 'Start', 43, -81.2), place('end', 'End', 42.9878, -81.17)];

function mount(saved: unknown[], lives: unknown[]) {
  // Modules with type parameters are passed in already loaded: the renderer reads every file as
  // TSX, where `<T>` would parse as markup.
  return renderModule('src/ui/TransitPlanner.tsx', {
    '../transit/planner.ts': planner,
    '../transit/realtime.ts': realtime,
    '../transit/schedule.ts': scheduleModule,
    './icons.ts': new Proxy({}, { get: (_, name) => String(name) }),
    './TextField.tsx': { TextField: 'TextField' },
    '../transit/store.ts': {
      listWalkLinks: async (): Promise<WalkLink[]> => [],
      listStopWalks: async (): Promise<StopWalk[]> => [],
      saveStopWalk: async (_db: unknown, walk: unknown) => {
        saved.push(walk);
      },
      saveWalkLink: async (_db: unknown, link: unknown) => {
        saved.push(link);
      },
    },
  }).mount('TransitPlanner', {
    db: {},
    schedule,
    stopIndex: buildStopIndex(schedule),
    places,
    initialOrigin: 'start',
    snapshot: null,
    active: false,
    today: '2026-10-13',
    walksVersion: 0,
    onLive: (live: unknown) => lives.push(live),
  });
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
  const screen = mount(saved, lives as unknown[]);
  let tree = await screen.settle();
  assert.match(textOf(tree), /Elige a dónde vas/);
  byLabel(tree, 'Hasta End').props.onPress();
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
});

test('the same place on both ends asks for two places instead of searching', async (t) => {
  t.mock.method(Date, 'now', () => queryInstant('2026-10-13', '08:00'));
  const screen = mount([], []);
  let tree = await screen.settle();
  byLabel(tree, 'Hasta Start').props.onPress();
  tree = await screen.settle();
  assert.match(textOf(tree), /Elige dos lugares distintos/);
});
