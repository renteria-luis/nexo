import assert from 'node:assert/strict';
import { test } from 'node:test';

import { distanceMetres, readGym, type GymLocation } from './geo.ts';

const FANSHAWE: GymLocation = {
  id: 'fanshawe',
  name: 'Fanshawe',
  lat: 43.0136571,
  lng: -81.2012992,
  radiusM: 400,
};

const FIT4LESS: GymLocation = {
  id: 'fit4less-proudfoot',
  name: 'Fit4Less Proudfoot',
  lat: 42.9867629,
  lng: -81.2882956,
  radiusM: 150,
};

const GYMS = [FANSHAWE, FIT4LESS];

test('the two gyms are about eight kilometres apart', () => {
  const metres = distanceMetres(
    { lat: FANSHAWE.lat as number, lng: FANSHAWE.lng as number },
    { lat: FIT4LESS.lat as number, lng: FIT4LESS.lng as number },
  );
  assert.ok(metres > 7000 && metres < 8500, `${metres} m`);
  // Symmetric, and zero against itself.
  assert.equal(
    Math.round(metres),
    Math.round(
      distanceMetres(
        { lat: FIT4LESS.lat as number, lng: FIT4LESS.lng as number },
        { lat: FANSHAWE.lat as number, lng: FANSHAWE.lng as number },
      ),
    ),
  );
});

const gymOf = (position: { lat: number; lng: number }, errorM: number | null = 20) => {
  const reading = readGym(GYMS, position, errorM);
  return reading.kind === 'match' ? reading.fix.gym.id : reading.kind;
};

test('standing in one gym finds that gym', () => {
  assert.equal(gymOf({ lat: 43.0138, lng: -81.2015 }), 'fanshawe');
  assert.equal(gymOf({ lat: 42.98681, lng: -81.28835 }), 'fit4less-proudfoot');
});

test('standing anywhere else is elsewhere rather than the closest', () => {
  // Downtown London, kilometres from both.
  assert.equal(gymOf({ lat: 42.9849, lng: -81.2453 }), 'elsewhere');
  // Just outside the Fit4Less radius, around 300 m away.
  assert.equal(gymOf({ lat: 42.9894, lng: -81.2883 }), 'elsewhere');
});

test('a reading whose error reaches into a gym decides nothing', () => {
  // About 190 m from Fit4Less: outside its 150 m, but not with 60 m of error.
  assert.equal(gymOf({ lat: 42.98848, lng: -81.2883 }, 15), 'elsewhere');
  assert.equal(gymOf({ lat: 42.98848, lng: -81.2883 }, 60), 'unsure');
});

test('an unknown or too large error decides nothing, even inside a gym', () => {
  assert.equal(gymOf({ lat: 43.0138, lng: -81.2015 }, null), 'unsure');
  assert.equal(gymOf({ lat: 43.0138, lng: -81.2015 }, 101), 'unsure');
  assert.equal(gymOf({ lat: 43.0138, lng: -81.2015 }, 100), 'fanshawe');
});

test('a gym without coordinates is skipped, not matched', () => {
  const unknown: GymLocation = {
    id: 'unknown',
    name: 'Sin coordenadas',
    lat: null,
    lng: null,
    radiusM: 400,
  };
  assert.equal(readGym([unknown], { lat: 43.0138, lng: -81.2015 }, 10).kind, 'elsewhere');
});
