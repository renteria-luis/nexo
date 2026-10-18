import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  backgroundFor,
  backgroundsFrom,
  backgroundsProblem,
  clampPhoto,
  DEFAULT_BACKGROUND,
  GENERAL,
  movePhoto,
  photoFrame,
  type Photo,
} from './backgrounds.ts';

const phone = { width: 390, height: 844 };
// A landscape photo, wider than the phone in proportion.
const photo: Photo = {
  kind: 'photo',
  uri: 'file:///bg.jpg',
  width: 4000,
  height: 3000,
  zoom: 1,
  x: 0.5,
  y: 0.5,
  dim: 0.3,
  blur: 10,
};

test('a screen uses its own background, then the general one, then the shipped look', () => {
  const gym = { kind: 'color', color: '#112233' } as const;
  const general = { kind: 'color', color: '#445566' } as const;
  assert.equal(backgroundFor({ Entreno: gym, [GENERAL]: general }, 'Entreno'), gym);
  assert.equal(backgroundFor({ Entreno: gym, [GENERAL]: general }, 'Hoy'), general);
  assert.equal(backgroundFor({}, 'Hoy'), DEFAULT_BACKGROUND);
});

test('a stored value that is not a set of backgrounds is refused, naming the screen', () => {
  assert.equal(backgroundsProblem({ Hoy: { kind: 'color', color: '#ABCDEF' } }), null);
  assert.equal(
    backgroundsProblem({ Hoy: { kind: 'color', color: 'red' } }),
    'Hoy: el color no es válido',
  );
  assert.equal(
    backgroundsProblem({ [GENERAL]: { kind: 'gradient', colors: ['#000000'], direction: 'down' } }),
    'General: se esperaban de 2 a 3 colores',
  );
  assert.equal(
    backgroundsProblem({ Hoy: { ...photo, dim: 0.95 } }),
    'Hoy: el oscurecido no es válido',
  );
  assert.equal(
    backgroundsProblem({ Hoy: { ...photo, zoom: 0.5 } }),
    'Hoy: el acercamiento no es válido',
  );
  assert.equal(backgroundsProblem([]), 'los fondos no son válidos');
  assert.throws(() => backgroundsFrom('{"Hoy":{"kind":"video"}}'), /el tipo de fondo no es válido/);
  assert.deepEqual(backgroundsFrom(undefined), {});
});

test('at zoom 1 the photo covers the screen exactly in one direction and overflows the other', () => {
  const frame = photoFrame(photo, phone);
  assert.equal(frame.height, phone.height);
  assert.ok(frame.width > phone.width);
  // Centred: as much hangs off the left as off the right.
  assert.equal(Math.round(frame.left * 2 + frame.width), phone.width);
  assert.equal(frame.top, 0);
});

test('dragging moves the photo with the finger and stops where an edge would show', () => {
  const right = movePhoto(photo, phone, 100, 0);
  assert.ok(right.x < photo.x);
  assert.equal(photoFrame(right, phone).left - photoFrame(photo, phone).left, 100);
  // Far past the edge, the photo's left edge stays at the screen's left edge.
  assert.equal(Math.round(photoFrame(movePhoto(photo, phone, 5000, 0), phone).left), 0);
  // Vertically it already fits exactly, so it cannot move at all.
  assert.equal(movePhoto(photo, phone, 0, 200).y, 0.5);
});

test('zoom stays between filling the screen and five times that', () => {
  assert.equal(clampPhoto({ ...photo, zoom: 0.2 }, phone).zoom, 1);
  assert.equal(clampPhoto({ ...photo, zoom: 9 }, phone).zoom, 5);
  const zoomed = clampPhoto({ ...photo, zoom: 2, y: 0 }, phone);
  // Zoomed in, there is room to move up and down, but not past the top edge.
  assert.equal(photoFrame(zoomed, phone).top, 0);
});
