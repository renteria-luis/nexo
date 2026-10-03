// The pre-commit hook judges what is staged, not how the command was spelled, so it is
// exercised the way git runs it: inside a throwaway repository, with files staged.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hook = join(root, '.githooks', 'pre-commit');

/** Exit code of the hook with exactly these files staged. */
function preCommitWith(files: string[]): number {
  const repo = mkdtempSync(join(tmpdir(), 'nexo-hook-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', '1+test@users.noreply.github.com');
    for (const file of files) {
      mkdirSync(dirname(join(repo, file)), { recursive: true });
      writeFileSync(join(repo, file), 'x\n');
    }
    git('add', '--', ...files);
    return spawnSync('sh', [hook], { cwd: repo, stdio: 'ignore' }).status ?? -1;
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test('el commit no se lleva la spec, un respaldo del telefono ni una llave, se escriba como se escriba', () => {
  for (const file of [
    'SPEC.md',
    'docs/SPEC.v0.4.md',
    'nexo-2026-10-01.json',
    'backups/nexo-2026-09-30.json',
    '.env',
    'ios/dist.p12',
    'data/nexo.db',
  ]) {
    assert.equal(preCommitWith(['src/app.ts', file]), 1, file);
  }
});

test('lo de siempre pasa', () => {
  assert.equal(preCommitWith(['src/app.ts', 'deals/flipp.json', '.env.example']), 0);
});
