import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as activeTrip from '../transit/active-trip.ts';
import { plannerFixture } from '../transit/fixtures.ts';
import { buildPlannerIndex, liveOptions, startPlan } from '../transit/planner.ts';
import * as schedules from '../transit/schedule.ts';
import { nodes, renderModule, textOf } from './test-render.ts';

const at = (clock: string) => schedules.queryInstant('2026-10-13', clock);

function trip() {
  const schedule = plannerFixture();
  const search = startPlan(buildPlannerIndex(schedule), {
    origin: { lat: 43.0015, lng: -81.2001 },
    destination: { lat: 42.987, lng: -81.1701 },
    originWalks: new Map(),
    destinationWalks: new Map(),
    stopWalks: [],
    mode: 'depart',
    at: at('08:00'),
  });
  while (!search.step(1_000));
  const option = liveOptions(search.result(), null, at('08:00')).find(
    (o) => o.itinerary.rides.map((r) => r.trip[0]).join('>') === '16S-4>20E-4',
  )!;
  return activeTrip.freezeTrip({
    id: 'trip',
    journeyId: null,
    schedule,
    option,
    origin: { id: 'origin', name: 'Casa', lat: 43.0015, lng: -81.2001 },
    destination: { id: 'destination', name: 'Trabajo', lat: 42.987, lng: -81.1701 },
    now: at('08:25'),
  });
}

function render(journey: Record<string, unknown>, props: Record<string, unknown> = {}) {
  const taps: unknown[] = [];
  const view: any = {
    gps: 'background',
    tripProblem: null,
    tripLive: null,
    now: at('08:28'),
    ...journey,
    actions: {
      tripAction: async (action: string) => {
        taps.push(action);
      },
      takeAlternative: async (tripId: string) => {
        taps.push(`take:${tripId}`);
      },
      dismissTrip: async () => {
        taps.push('dismiss');
      },
    },
  };
  const screen = renderModule('src/ui/TransitActiveTrip.tsx', {
    '../shell/TransitJourney.tsx': { useTransitJourney: () => view },
    '../transit/active-trip.ts': activeTrip,
    '../transit/schedule.ts': schedules,
    './TransitDepartures.tsx': {
      relative: (when: number, now: number) => `en ${Math.round((when - now) / 60_000)} min`,
      TransitTripTimeline: 'TransitTripTimeline',
    },
    './TransitStatus.tsx': { RouteBadge: 'RouteBadge' },
    './TransitTripMap.tsx': { TransitTripMap: 'TransitTripMap' },
    './Button.tsx': { Button: 'Button' },
    './Card.tsx': { Card: 'Card' },
    './InfoBubble.tsx': { InfoDot: 'InfoDot', InfoText: 'InfoText' },
  }).mount('TransitActiveTrip', props);
  const press = async (label: string) => {
    const button = nodes(await screen.settle()).find((node) => node.props.label === label);
    assert.ok(button, label);
    button.props.onPress();
    await screen.settle();
  };
  return { screen, taps, press, view };
}

/** What the card keeps behind its (i). */
function infoOf(tree: unknown): string {
  const card = nodes(tree).find((node) => node.type === 'Card');
  return textOf(card?.props.action);
}

test('waiting at the stop says which bus, when, and lets him confirm boarding', async () => {
  const waiting = activeTrip.applyFix(
    trip(),
    { lat: 43.0004, lng: -81.2001, accuracy: 6, speed: null, at: at('08:27') },
    null,
  ).trip;
  const f = render({ trip: waiting });
  const text = textOf(await f.screen.settle());
  assert.match(text, /Espera el 16 en ORIGIN SB \(#109\)/);
  assert.match(text, /Sale a las 08:30 \(horario, en 2 min\)/);
  assert.doesNotMatch(text, /pantalla bloqueada/, 'how the GPS works is behind the (i)');
  assert.match(infoOf(await f.screen.settle()), /también con la pantalla bloqueada/);
  assert.match(text, /Sin datos en vivo: horas del horario\./);
  await f.press('Ya subí');
  assert.deepEqual(f.taps, ['boarded']);
});

test('riding counts the stops left and labels an inferred boarding as uncertain', async () => {
  const riding = { ...activeTrip.applyAction(trip(), 'boarded', at('08:30')).trip };
  riding.boarded = ['inferred', null];
  const f = render({ trip: riding, now: at('08:31') });
  const text = textOf(await f.screen.settle());
  assert.match(text, /En el 16 hacia Corner/);
  assert.match(text, /Bajas en CORNER SB \(#109\) a las 08:38/);
  assert.match(text, /Quedan 2 paradas/);
  assert.match(text, /Parece que vas en el bus/);
  await f.press('No voy en este bus');
  await f.press('Ya bajé');
  assert.deepEqual(f.taps, ['not-boarded', 'alighted']);
});

test('without permission the buttons carry the trip, and a finished trip shows what it cost', async () => {
  const denied = render({ trip: trip(), gps: 'denied' });
  const text = textOf(await denied.screen.settle());
  assert.match(text, /Sin permiso de ubicación/);
  assert.ok(
    nodes(await denied.screen.settle()).some((n) => n.props.label === 'Abrir ajustes del iPhone'),
  );
  const ended = activeTrip.applyAction(trip(), 'finish', at('08:57')).trip;
  ended.stats = { ...ended.stats, fixes: 240, ignored: 3, liveReads: 12, liveBytes: 96 * 1_024 };
  const f = render({ trip: ended });
  const summary = textOf(await f.screen.settle());
  assert.match(summary, /Viaje terminado/);
  assert.doesNotMatch(summary, /Llegaste/, 'ended before the last walk, it did not arrive');
  assert.match(summary, /32 min desde que saliste, hasta las 08:57/);
  assert.doesNotMatch(summary, /caminata/, 'no walk was timed, so none waits for review');
  const cost = infoOf(await f.screen.settle());
  assert.match(cost, /240 lecturas de GPS \(3 imprecisas\)/);
  assert.match(cost, /12 consultas en vivo con Nexo en segundo plano, 96 KB/);
  await f.press('Cerrar');
  assert.deepEqual(f.taps, ['dismiss']);
});

test('a trip that reaches its last walk and arrives says so, with the walks to review', async () => {
  let next = trip();
  for (const [action, clock] of [
    ['boarded', '08:30'],
    ['alighted', '08:38'],
    ['boarded', '08:45'],
    ['alighted', '08:52'],
    ['arrived', '08:57'],
  ] as const)
    next = activeTrip.applyAction(next, action, at(clock)).trip;
  next.measured = 2;
  const summary = textOf(await render({ trip: next }).screen.settle());
  assert.match(summary, /Llegaste a Trabajo/);
  assert.match(summary, /2 caminatas medidas esperan tu revisión en Transit/);
});

test('on Transit the trip in progress has its own map, and an ended trip does not', async () => {
  const mapped = async (journey: Record<string, unknown>, props: Record<string, unknown>) =>
    nodes(await render({ places: [], ...journey }, props).screen.settle()).some(
      (n) => n.type === 'TransitTripMap',
    );
  assert.ok(await mapped({ trip: trip() }, { map: true }));
  assert.ok(!(await mapped({ trip: trip() }, {})), 'Hoy keeps the card without a map');
  const ended = activeTrip.applyAction(trip(), 'finish', at('08:57')).trip;
  assert.ok(!(await mapped({ trip: ended }, { map: true })));
});

test('the stops of his trip open as Paradas shows them, lit from where he boards to where he gets off', async () => {
  const schedule = plannerFixture();
  const riding = activeTrip.applyAction(trip(), 'boarded', at('08:30')).trip;
  const ride = riding.rides[0];
  const f = render(
    { trip: riding, now: at('08:31'), places: [], tripLive: { schedule, snapshot: null } },
    { map: true },
  );
  await f.press('Ver paradas del viaje');
  const timeline = async () =>
    nodes(await f.screen.settle()).find((node) => node.type === 'TransitTripTimeline');
  const tripMap = async () =>
    nodes(await f.screen.settle()).find((node) => node.type === 'TransitTripMap');
  const shown = (await timeline())!;
  assert.ok(shown, 'the same timeline as Paradas');
  const stopOf = (departure: { stopTime: number[] }) => schedule.stops[departure.stopTime[0]][0];
  assert.equal(shown.props.departure.trip[0], ride.tripId);
  assert.equal(stopOf(shown.props.departure), ride.stops[0].id);
  assert.equal(stopOf(shown.props.alighting), ride.stops.at(-1)!.id);
  assert.equal((await tripMap())!.props.focusKey, null);
  shown.props.onFocusBus();
  assert.equal(typeof (await tripMap())!.props.focusKey, 'number');
  shown.props.onClose();
  assert.equal(await timeline(), undefined);

  const listed = render({ trip: riding, now: at('08:31') });
  await listed.press('Ver paradas del viaje');
  assert.match(textOf(await listed.screen.settle()), /Aquí bajas/, 'without the schedule, a list');
});

test('another bus that gets him there no later can be taken from the card', async () => {
  const base = trip();
  const other = { ...base.rides[1], tripId: '99-0', route: '99', boardAt: at('08:41') };
  const waiting: activeTrip.ActiveTrip = {
    ...base,
    phase: 'waiting',
    leg: 1,
    boarded: ['inferred', null],
    alternatives: {
      leg: 1,
      checkedAt: at('08:40'),
      liveAt: null,
      options: [{ ride: other, walk: base.walks[1], egress: base.walks[2], arriveAt: at('08:52') }],
    },
  };
  const f = render({ trip: waiting, now: at('08:40') });
  const text = textOf(await f.screen.settle());
  assert.match(text, /También te dejan igual o antes/);
  assert.match(text, /Sale 08:41 \(horario\) de CORNER EB \(#109\) · llegas 08:52/);
  await f.press('Tomar el 99');
  assert.deepEqual(f.taps, ['take:99-0']);
});

test("the trip's stops show each bus still ahead, the first on top", async () => {
  const f = render({ trip: trip(), tripLive: { schedule: plannerFixture(), snapshot: null } });
  await f.press('Ver paradas del viaje');
  const lines = nodes(await f.screen.settle()).filter(
    (node) => node.type === 'TransitTripTimeline',
  );
  assert.deepEqual(
    lines.map((node) => node.props.departure.trip[0]),
    ['16S-4', '20E-4'],
  );
});
