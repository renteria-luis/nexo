// Points git at .githooks so the commit-msg hook that strips tool attribution
// survives a fresh clone. core.hooksPath lives in .git/config, which is not
// versioned, so without this every clone silently loses the hook.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

if (!existsSync(join(repoRoot, '.git'))) {
  console.log('setup-git-hooks: no .git directory here, nothing to configure.');
  process.exit(0);
}

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

console.log('setup-git-hooks: core.hooksPath set to .githooks');
