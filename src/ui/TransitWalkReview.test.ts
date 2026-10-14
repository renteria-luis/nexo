import assert from 'node:assert/strict';
import { test } from 'node:test';
import { database, plannerFixture } from '../transit/fixtures.ts';
import * as schedules from '../transit/schedule.ts';
import { listPlaces, savePlace } from '../transit/store.ts';
import * as tripStore from '../transit/trip-store.ts';
import * as walks from '../transit/walks.ts';
import { nodes, renderModule, textOf } from './test-render.ts';

test('walk review persists acceptance and exclusion before teaching the planner', async () => {
  const { db } = await database();
  const id = await savePlace(db, { name: 'Origin', address: '', lat: 43, lng: -81.2 });
  const start = schedules.queryInstant('2026-10-13', '08:00');
  for (let i = 0; i < 3; i++)
    await db.runAsync(
      `INSERT INTO transit_walk_observation (id, trip_id, kind, place_id, to_stop, started_at, left_at, ended_at,
      start_source, end_source, accuracy_m, path_m, straight_m, planned_minutes, trace, flag, status, created_at)
     VALUES (?, ?, 'access', ?, 'ORIGIN_SB', ?, ?, ?, 'tap', 'gps', 8, 180, 130, 3, '[]', NULL, 'new', ?);`,
      [
        `walk-${i}`,
        `trip-${i}`,
        id,
        start + i * 86_400_000,
        start + i * 86_400_000 + 60_000,
        start + i * 86_400_000 + 180_000,
        start,
      ],
    );
  let changes = 0;
  const previews: walks.WalkObservation[] = [];
  const props = {
    db,
    schedule: plannerFixture(),
    places: await listPlaces(db),
    revision: 0,
    onChanged: () => {
      changes++;
    },
    onPath: (walk: walks.WalkObservation) => previews.push(walk),
  };
  const screen = renderModule('src/ui/TransitWalkReview.tsx', {
    '../shell/TransitJourney.tsx': { useTransitJourney: () => ({ trip: null }) },
    '../transit/schedule.ts': schedules,
    '../transit/trip-store.ts': tripStore,
    '../transit/walks.ts': walks,
    './Button.tsx': { Button: 'Button' },
    './Card.tsx': { Card: 'Card' },
  }).mount('TransitWalkReview', props);
  const press = async (label: string) => {
    const button = nodes(await screen.settle()).find((n) => n.props.label === label);
    assert.ok(button, label);
    button.props.onPress();
    await screen.settle();
  };
  assert.match(textOf(await screen.settle()), /Hasta salir del lugar: unos 1 min; después: 2 min/);
  await press('Ver recorrido');
  assert.equal(previews.length, 1);
  for (let i = 0; i < 3; i++) await press('Aceptar caminata');
  assert.equal(changes, 3);
  assert.equal(
    walks.learnedWalks(await tripStore.listAcceptedWalks(db)).get(`access:${id}>ORIGIN_SB`)!
      .minutes,
    3,
  );
  await press('Ver revisadas');
  assert.match(textOf(await screen.settle()), /3 min habituales/);
  await press('Excluir caminata');
  assert.equal(walks.learnedWalks(await tripStore.listAcceptedWalks(db)).size, 0);
  assert.match(textOf(await screen.settle()), /Excluida del cálculo/);
});
