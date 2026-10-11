import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { exportBackup, importBackup, parseBackup } from '../core/backup.ts';
import { migrate } from '../db/migrate.ts';
import { adapt, database, scheduleFixture } from './fixtures.ts';
import {
  listPlaces,
  listWalkLinks,
  readSchedule,
  replaceSchedule,
  savePlace,
  saveWalkLink,
} from './store.ts';
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
  const raw = JSON.stringify(scheduleFixture());
  await replaceSchedule(source.db, raw, await hash(raw));
  const backup = parseBackup(JSON.parse(JSON.stringify(await exportBackup(source.db))));
  assert.ok(backup.tables.transit_place && backup.tables.transit_walk_link);
  assert.equal(backup.tables.transit_schedule_cache, undefined);
  await importBackup(target.db, backup);
  assert.deepEqual(await listPlaces(target.db), await listPlaces(source.db));
  assert.deepEqual(await listWalkLinks(target.db, id), await listWalkLinks(source.db, id));
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
    schema: 1,
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
    async () => new Response(JSON.stringify({ ...manifest, schema: 2 })),
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
