import assert from 'node:assert/strict';
import { test } from 'node:test';

import { exportBackup, importBackup, parseBackup } from '../core/backup.ts';
import { applyAction, applyFix, freezeTrip, type ActiveTrip } from './active-trip.ts';
import { database, plannerFixture } from './fixtures.ts';
import { buildPlannerIndex, liveOptions, startPlan } from './planner.ts';
import { queryInstant } from './schedule.ts';
import {
  deleteMapNote,
  listMapNotes,
  listStopWalks,
  listWalkLinks,
  saveMapNote,
  savePlace,
  saveStopWalk,
  saveWalkLink,
  saveWalkPath,
} from './store.ts';
import {
  KEPT_WALKS,
  listAcceptedWalks,
  listWalkObservations,
  readActiveTrip,
  readLastTrip,
  reviewWalk,
  saveTrip,
} from './trip-store.ts';
import { learnedWalks, parsePath } from './walks.ts';

const at = (clock: string) => queryInstant('2026-10-13', clock);

async function setup() {
  const { db, raw } = await database();
  const origin = await savePlace(db, { name: 'Origin', address: '', lat: 43.0015, lng: -81.2001 });
  const destination = await savePlace(db, {
    name: 'Destination',
    address: '',
    lat: 42.987,
    lng: -81.1701,
  });
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
  const trip = (id: string, now = at('08:25')) =>
    freezeTrip({
      id,
      journeyId: null,
      schedule,
      option,
      origin: { id: origin, name: 'Origin', lat: 43.0015, lng: -81.2001 },
      destination: { id: destination, name: 'Destination', lat: 42.987, lng: -81.1701 },
      now,
    });
  return { db, raw, origin, destination, trip };
}

function walked(trip: ActiveTrip, offset = 0) {
  let current = trip;
  const observations = [];
  for (const [lat, seconds] of [
    [43.0015, 5],
    [43.0011, 40],
    [43.0007, 75],
    [43.0004, 105],
  ]) {
    const step = applyFix(
      current,
      {
        lat,
        lng: -81.2001,
        accuracy: 8,
        speed: null,
        at: trip.startedAt + offset + seconds * 1_000,
      },
      null,
    );
    current = step.trip;
    observations.push(...step.observations);
  }
  return { trip: current, observations };
}

test('one trip is active at a time and a finished one keeps its evidence', async () => {
  const { db, trip } = await setup();
  assert.equal(await readActiveTrip(db), null);
  const first = trip('first');
  await saveTrip(db, first);
  assert.deepEqual(await readActiveTrip(db), first);
  await assert.rejects(saveTrip(db, trip('second')), /Ya hay un viaje en curso/);
  const done = applyAction(first, 'cancel', at('08:26')).trip;
  await saveTrip(db, done);
  assert.equal(await readActiveTrip(db), null);
  const last = await readLastTrip(db);
  assert.equal(last?.phase, 'canceled');
  assert.deepEqual(last?.rides[0].path, []);
  assert.deepEqual(
    last?.rides[0].stops.map((s) => s.id),
    first.rides[0].stops.map((s) => s.id),
  );
  await saveTrip(db, trip('second'));
  assert.equal((await readActiveTrip(db))?.id, 'second');
});

test('measured walks wait for review, are kept once, and only accepted ones teach', async () => {
  const { db, raw, origin, trip } = await setup();
  for (let i = 0; i < 4; i++) {
    const { trip: current, observations } = walked(trip(`trip-${i}`, at('08:25') + i * 86_400_000));
    assert.equal(observations.length, 1);
    await saveTrip(db, applyAction(current, 'finish', current.lastFix!.at).trip, observations);
    await saveTrip(db, applyAction(current, 'finish', current.lastFix!.at).trip, observations);
  }
  const walks = await listWalkObservations(db);
  assert.equal(walks.length, 4);
  assert.ok(walks.every((w) => w.status === 'new' && w.place_id === origin));
  assert.equal(JSON.parse(walks[0].trace).length, 4);
  assert.equal(learnedWalks(await listAcceptedWalks(db)).size, 0);
  for (const w of walks.slice(0, 3)) await reviewWalk(db, w.id, 'accepted');
  await reviewWalk(db, walks[3].id, 'excluded');
  const learned = learnedWalks(await listAcceptedWalks(db));
  assert.deepEqual(learned.get(`access:${origin}>ORIGIN_SB`), {
    minutes: 2,
    low: 1.8,
    high: 1.8,
    count: 3,
  });
  await assert.rejects(reviewWalk(db, 'missing', 'accepted'), /ya no está/);
  // Each link keeps a bounded number of walks.
  for (let i = 0; i < KEPT_WALKS; i++) {
    const { trip: current, observations } = walked(trip(`more-${i}`, at('09:00') + i * 86_400_000));
    await saveTrip(db, applyAction(current, 'finish', current.lastFix!.at).trip, observations);
  }
  assert.equal(
    (raw.prepare('SELECT COUNT(*) AS n FROM transit_walk_observation').get() as { n: number }).n,
    KEPT_WALKS,
  );
});

test('crossing notes and kept paths are his data and survive a backup', async () => {
  const { db, raw, origin } = await setup();
  const note = await saveMapNote(db, {
    lat: 43.0009,
    lng: -81.2003,
    kind: 'button',
    note: 'Botón del lado norte',
    wait_min: 20,
    wait_max: 90,
  });
  await assert.rejects(
    saveMapNote(db, { lat: 43, lng: -81, kind: 'slow', note: '', wait_min: 90, wait_max: 20 }),
    /la menor primero/,
  );
  const path = [
    { lat: 43.0015, lng: -81.2001 },
    { lat: 43.0009, lng: -81.2003 },
    { lat: 43.0003, lng: -81.2001 },
  ];
  await assert.rejects(
    saveWalkPath(
      db,
      { kind: 'link', placeId: origin, stopId: 'ORIGIN_SB', direction: 'to_stop' },
      path,
    ),
    /Guarda primero los minutos/,
  );
  await saveWalkLink(db, {
    place_id: origin,
    stop_id: 'ORIGIN_SB',
    direction: 'to_stop',
    minutes: 3,
    entrance: 'Puerta principal',
  });
  await saveWalkPath(
    db,
    { kind: 'link', placeId: origin, stopId: 'ORIGIN_SB', direction: 'to_stop' },
    path,
  );
  await saveStopWalk(db, { from_stop: 'CORNER_SB', to_stop: 'CORNER_EB', minutes: 2, note: '' });
  await saveWalkPath(db, { kind: 'transfer', fromStop: 'CORNER_SB', toStop: 'CORNER_EB' }, path);
  // Saving the minutes again keeps the path.
  await saveWalkLink(db, {
    place_id: origin,
    stop_id: 'ORIGIN_SB',
    direction: 'to_stop',
    minutes: 4,
    entrance: 'Puerta principal',
  });
  assert.deepEqual(parsePath((await listWalkLinks(db, origin))[0].path), path);
  assert.deepEqual(parsePath((await listStopWalks(db))[0].path), path);

  const backup = parseBackup(JSON.parse(JSON.stringify(await exportBackup(db))));
  assert.equal(backup.tables.transit_map_note.length, 1);
  await deleteMapNote(db, note);
  assert.deepEqual(await listMapNotes(db), []);
  raw.exec("UPDATE transit_walk_link SET path = ''");
  await importBackup(db, backup);
  assert.equal((await listMapNotes(db))[0].note, 'Botón del lado norte');
  assert.deepEqual(parsePath((await listWalkLinks(db, origin))[0].path), path);
});

test('an active trip and its walks round-trip through a backup', async () => {
  const { db, trip } = await setup();
  const { trip: current, observations } = walked(trip('backup'));
  await saveTrip(db, current, observations);
  const backup = parseBackup(JSON.parse(JSON.stringify(await exportBackup(db))));
  await saveTrip(db, applyAction(current, 'cancel', at('08:30')).trip);
  await importBackup(db, backup);
  assert.deepEqual(await readActiveTrip(db), current);
  assert.equal((await listWalkObservations(db)).length, 1);
});
