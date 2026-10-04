import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('the test command fails when the secret guard suite fails', () => {
  const bin = mkdtempSync(join(tmpdir(), 'nexo-test-command-'));
  try {
    writeFileSync(join(bin, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(bin, 'python3'), '#!/bin/sh\necho guard-failed\nexit 1\n', { mode: 0o755 });
    const root = dirname(dirname(fileURLToPath(import.meta.url)));
    const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const result = spawnSync('sh', ['-c', scripts.test], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /guard-failed/);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});
