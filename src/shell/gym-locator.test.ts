import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GymLocation } from '../core/geo.ts';

import { AUTO_COOLDOWN_MS, createGymLocator, type LocationApi } from './gym-locator.ts';

const GYMS: GymLocation[] = [
  { id: 'fanshawe', name: 'Fanshawe', lat: 43.0136571, lng: -81.2012992, radiusM: 400 },
  {
    id: 'fit4less-proudfoot',
    name: 'Fit4Less Proudfoot',
    lat: 42.9867629,
    lng: -81.2882956,
    radiusM: 150,
  },
];

const AT_FANSHAWE = { latitude: 43.0138, longitude: -81.2015, accuracy: 20 };
const DOWNTOWN = { latitude: 42.9849, longitude: -81.2453, accuracy: 20 };

function fakePhone({
  status = 'granted',
  cached = null as typeof AT_FANSHAWE | null,
  fresh = AT_FANSHAWE,
} = {}) {
  const calls: string[] = [];
  let answer!: () => void;
  const phone = {
    calls,
    status,
    hold: false,
    release: () => answer(),
    api: {
      Accuracy: { Balanced: 3, High: 4 },
      getForegroundPermissionsAsync: async () => {
        calls.push('check');
        return { status: phone.status };
      },
      requestForegroundPermissionsAsync: async () => {
        calls.push('ask');
        phone.status = 'granted';
        return { status: phone.status };
      },
      getLastKnownPositionAsync: async () => {
        calls.push('cached');
        return cached && { coords: cached };
      },
      getCurrentPositionAsync: async ({ accuracy }: { accuracy: number }) => {
        calls.push(accuracy === 4 ? 'fresh-high' : 'fresh-balanced');
        if (phone.hold) await new Promise<void>((resolve) => (answer = resolve));
        return { coords: fresh };
      },
    } as unknown as LocationApi,
  };
  return phone;
}

test('the automatic reading never asks for permission', async () => {
  const phone = fakePhone({ status: 'undetermined' });
  const locate = createGymLocator(phone.api);
  assert.deepEqual(await locate(GYMS, 'auto'), { kind: 'denied' });
  assert.deepEqual(phone.calls, ['check']);
});

test('a decisive cached position avoids a new reading, inside or far from both', async () => {
  const inside = fakePhone({ cached: AT_FANSHAWE });
  const found = await createGymLocator(inside.api)(GYMS, 'auto');
  assert.equal(found.kind === 'match' && found.fix.gym.id, 'fanshawe');
  assert.deepEqual(inside.calls, ['check', 'cached']);

  const away = fakePhone({ cached: DOWNTOWN });
  assert.deepEqual(await createGymLocator(away.api)(GYMS, 'auto'), { kind: 'elsewhere' });
  assert.deepEqual(away.calls, ['check', 'cached']);
});

test('automatic readings wait two minutes between new fixes; the arrow does not', async () => {
  let clock = 0;
  const phone = fakePhone({ fresh: DOWNTOWN });
  const locate = createGymLocator(phone.api, () => clock);
  assert.deepEqual(await locate(GYMS, 'auto'), { kind: 'elsewhere' });
  clock = AUTO_COOLDOWN_MS - 1;
  assert.deepEqual(await locate(GYMS, 'auto'), { kind: 'unsure' });
  assert.deepEqual(await locate(GYMS, 'manual'), { kind: 'elsewhere' });
  assert.deepEqual(
    phone.calls.filter((call) => call.startsWith('fresh')),
    ['fresh-balanced', 'fresh-high'],
  );
  clock += AUTO_COOLDOWN_MS;
  await locate(GYMS, 'auto');
  assert.equal(phone.calls.at(-1), 'fresh-balanced');
});

test('requests made while one is pending share it until the phone answers', async () => {
  const phone = fakePhone();
  phone.hold = true;
  const locate = createGymLocator(phone.api);
  const first = locate(GYMS, 'auto');
  const second = locate(GYMS, 'auto');
  const tapped = locate(GYMS, 'manual');
  await new Promise((resolve) => setImmediate(resolve));
  phone.release();
  const outcomes = await Promise.all([first, second, tapped]);
  assert.ok(outcomes.every((outcome) => outcome.kind === 'match'));
  assert.equal(phone.calls.filter((call) => call.startsWith('fresh')).length, 1);
});

test('the arrow asks for permission even when it joins an automatic denial', async () => {
  const phone = fakePhone({ status: 'undetermined' });
  const locate = createGymLocator(phone.api);
  const auto = locate(GYMS, 'auto');
  const tapped = locate(GYMS, 'manual');
  assert.deepEqual(await auto, { kind: 'denied' });
  const outcome = await tapped;
  assert.equal(outcome.kind === 'match' && outcome.fix.gym.id, 'fanshawe');
  assert.deepEqual(phone.calls, ['check', 'ask', 'cached', 'fresh-high']);
});

test('a fresh reading with too much error decides nothing', async () => {
  const phone = fakePhone({ fresh: { ...AT_FANSHAWE, accuracy: 500 } });
  assert.deepEqual(await createGymLocator(phone.api)(GYMS, 'manual'), { kind: 'unsure' });
});
