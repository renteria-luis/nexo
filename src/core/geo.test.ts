import assert from 'node:assert/strict';
import { test } from 'node:test';

import { distanceMetres, gymAt, type GymLocation } from './geo.ts';

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

test('standing in one gym finds that gym', () => {
  const insideFanshawe = { lat: 43.0138, lng: -81.2015 };
  assert.equal(gymAt(GYMS, insideFanshawe)?.gym.id, 'fanshawe');

  const insideFit4Less = { lat: 42.98681, lng: -81.28835 };
  assert.equal(gymAt(GYMS, insideFit4Less)?.gym.id, 'fit4less-proudfoot');
});

test('standing anywhere else finds nothing rather than the closest', () => {
  // Downtown London, kilometres from both.
  assert.equal(gymAt(GYMS, { lat: 42.9849, lng: -81.2453 }), null);
  // Just outside the Fit4Less radius, around 300 m away.
  assert.equal(gymAt(GYMS, { lat: 42.9894, lng: -81.2883 }), null);
});

test('a gym without coordinates is skipped, not matched', () => {
  const unknown: GymLocation = {
    id: 'unknown',
    name: 'Sin coordenadas',
    lat: null,
    lng: null,
    radiusM: 400,
  };
  assert.equal(gymAt([unknown], { lat: 43.0138, lng: -81.2015 }), null);
});
