import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('the collector still publishes a readable snapshot when the shared version changes', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'nexo-collector-'));
  const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  try {
    for (const file of [
      'scripts/fetch-deals.mjs',
      'src/deals/parse.ts',
      'src/deals/snapshot.ts',
      'src/db/transaction.ts',
    ]) {
      mkdirSync(dirname(join(fixture, file)), { recursive: true });
      const source = readFileSync(join(root, file), 'utf8');
      writeFileSync(
        join(fixture, file),
        file === 'src/deals/snapshot.ts'
          ? source.replace('SNAPSHOT_VERSION = 1', 'SNAPSHOT_VERSION = 2')
          : source,
      );
    }
    mkdirSync(join(fixture, 'deals'));
    writeFileSync(join(fixture, 'package.json'), '{"type":"module"}');
    writeFileSync(join(fixture, 'deals/queries.json'), '{"queries":[{"term":"eggs"}]}');
    writeFileSync(
      join(fixture, 'offline.mjs'),
      'globalThis.fetch = async () => ({ok: true, json: async () => ({items: []})});\n' +
        'globalThis.setTimeout = (callback) => { callback(); return 0; };\n',
    );
    execFileSync(process.execPath, ['--import', './offline.mjs', 'scripts/fetch-deals.mjs'], {
      cwd: fixture,
      env: { ...process.env, DEALS_POSTAL_CODE: 'N0N0N0' },
    });
    const snapshot = JSON.parse(readFileSync(join(fixture, 'deals/flipp.json'), 'utf8'));
    assert.equal(snapshot.version, 2);
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import {parseSnapshot} from './src/deals/snapshot.ts';" +
          "import {readFileSync} from 'node:fs';" +
          "parseSnapshot(readFileSync('./deals/flipp.json', 'utf8'));",
      ],
      { cwd: fixture },
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
