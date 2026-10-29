import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_TRAVEL_PREFERENCES, travelAdvice } from '../transit/journey.ts';
import * as activeTrip from '../transit/active-trip.ts';
import * as realtime from '../transit/realtime.ts';
import { plannerFixture } from '../transit/fixtures.ts';
import { buildPlannerIndex, liveOptions, startPlan } from '../transit/planner.ts';
import * as schedule from '../transit/schedule.ts';
import { sortPlaces } from '../transit/store.ts';
import { nodes, renderModule, textOf } from './test-render.ts';

function fixture(surface: 'today' | 'training' | 'transit') {
  const calls: unknown[] = [];
  const journey: any = {
    saved: { preferences: DEFAULT_TRAVEL_PREFERENCES, next: null },
    places: [
      { id: 'gym', name: 'Gym', gym_id: 'training-gym', importance: null, tags: '', icon: 'gym' },
      { id: 'end', name: 'Destination', gym_id: null, importance: null, tags: '', icon: 'pin' },
    ],
    workout: null,
    sessionId: 'session',
    gymId: 'training-gym',
    advice: null,
    alternative: null,
    loading: false,
    busy: false,
    problem: null,
    notificationStatus: 'off',
    notificationProblem: null,
    now: schedule.queryInstant('2026-10-13', '18:00'),
    actions: {
      visible() {},
      refresh: async () => {},
      choose: async (value: unknown) => {
        calls.push(value);
      },
      arm: async (value: unknown) => {
        calls.push(value);
      },
    },
  };
  const view = renderModule('src/ui/TransitJourneyCard.tsx', {
    '@react-navigation/native': {
      useIsFocused: () => true,
      useNavigation: () => ({ navigate() {} }),
    },
    '../shell/TransitJourney.tsx': { useTransitJourney: () => journey },
    '../shell/transit.ts': { transitHere: async () => null },
    '../transit/schedule.ts': schedule,
    '../transit/active-trip.ts': activeTrip,
    '../transit/realtime.ts': realtime,
    '../transit/store.ts': { sortPlaces, nearestPlace: () => null },
    '../transit/index.ts': { TRANSIT_ENABLED: true },
    './Combobox.tsx': { Combobox: 'Combobox' },
    './InfoBubble.tsx': { InfoDot: 'InfoDot', InfoText: 'InfoText' },
    './NumericField.tsx': { NumericField: 'NumericField' },
    './Button.tsx': { Button: 'Button' },
    './TransitActiveTrip.tsx': { TransitActiveTrip: 'TransitActiveTrip' },
    './TransitDepartures.tsx': { TransitAlerts: 'TransitAlerts' },
    './icons.ts': new Proxy({}, { get: (_, name) => String(name) }),
  });
  const screen = view.mount('TransitJourneyCard', { surface });
  const control = async (label: string) => {
    const found = nodes(await screen.settle()).find(
      (node) => (node.props.accessibilityLabel ?? node.props.label) === label,
    );
    assert.ok(found, label);
    return found.props;
  };
  return { journey, screen, calls, control, view };
}

function plannedTrip() {
  const data = plannerFixture();
  const now = schedule.queryInstant('2026-10-13', '08:00');
  const origin = { id: 'gym', name: 'Origin', lat: 43, lng: -81.2 };
  const destination = { id: 'end', name: 'Destination', lat: 42.9878, lng: -81.17 };
  const search = startPlan(buildPlannerIndex(data), {
    origin,
    destination,
    originWalks: new Map(),
    destinationWalks: new Map(),
    stopWalks: [],
    mode: 'depart',
    at: now,
  });
  while (!search.step(1_000));
  const option = liveOptions(search.result(), null, now)[0];
  const trip = activeTrip.freezeTrip({
    id: 'trip',
    journeyId: 'journey',
    schedule: data,
    origin,
    destination,
    option,
    now,
  });
  return { data, option, trip, now };
}

test('the next-trip card explicitly labels two buses as a transfer', async () => {
  const f = fixture('today');
  const { option, now } = plannedTrip();
  f.journey.saved.next = { originId: 'gym', destinationId: 'end', workoutId: null };
  f.journey.advice = travelAdvice(option, 0, null, now);
  assert.equal(option.itinerary.rides.length, 2);
  const text = textOf(await f.screen.settle());
  assert.match(text, /→/);
  assert.match(text, /1 transbordo/);
});

test('an obsolete journey is dated and explicitly searched again without presenting it as upcoming', async () => {
  const f = fixture('today');
  f.journey.needsReview = true;
  f.journey.saved.next = {
    originId: 'gym',
    destinationId: 'end',
    workoutId: 'session',
    mode: 'now',
    at: schedule.queryInstant('2026-10-10', '20:36'),
    selectedAt: null,
    reminders: true,
  };
  const tree = await f.screen.settle();
  assert.match(textOf(tree), /Viaje anterior.*Elegido el.*20:36/);
  assert.doesNotMatch(textOf(tree), /Próximo viaje|Prepárate|Calculando el viaje/);
  assert.equal(
    nodes(tree).some((node) => node.props.label === 'Salgo ahora'),
    false,
  );
  (await f.control('Volver a buscar este viaje')).onPress();
  await f.screen.settle();
  assert.deepEqual(f.calls, [{ originId: 'gym', destinationId: 'end', workoutId: null }]);
});

test('alerts follow the frozen remaining rides, then the next option, then the browsed stop', async () => {
  const f = fixture('today');
  const { data, option, trip, now } = plannedTrip();
  const departure = option.itinerary.rides[0].departure;
  const screen = f.view.mount('TransitJourneyAlerts', {
    schedule: data,
    snapshot: {},
    active: false,
    departures: [departure],
  });
  const targets = async () =>
    nodes(await screen.settle()).find((n) => n.type === 'TransitAlerts')!.props;
  assert.deepEqual(
    (await targets()).targets.map((t: any) => t.stopIds),
    [['ORIGIN_SB']],
  );
  f.journey.advice = travelAdvice(option, 0, null, now);
  f.journey.result = { context: { index: { schedule: data } } };
  assert.deepEqual(
    (await targets()).targets.map((t: any) => t.stopIds),
    [
      ['ORIGIN_SB', 'CORNER_SB'],
      ['CORNER_EB', 'EAST_EB', 'END_EB'],
    ],
  );
  // The live advice may change after starting; it must not change the active trip's alerts.
  f.journey.trip = { ...trip, leg: 1, phase: 'waiting' };
  assert.deepEqual(
    (await targets()).targets.map((t: any) => t.stopIds),
    [['CORNER_EB', 'EAST_EB', 'END_EB']],
  );
  f.journey.trip = { ...f.journey.trip, phase: 'final', leg: 2 };
  assert.deepEqual((await targets()).targets, []);
  f.journey.trip = { ...f.journey.trip, phase: 'canceled' };
  assert.deepEqual((await targets()).targets, []);
  f.journey.trip = null;
  f.journey.result = { context: { index: { schedule: { ...data, sourceSha256: 'new-feed' } } } };
  assert.deepEqual(
    (await targets()).targets,
    [],
    'schedule updates cannot reuse old pattern positions',
  );
});

test('Training preselects its gym and passes only the session identity to Transit', async () => {
  const f = fixture('training');
  assert.equal((await f.control('Origen del próximo viaje')).value, 'gym');
  (await f.control('Destino del próximo viaje')).onChange('end');
  (await f.control('Ver bus al terminar')).onPress();
  await f.screen.settle();
  assert.deepEqual(f.calls, [{ originId: 'gym', destinationId: 'end', workoutId: 'session' }]);
});

test('a denied or distant location leaves Today manual origin and destination usable', async () => {
  const f = fixture('today');
  (await f.control('Detectar')).onPress();
  assert.match(textOf(await f.screen.settle()), /elegir el origen a mano/i);
  (await f.control('Origen del próximo viaje')).onChange('gym');
  (await f.control('Destino del próximo viaje')).onChange('end');
  (await f.control('Ver próximo viaje')).onPress();
  await f.screen.settle();
  assert.deepEqual(f.calls, [{ originId: 'gym', destinationId: 'end', workoutId: null }]);
});

test('the compact card preserves limited confidence, infeasibility and visible scheduling errors', async () => {
  const f = fixture('training');
  const at = schedule.queryInstant('2026-10-13', '18:30');
  f.journey.saved.next = {
    id: 'one',
    originId: 'gym',
    destinationId: 'end',
    workoutId: 'session',
    reminders: false,
  };
  f.journey.workout = {
    sessionId: 'session',
    endedAt: null,
    finishAt: at,
    evidence: 'initial',
    fewestSessions: null,
    overdue: false,
  };
  f.journey.advice = {
    option: {
      itinerary: { rides: [], access: { source: 'estimate' } },
      arriveAt: at + 30 * 60_000,
    },
    boardAt: at + 12 * 60_000,
    finishBy: at - 2 * 60_000,
    leaveAt: at + 3 * 60_000,
    preparationMinutes: 5,
    walkMinutes: 7,
    boardingMinutes: 2,
    feasible: false,
    reason: 'Este bus ya no se alcanza con margen.',
    source: 'Horario programado',
  };
  assert.match(textOf(await f.screen.settle()), /Fin del entreno ~/);
  assert.match(textOf(await f.screen.settle()), /no se alcanza/);
  assert.equal((await f.control('Avisarme de este viaje')).disabled, true);
  assert.doesNotMatch(textOf(await f.screen.settle()), /5 min para prepararte/);
  (await f.control('Detalles del viaje')).onPress();
  assert.match(textOf(await f.screen.settle()), /5 min para prepararte/);
  f.journey.advice.feasible = true;
  f.journey.actions.arm = async () => {
    throw new Error('No se pudo programar');
  };
  (await f.control('Avisarme de este viaje')).onPress();
  assert.match(textOf(await f.screen.settle()), /No se pudo programar/);
});

test('on Transit the card shows only a chosen trip, as Tu viaje, changed from Cómo llegar', async () => {
  const f = fixture('transit');
  assert.equal(await f.screen.settle(), null, 'no second place to plan a trip');
  const { option, now } = plannedTrip();
  f.journey.saved.next = { originId: 'gym', destinationId: 'end', workoutId: null };
  f.journey.advice = travelAdvice(option, 0, null, now);
  const tree = await f.screen.settle();
  assert.match(textOf(tree), /Tu viaje/);
  const labels = nodes(tree).map((node) => node.props.label);
  assert.ok(labels.includes('Salgo ahora'));
  assert.ok(labels.includes('Quitar viaje'));
  assert.ok(!labels.includes('Cambiar viaje'));
});
