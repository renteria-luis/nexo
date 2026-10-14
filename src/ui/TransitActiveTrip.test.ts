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

function render(journey: Record<string, unknown>) {
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
    },
    './TransitStatus.tsx': { RouteBadge: 'RouteBadge' },
    './Button.tsx': { Button: 'Button' },
    './Card.tsx': { Card: 'Card' },
  }).mount('TransitActiveTrip');
  const press = async (label: string) => {
    const button = nodes(await screen.settle()).find((node) => node.props.label === label);
    assert.ok(button, label);
    button.props.onPress();
    await screen.settle();
  };
  return { screen, taps, press, view };
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
  assert.match(text, /también con la pantalla bloqueada/);
  assert.match(text, /Sin datos en vivo/);
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
  assert.match(summary, /Llegaste a Trabajo/);
  assert.match(summary, /32 min desde que saliste, hasta las 08:57/);
  assert.match(summary, /240 lecturas de GPS \(3 imprecisas\) · 12 consultas en vivo/);
  assert.match(summary, /96 KB/);
  await f.press('Cerrar');
  assert.deepEqual(f.taps, ['dismiss']);
});
