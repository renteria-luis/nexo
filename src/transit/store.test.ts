import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { exportBackup, importBackup, parseBackup } from '../core/backup.ts';
import { migrate } from '../db/migrate.ts';
import { adapt, database, scheduleFixture } from './fixtures.ts';
import {
  listPlaces,
  listStopWalks,
  listWalkLinks,
  readSchedule,
  replaceSchedule,
  savePlace,
  saveStopWalk,
  saveWalkLink,
  sortPlaces,
} from './store.ts';
import { SCHEDULE_SCHEMA } from './schedule.ts';
import { syncSchedule, validateManifest, STATIC_BASE_URL } from './sync.ts';

const hash = async (raw: string) => createHash('sha256').update(raw).digest('hex');

test('migration upgrades the existing gym identities and seeds six distinct exact points', async () => {
  const raw = new DatabaseSync(':memory:');
  const db = adapt(raw);
  await migrate(db, '061_set_variants');
  const gyms = raw.prepare('SELECT * FROM training_gym ORDER BY id').all();
  await migrate(db);
  assert.deepEqual(raw.prepare('SELECT * FROM training_gym ORDER BY id').all(), gyms);
  const places = await listPlaces(db);
  assert.equal(places.length, 6);
  assert.equal(places.find((p) => p.id === 'costco')?.lat, 42.987403880318695);
  assert.equal(places.find((p) => p.id === 'food-basics')?.lng, -81.20999778335016);
  assert.equal(places.find((p) => p.id === 'fanshawe-gym')?.gym_id, 'fanshawe');
  assert.equal(places.find((p) => p.id === 'fit4less')?.gym_id, 'fit4less-proudfoot');
  assert.deepEqual(
    places.map((p) => p.icon),
    ['gym', 'gym', 'grocery', 'grocery', 'cinema', 'mall'],
  );
  assert.notDeepEqual(
    places.find((p) => p.id === 'masonville-door'),
    places.find((p) => p.id === 'masonville-cinema'),
  );
});

test('a seventh place can be edited without modifying the other six, and rejects invalid coordinates', async () => {
  const { db } = await database();
  const before = await listPlaces(db);
  const id = await savePlace(db, { name: 'New door', address: 'Front', lat: 43.01, lng: -81.25 });
  assert.equal((await listPlaces(db)).at(-1)?.icon, 'pin');
  await savePlace(db, { id, name: 'Door', address: 'Side', lat: 43.02, lng: -81.26, icon: 'home' });
  await savePlace(db, { id, name: 'Correct door', address: 'Side', lat: 43.02, lng: -81.26 });
  assert.equal((await listPlaces(db)).at(-1)?.icon, 'home', 'an edit without an icon keeps it');
  await assert.rejects(
    savePlace(db, { id, name: 'Door', address: '', lat: 43, lng: -81, icon: 'rocket' as never }),
    /íconos/,
  );
  assert.deepEqual((await listPlaces(db)).slice(0, 6), before);
  assert.equal((await listPlaces(db)).at(-1)?.id, id);
  assert.equal((await listPlaces(db)).at(-1)?.lat, 43.02);
  await assert.rejects(savePlace(db, { id, name: 'Bad', address: '', lat: 91, lng: 0 }));
  await assert.rejects(
    savePlace(db, { id: 'missing', name: 'Bad', address: '', lat: 43, lng: -81 }),
  );
});

test('a place keeps its tags and importance, and lists go by importance then name', async () => {
  const { db } = await database();
  const id = await savePlace(db, {
    name: 'Gimnasio nuevo',
    address: '',
    lat: 43,
    lng: -81.2,
    icon: 'leaf',
    tags: ' gym,  fit , ,gimnasio',
    importance: 2,
  });
  const saved = (await listPlaces(db)).find((p) => p.id === id)!;
  assert.equal(saved.tags, 'gym, fit, gimnasio');
  assert.equal(saved.importance, 2);
  assert.equal(saved.icon, 'leaf');
  await savePlace(db, { id, name: 'Gimnasio nuevo', address: '', lat: 43, lng: -81.2 });
  const kept = (await listPlaces(db)).find((p) => p.id === id)!;
  assert.deepEqual([kept.tags, kept.importance], ['gym, fit, gimnasio', 2], 'left out, kept');
  await savePlace(db, {
    id,
    name: 'Gimnasio nuevo',
    address: '',
    lat: 43,
    lng: -81.2,
    importance: null,
  });
  assert.equal((await listPlaces(db)).find((p) => p.id === id)!.importance, null, 'cleared');
  for (const importance of [0, 11, 2.5])
    await assert.rejects(
      savePlace(db, { id, name: 'X', address: '', lat: 43, lng: -81.2, importance }),
      /1 a 10/,
    );
  await savePlace(db, {
    id: 'costco',
    name: 'Costco',
    address: '',
    lat: 42.9874,
    lng: -81.2931,
    importance: 1,
  });
  await savePlace(db, {
    id: 'food-basics',
    name: 'Food Basics',
    address: '',
    lat: 43.0071,
    lng: -81.21,
    importance: 10,
  });
  assert.deepEqual(
    sortPlaces(await listPlaces(db)).map((p) => p.name),
    [
      'Costco',
      'Food Basics',
      'Cine / Silver Cinema Masonville',
      'Fanshawe Gym',
      'Fit4Less',
      'Gimnasio nuevo',
      'Masonville puerta',
    ],
  );
});

test('walking links remain directional and survive removed public stops', async () => {
  const { db } = await database();
  await saveWalkLink(db, {
    place_id: 'fit4less',
    stop_id: 'A',
    direction: 'to_stop',
    minutes: 5,
    entrance: 'Front door; includes crossing',
  });
  await saveWalkLink(db, {
    place_id: 'fit4less',
    stop_id: 'A',
    direction: 'from_stop',
    minutes: 7,
    entrance: 'Other curb',
  });
  const s = scheduleFixture();
  const text = JSON.stringify(s);
  await replaceSchedule(db, text, await hash(text));
  s.stops[0][0] = 'REPLACED';
  const updated = JSON.stringify(s);
  await replaceSchedule(db, updated, await hash(updated));
  assert.deepEqual(
    (await listWalkLinks(db, 'fit4less')).map((l) => [l.stop_id, l.direction, l.minutes]),
    [
      ['A', 'from_stop', 7],
      ['A', 'to_stop', 5],
    ],
  );
});

test('transfer walks between stops keep each direction and refuse the same stop', async () => {
  const { db } = await database();
  await saveStopWalk(db, {
    from_stop: 'A',
    to_stop: 'B',
    minutes: 3,
    note: 'Signal at the corner',
  });
  await saveStopWalk(db, { from_stop: 'B', to_stop: 'A', minutes: 4, note: '' });
  await saveStopWalk(db, { from_stop: 'A', to_stop: 'B', minutes: 2, note: 'Button first' });
  assert.deepEqual(
    (await listStopWalks(db)).map((w) => [w.from_stop, w.to_stop, w.minutes, w.note]),
    [
      ['A', 'B', 2, 'Button first'],
      ['B', 'A', 4, ''],
    ],
  );
  await assert.rejects(saveStopWalk(db, { from_stop: 'A', to_stop: 'A', minutes: 1, note: '' }));
  await assert.rejects(saveStopWalk(db, { from_stop: 'A', to_stop: 'B', minutes: 0, note: '' }));
  await assert.rejects(saveStopWalk(db, { from_stop: 'A', to_stop: 'B', minutes: 61, note: '' }));
  assert.equal((await listStopWalks(db)).length, 2);
});

test('a schedule saved in an older package format gives way to the one the app ships', async () => {
  const { db, raw } = await database();
  const older = { ...scheduleFixture(), schema: SCHEDULE_SCHEMA - 1 };
  raw
    .prepare(
      'INSERT INTO transit_schedule_cache (id, sha256, content, saved_at) VALUES (1, ?, ?, 1);',
    )
    .run('older', JSON.stringify(older));
  assert.equal(await readSchedule(db), null);
  raw.exec(
    `UPDATE transit_schedule_cache SET content = '{"schema":${SCHEDULE_SCHEMA}}' WHERE id = 1;`,
  );
  await assert.rejects(
    readSchedule(db),
    'a broken package in the current format still fails loudly',
  );
});

test('atomic cache replacement preserves last-good schedules and personal data after invalid payloads or SQL failure', async () => {
  const { db, raw } = await database();
  const text = JSON.stringify(scheduleFixture());
  const checksum = await hash(text);
  await replaceSchedule(db, text, checksum);
  const before = await listPlaces(db);
  await assert.rejects(replaceSchedule(db, '{"schema":2}', 'bad'));
  raw.exec(
    "CREATE TRIGGER reject_cache BEFORE UPDATE ON transit_schedule_cache BEGIN SELECT RAISE(ABORT, 'disk write failed'); END;",
  );
  await assert.rejects(replaceSchedule(db, text, 'new'), /disk write failed/);
  assert.equal((await readSchedule(db))?.sha256, checksum);
  assert.deepEqual(await listPlaces(db), before);
});

test('personal Transit data round-trips through backups without replaceable citywide data', async () => {
  const source = await database();
  const target = await database();
  const id = await savePlace(source.db, {
    name: 'My door',
    address: 'Manual',
    lat: 43.01,
    lng: -81.2,
    icon: 'work',
  });
  await saveWalkLink(source.db, {
    place_id: id,
    stop_id: 'A',
    direction: 'to_stop',
    minutes: 5,
    entrance: 'North entrance',
  });
  await saveStopWalk(source.db, { from_stop: 'A', to_stop: 'B', minutes: 2, note: 'Crosswalk' });
  const raw = JSON.stringify(scheduleFixture());
  await replaceSchedule(source.db, raw, await hash(raw));
  const backup = parseBackup(JSON.parse(JSON.stringify(await exportBackup(source.db))));
  assert.ok(
    backup.tables.transit_place &&
      backup.tables.transit_walk_link &&
      backup.tables.transit_stop_walk,
  );
  assert.equal(backup.tables.transit_schedule_cache, undefined);
  await importBackup(target.db, backup);
  assert.deepEqual(await listPlaces(target.db), await listPlaces(source.db));
  assert.deepEqual(await listWalkLinks(target.db, id), await listWalkLinks(source.db, id));
  assert.deepEqual(await listStopWalks(target.db), await listStopWalks(source.db));
  assert.equal(await readSchedule(target.db), null);
});

test('pre-Transit backups gain the new seeds while retaining their historical gym coordinates', async () => {
  const raw = new DatabaseSync(':memory:');
  const old = adapt(raw);
  await migrate(old, '061_set_variants');
  raw.exec("UPDATE training_gym SET lat=43.014 WHERE id='fanshawe';");
  const backup = await exportBackup(old);
  const target = await database();
  const scratch = adapt(new DatabaseSync(':memory:'));
  await importBackup(target.db, backup, scratch);
  assert.equal((await listPlaces(target.db)).length, 6);
  assert.equal((await listPlaces(target.db)).find((p) => p.id === 'costco')?.icon, 'grocery');
  assert.equal(
    target.raw.prepare("SELECT lat FROM training_gym WHERE id='fanshawe'").get()?.lat,
    43.014,
  );
});

test('updates verify hashes, skip unchanged downloads and preserve last-good data on network or format failures', async () => {
  const { db } = await database();
  const original = JSON.stringify(scheduleFixture());
  const cache = await replaceSchedule(db, original, await hash(original));
  const next = scheduleFixture();
  next.feedVersion = 'new';
  next.createdAt++;
  const content = JSON.stringify(next);
  const sha256 = await hash(content);
  const manifest = {
    schema: SCHEDULE_SCHEMA,
    file: 'schedule.json',
    bytes: Buffer.byteLength(content),
    sha256,
    sourceSha256: next.sourceSha256,
    createdAt: next.createdAt,
    feedVersion: next.feedVersion,
    timezone: next.timezone,
    validFrom: next.validFrom,
    validTo: next.validTo,
  };
  const calls: string[] = [];
  const transport = {
    digest: hash,
    fetch: async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(
        String(url).endsWith('manifest.json') ? JSON.stringify(manifest) : content,
      );
    },
  };
  const result = await syncSchedule(db, cache, transport);
  assert.equal(result.kind, 'updated');
  assert.equal((await readSchedule(db))?.schedule.feedVersion, 'new');
  calls.length = 0;
  assert.equal((await syncSchedule(db, (await readSchedule(db))!, transport)).kind, 'unchanged');
  assert.deepEqual(calls, [`${STATIC_BASE_URL}manifest.json`]);
  for (const fetcher of [
    async () => {
      throw new Error('offline');
    },
    async () => new Response('bad', { status: 503 }),
    async () => new Response(JSON.stringify({ ...manifest, schema: SCHEDULE_SCHEMA + 1 })),
    async (url: string | URL | Request) =>
      new Response(
        String(url).endsWith('manifest.json')
          ? JSON.stringify({ ...manifest, sha256: 'b'.repeat(64) })
          : content,
      ),
    async (url: string | URL | Request) =>
      new Response(
        String(url).endsWith('manifest.json')
          ? JSON.stringify({ ...manifest, sha256: 'b'.repeat(64) })
          : content.slice(0, 20),
      ),
  ]) {
    assert.equal(
      (await syncSchedule(db, (await readSchedule(db))!, { digest: hash, fetch: fetcher })).kind,
      'failed',
    );
    assert.equal((await readSchedule(db))?.schedule.feedVersion, 'new');
  }
  assert.throws(() => validateManifest({ ...manifest, file: 'https://untrusted.invalid' }));
});
