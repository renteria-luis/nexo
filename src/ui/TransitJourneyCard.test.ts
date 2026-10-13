import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_TRAVEL_PREFERENCES } from '../transit/journey.ts';
import * as schedule from '../transit/schedule.ts';
import { sortPlaces } from '../transit/store.ts';
import { nodes, renderModule, textOf } from './test-render.ts';

function fixture(surface: 'today' | 'training') {
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
  const screen = renderModule('src/ui/TransitJourneyCard.tsx', {
    '@react-navigation/native': {
      useIsFocused: () => true,
      useNavigation: () => ({ navigate() {} }),
    },
    '../shell/TransitJourney.tsx': { useTransitJourney: () => journey },
    '../shell/transit.ts': { transitHere: async () => null },
    '../transit/schedule.ts': schedule,
    '../transit/store.ts': { sortPlaces, nearestPlace: () => null },
    '../transit/index.ts': { TRANSIT_ENABLED: true },
    './Combobox.tsx': { Combobox: 'Combobox' },
    './NumericField.tsx': { NumericField: 'NumericField' },
    './Button.tsx': { Button: 'Button' },
    './icons.ts': new Proxy({}, { get: (_, name) => String(name) }),
  }).mount('TransitJourneyCard', { surface });
  const control = async (label: string) => {
    const found = nodes(await screen.settle()).find(
      (node) => (node.props.accessibilityLabel ?? node.props.label) === label,
    );
    assert.ok(found, label);
    return found.props;
  };
  return { journey, screen, calls, control };
}

test('Training preselects its gym and passes only the session identity to Transit', async () => {
  const f = fixture('training');
  assert.equal((await f.control('Origen del próximo viaje')).value, 'gym');
  (await f.control('Destino del próximo viaje')).onChange('end');
  (await f.control('Ver bus al terminar')).onPress();
  await f.screen.settle();
  assert.deepEqual(f.calls, [{ originId: 'gym', destinationId: 'end', workoutId: 'session' }]);
});

test('a denied location leaves Today manual origin and destination usable', async () => {
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
  assert.match(textOf(await f.screen.settle()), /Estimación inicial/);
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
