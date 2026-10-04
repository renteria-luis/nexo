import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { countCommitsOnUtcDay } from '../scripts/contribution-budget.mjs';

test('the daily commit budget follows UTC author dates and excludes other authors', () => {
  const owner = '1+test@users.noreply.github.com';
  const rows = [
    ['2026-10-03T19:59:59-04:00', owner],
    ['2026-10-03T20:00:00-04:00', owner],
    ['2026-10-04T00:01:00Z', owner],
    ['2026-10-04T01:00:00Z', '41898282+github-actions[bot]@users.noreply.github.com'],
    ['2026-12-03T18:59:59-05:00', owner],
    ['2026-12-03T19:00:00-05:00', owner],
  ]
    .map((row) => row.join('\t'))
    .join('\n');
  assert.equal(countCommitsOnUtcDay(rows, owner, '2026-10-03'), 1);
  assert.equal(countCommitsOnUtcDay(rows, owner, '2026-10-04'), 2);
  assert.equal(countCommitsOnUtcDay(rows, owner, '2026-12-03'), 1);
  assert.equal(countCommitsOnUtcDay(rows, owner, '2026-12-04'), 1);
});

test('the command counts origin/main by author date rather than committer date', () => {
  const repo = mkdtempSync(join(tmpdir(), 'nexo-budget-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', '1+test@users.noreply.github.com');
    const now = new Date();
    const today = now.toISOString();
    const yesterday = new Date(now.getTime() - 86400000).toISOString();
    for (const [date, email] of [
      [yesterday, '1+test@users.noreply.github.com'],
      [today, '1+test@users.noreply.github.com'],
      [today, '41898282+github-actions[bot]@users.noreply.github.com'],
    ]) {
      execFileSync('git', ['commit', '--allow-empty', '-qm', 'test'], {
        cwd: repo,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: date,
          GIT_AUTHOR_EMAIL: email,
          GIT_COMMITTER_DATE: today,
        },
      });
    }
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const command = fileURLToPath(new URL('../scripts/contribution-budget.mjs', import.meta.url));
    const output = execFileSync(process.execPath, [command], { cwd: repo, encoding: 'utf8' });
    assert.match(output, new RegExp(`${today.slice(0, 10)} UTC: 1 owner commits`));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
